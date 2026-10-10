import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE_URL, TITLE_LIMIT, buildFeed, cleanXmlText, escapeXml, plainTitle } from '../src/rss.js';
import { assertWellFormed } from './xml-check.js';

const feed = (items, extra = {}) =>
  buildFeed({
    title: 'Status Rodeo',
    description: 'Recent public statuses on Status Rodeo.',
    link: `${SITE_URL}/`,
    path: '/feed.xml',
    items,
    ...extra,
  });

const item = (overrides = {}) => ({
  id: 42,
  content: 'Hello trail',
  createdAt: '2026-10-10T14:00:00Z',
  author: 'Sofie',
  ...overrides,
});

test('escapes the five XML characters', () => {
  assert.equal(escapeXml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
});

test('does not escape twice: an existing entity in the text is just text', () => {
  assert.equal(escapeXml('&amp;'), '&amp;amp;');
  assert.equal(escapeXml('5 < 6 && 7 > 6'), '5 &lt; 6 &amp;&amp; 7 &gt; 6');
});

test('removes characters XML cannot contain, keeps tab, newline and real text', () => {
  assert.equal(cleanXmlText('a\u0000b\u0001c\u0008d\u000Be\u000Cf\u001Fg'), 'abcdefg');
  assert.equal(cleanXmlText('a\tb\nc\rd'), 'a\tb\nc\rd');
  assert.equal(cleanXmlText('a￾b￿c'), 'abc');
  assert.equal(cleanXmlText('a\u007Fb\u0085c\u009Fd'), 'abcd');
  assert.equal(cleanXmlText('lone \uD83D high and \uDC4D low'), 'lone  high and  low');
  assert.equal(cleanXmlText('👍 日本語 é ‍ 🏳️‍🌈'), '👍 日本語 é ‍ 🏳️‍🌈');
  assert.equal(cleanXmlText(null), '');
  assert.equal(cleanXmlText(undefined), '');
});

test('title: one line, whitespace collapsed', () => {
  assert.equal(plainTitle('  Hello\n\n  trail\t friend  '), 'Hello trail friend');
});

test('title: short text is unchanged, long text is cut with an ellipsis', () => {
  const exact = 'a'.repeat(TITLE_LIMIT);

  assert.equal(plainTitle(exact), exact);
  assert.equal(plainTitle(exact + 'b'), exact + '…');
  assert.equal(plainTitle('word '.repeat(40)).endsWith('word…'), true);
});

test('title: never cuts an emoji in half', () => {
  const thumbs = '👍🏽'.repeat(100); // each is two code points, one character
  const title = plainTitle(thumbs);

  assert.equal(Array.from(title).length, TITLE_LIMIT * 2 + 1);
  assert.equal(title, '👍🏽'.repeat(TITLE_LIMIT) + '…');
  assert.doesNotThrow(() => assertWellFormed(feed([item({ content: thumbs })])));
  // without Intl.Segmenter it falls back to code points, still never a lone surrogate
  assert.doesNotMatch(plainTitle('😀'.repeat(100), 80, null), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test('an item has title, canonical link and guid, date, creator and full text', () => {
  const xml = feed([item()]);

  assertWellFormed(xml);
  assert.match(xml, /<title>Hello trail<\/title>/);
  assert.match(xml, /<link>https:\/\/status\.rodeo\/statuses\/42<\/link>/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/status\.rodeo\/statuses\/42<\/guid>/);
  assert.match(xml, /<pubDate>Sat, 10 Oct 2026 14:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<dc:creator>Sofie<\/dc:creator>/);
  assert.match(xml, /<description>Hello trail<\/description>/);
});

test('the description is the complete text, the title the short version', () => {
  const long = 'x'.repeat(200);
  const xml = feed([item({ content: long })]);

  assert.match(xml, new RegExp(`<description>${long}</description>`));
  assert.match(xml, /<title>x{80}…<\/title>/);
});

test('user text can never become markup', () => {
  const evil = `<script>alert("x")</script> & <b>bold</b> ]]> <!-- c --> &lt;`;
  const xml = feed([item({ content: evil, author: '<Sofie & "Co">' })]);

  assertWellFormed(xml);
  assert.doesNotMatch(xml, /<script|<b>|<!--/);
  assert.match(xml, /<description>&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &lt;b&gt;bold&lt;\/b&gt; \]\]&gt; &lt;!-- c --&gt; &amp;lt;<\/description>/);
  assert.match(xml, /<dc:creator>&lt;Sofie &amp; &quot;Co&quot;&gt;<\/dc:creator>/);
});

test('a status with forbidden characters still gives a well-formed feed', () => {
  const xml = feed([item({ content: 'bad\u0000\u0001 text \uD83D end', author: 'So\u0002fie' })]);

  assertWellFormed(xml);
  assert.match(xml, /<description>bad text  end<\/description>/);
  assert.match(xml, /<dc:creator>Sofie<\/dc:creator>/);
});

test('newlines in a status are kept as plain text, not turned into HTML', () => {
  const xml = feed([item({ content: 'line one\nline two' })]);

  assert.match(xml, /<description>line one\nline two<\/description>/);
  assert.match(xml, /<title>line one line two<\/title>/);
  assert.doesNotMatch(xml, /<br/);
});

test('unusual Unicode survives', () => {
  const xml = feed([item({ content: 'Привет 日本語 🏳️‍🌈 👨‍👩‍👧 é', author: 'Zoë 🤠' })]);

  assertWellFormed(xml);
  assert.match(xml, /<description>Привет 日本語 🏳️‍🌈 👨‍👩‍👧 é<\/description>/);
  assert.match(xml, /<dc:creator>Zoë 🤠<\/dc:creator>/);
});

test('items keep the order they are given', () => {
  const xml = feed([item({ id: 3 }), item({ id: 2 }), item({ id: 1 })]);

  assert.deepEqual([...xml.matchAll(/statuses\/(\d)<\/link>/g)].map((m) => m[1]), ['3', '2', '1']);
});

test('skips an item with no usable id or nothing to show', () => {
  const xml = feed([
    item({ id: 1 }),
    item({ id: 0 }),
    item({ id: -5 }),
    item({ id: 1.5 }),
    item({ id: '7' }),
    item({ id: null }),
    item({ id: 2, content: '\u0000\u0001' }),
    item({ id: 3, content: '   ' }),
    item({ id: 4, content: null }),
  ]);

  assertWellFormed(xml);
  assert.equal((xml.match(/<item>/g) ?? []).length, 1);
});

test('leaves out the date and creator when they are missing or invalid', () => {
  for (const createdAt of [null, undefined, '', 'not a date']) {
    const xml = feed([item({ createdAt, author: undefined })]);

    assertWellFormed(xml);
    assert.doesNotMatch(xml, /<pubDate>|<lastBuildDate>|<dc:creator>/);
  }
});

test('an empty feed is still a valid feed', () => {
  const xml = feed([]);

  assertWellFormed(xml);
  assert.doesNotMatch(xml, /<item>|<lastBuildDate>/);
  assert.match(xml, /<title>Status Rodeo<\/title>/);
});

test('channel: required elements, canonical self link, newest date as lastBuildDate', () => {
  const xml = feed([item({ id: 2, createdAt: '2026-10-10T15:00:00Z' }), item({ id: 1, createdAt: '2026-10-09T09:30:05Z' })]);

  assertWellFormed(xml);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0" /);
  assert.match(xml, /xmlns:atom="http:\/\/www.w3.org\/2005\/Atom"/);
  assert.match(xml, /xmlns:dc="http:\/\/purl.org\/dc\/elements\/1.1\/"/);
  assert.match(xml, /<link>https:\/\/status\.rodeo\/<\/link>/);
  assert.match(xml, /<language>en-us<\/language>/);
  assert.match(xml, /<lastBuildDate>Sat, 10 Oct 2026 15:00:00 GMT<\/lastBuildDate>/);
  assert.match(xml, /<atom:link href="https:\/\/status\.rodeo\/feed\.xml" rel="self" type="application\/rss\+xml" \/>/);
});

test('lastBuildDate is the newest item even if the list is not ordered', () => {
  const xml = feed([item({ id: 1, createdAt: '2026-10-01T00:00:00Z' }), item({ id: 2, createdAt: '2026-10-05T00:00:00Z' })]);

  assert.match(xml, /<lastBuildDate>Mon, 05 Oct 2026 00:00:00 GMT<\/lastBuildDate>/);
});

test('same input, same document (no request time in it)', () => {
  assert.equal(feed([item()]), feed([item()]));
});

test('channel text is escaped too', () => {
  const xml = feed([], { title: 'A & B <c>', description: '"q"' });

  assertWellFormed(xml);
  assert.match(xml, /<title>A &amp; B &lt;c&gt;<\/title>/);
});

test('the well-formedness check itself catches the usual mistakes', () => {
  const head = '<?xml version="1.0" encoding="UTF-8"?>';

  assert.throws(() => assertWellFormed(`${head}<a>x & y</a>`));
  assert.throws(() => assertWellFormed(`${head}<a><b></a></b>`));
  assert.throws(() => assertWellFormed(`${head}<a>x\u0001</a>`));
  assert.throws(() => assertWellFormed(`${head}<a x=1></a>`));
  assert.throws(() => assertWellFormed(`${head}<a></a><b></b>`));
  assert.throws(() => assertWellFormed(`<a></a>`));
  assert.doesNotThrow(() => assertWellFormed(`${head}<a x="&amp;">&lt; &#65; &#x41;</a>`));
});
