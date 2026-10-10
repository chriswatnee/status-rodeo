import test from 'node:test';
import assert from 'node:assert/strict';
import { linkify } from '../src/linkify.js';

const links = (text) => linkify(text).filter((part) => part.type === 'link').map((part) => part.text);
const joined = (text) => linkify(text).map((part) => part.text).join('');

test('text without an address is one text part', () => {
  assert.deepEqual(linkify('Just a normal status.'), [{ type: 'text', text: 'Just a normal status.' }]);
  assert.deepEqual(linkify(''), [{ type: 'text', text: '' }]);
  assert.deepEqual(linkify(null), [{ type: 'text', text: '' }]);
});

test('finds an address in the middle of text and keeps the text around it', () => {
  assert.deepEqual(linkify('Read https://example.com/post now'), [
    { type: 'text', text: 'Read ' },
    { type: 'link', text: 'https://example.com/post', href: 'https://example.com/post' },
    { type: 'text', text: ' now' },
  ]);
});

test('an address alone, at the start and at the end', () => {
  assert.equal(linkify('https://example.com/').length, 1);
  assert.equal(linkify('https://example.com/')[0].type, 'link');
  assert.deepEqual(links('https://a.com/x and https://b.com/y'), ['https://a.com/x', 'https://b.com/y']);
  assert.deepEqual(links('go: http://example.org/path?q=1&r=2#top'), ['http://example.org/path?q=1&r=2#top']);
});

test('the shown text is what was typed; the href is the normal form', () => {
  const [part] = linkify('HTTPS://Example.COM').filter((p) => p.type === 'link');

  assert.equal(part.text, 'HTTPS://Example.COM');
  assert.equal(part.href, 'https://example.com/');
});

test('the parts always add up to the original text', () => {
  for (const text of ['See https://a.com/x.', '(https://a.com/b)', 'x https://a.com/ y https://b.org/z!!', 'no link', 'https://a.com/😀 end', 'a\nhttps://a.com/b\nc']) {
    assert.equal(joined(text), text, text);
  }
});

test('sentence punctuation after an address is not part of the link', () => {
  assert.deepEqual(links('See https://example.com/page.'), ['https://example.com/page']);
  assert.deepEqual(links('Is it https://example.com/page?'), ['https://example.com/page']);
  assert.deepEqual(links('Wow https://example.com/page!!!'), ['https://example.com/page']);
  assert.deepEqual(links('a https://example.com/x, b'), ['https://example.com/x']);
  assert.deepEqual(links('a https://example.com/x; b'), ['https://example.com/x']);
  assert.deepEqual(links("it's 'https://example.com/x'"), ['https://example.com/x']);
  assert.deepEqual(links('then… https://example.com/x…'), ['https://example.com/x']);
  assert.equal(linkify('See https://example.com/page.').at(-1).text, '.');
});

test('a query string or fragment keeps its own punctuation', () => {
  assert.deepEqual(links('https://example.com/a?b=c&d=e#f'), ['https://example.com/a?b=c&d=e#f']);
  assert.deepEqual(links('https://example.com/a.b/c.d'), ['https://example.com/a.b/c.d']);
});

test('brackets: closing only belongs to the link if the address opened one', () => {
  assert.deepEqual(links('(see https://example.com/page)'), ['https://example.com/page']);
  assert.deepEqual(links('(see https://example.com/page).'), ['https://example.com/page']);
  assert.deepEqual(links('[https://example.com/page]'), ['https://example.com/page']);
  assert.deepEqual(links('https://en.wikipedia.org/wiki/Foo_(bar)'), ['https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepEqual(links('(https://en.wikipedia.org/wiki/Foo_(bar))'), ['https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepEqual(links('https://en.wikipedia.org/wiki/Foo_(bar).'), ['https://en.wikipedia.org/wiki/Foo_(bar)']);
});

test('other schemes and look-alikes are never linked', () => {
  for (const text of [
    'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x',
    'ftp://example.com/file', 'file:///etc/passwd', 'mailto:me@example.com', '//evil.example.com/x',
    'example.com', 'www.example.com', 'ssh://example.com', 'httpx://example.com', 'xhttps://example.com',
  ]) {
    // "xhttps://example.com" contains "https://example.com", which is a real address
    const found = links(text);

    if (text === 'xhttps://example.com') assert.deepEqual(found, ['https://example.com'], text);
    else assert.deepEqual(found, [], text);
  }
});

test('an address with a username or password is left as text', () => {
  assert.deepEqual(links('https://paypal.com@evil.example/login'), []);
  assert.deepEqual(links('https://user:pass@example.com/'), []);
});

test('a host without a dot, or an empty one, is left as text', () => {
  assert.deepEqual(links('http://localhost:3000/x'), []);
  assert.deepEqual(links('https://intranet/x'), []);
  assert.deepEqual(links('https://'), []);
  assert.deepEqual(links('https:// example.com'), []);
  assert.deepEqual(links('http://.'), []);
});

test('ports, paths, IP addresses and unicode work', () => {
  assert.deepEqual(links('https://example.com:8443/a'), ['https://example.com:8443/a']);
  assert.deepEqual(links('http://192.168.1.10/admin'), ['http://192.168.1.10/admin']);
  assert.deepEqual(links('https://日本語.example/パス'), ['https://日本語.example/パス']);
  assert.equal(linkify('https://日本語.example/パス')[0].href.startsWith('https://xn--'), true);
});

test('markup in a status is just text', () => {
  const evil = '<img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a> https://example.com/ok';
  const parts = linkify(evil);

  assert.deepEqual(links(evil), ['https://example.com/ok']);
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[0].text.includes('<img src=x onerror=alert(1)>'), true);
  assert.equal(joined(evil), evil);
});

test('an address cannot swallow markup characters or quotes', () => {
  assert.deepEqual(links('<https://example.com/a>'), ['https://example.com/a']);
  assert.deepEqual(links('"https://example.com/a"'), ['https://example.com/a']);
  assert.deepEqual(links('x https://example.com/a"onmouseover="alert(1)'), ['https://example.com/a']);
});

test('newlines and tabs end an address', () => {
  assert.deepEqual(links('https://a.com/x\nhttps://b.com/y\thttps://c.com/z'), ['https://a.com/x', 'https://b.com/y', 'https://c.com/z']);
});

test('a long status with many addresses stays fast', () => {
  const text = 'https://example.com/a '.repeat(12) + 'x'.repeat(200);
  const start = performance.now();

  assert.equal(links(text).length, 12);
  assert.ok(performance.now() - start < 50);
  // no pathological backtracking on a long unbroken run of punctuation
  assert.doesNotThrow(() => linkify('https://example.com/' + '.'.repeat(5000) + ')'.repeat(5000)));
});
