import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeRewriter } from './fake-rewriter.js';
import { escapeAttribute, feedLinkMarkup, profilePreviewMarkup, userPage } from '../src/user-page.js';

mock.method(console, 'warn', () => {});

const SHELL = '<head>\n    <title>Status Rodeo</title>\n    <meta property="og:title" content="Status Rodeo" />\n    <meta property="og:image" content="https://status.rodeo/default.webp" />\n    <meta name="twitter:card" content="summary" />\n    <link rel="alternate" type="application/rss+xml" title="Status Rodeo" href="/feed.xml" />\n  </head>';

const FakeRewriter = createFakeRewriter(SHELL);

function shell(init = {}) {
  return new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"abc"', ...init.headers } });
}

function fakeSupabase({ profiles = [], error = null, hang = false, spy = [] } = {}) {
  return {
    from(table) {
      const query = { table, filters: [] };
      spy.push(query);
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        maybeSingle() {
          if (hang) return new Promise(() => {});
          if (error) return Promise.resolve({ data: null, error });
          return Promise.resolve({ data: profiles.find((p) => query.filters.every(([c, v]) => p[c] === v)) ?? null, error: null });
        },
      };
      return builder;
    },
  };
}

const chris = { username: 'chris', display_name: 'Chris', avatar: 'sheriff-star' };
const get = (path = '/users/chris') => new Request('https://status.rodeo' + path);
const options = { Rewriter: FakeRewriter, timeoutMs: 50 };

test('escapeAttribute escapes quotes, ampersands and angle brackets and flattens whitespace', () => {
  assert.equal(escapeAttribute('A "quoted" <b> & co'), 'A &quot;quoted&quot; &lt;b&gt; &amp; co');
  assert.equal(escapeAttribute('two\nlines\t here\u0000'), 'two lines here');
});

test('feedLinkMarkup is a feed link with the user, a relative href and escaped title', () => {
  const markup = feedLinkMarkup({ username: 'a.b_c-d', display_name: 'Sam "S" <x>' });
  assert.match(markup, /^<link rel="alternate" type="application\/rss\+xml" /);
  assert.ok(markup.includes('title="Sam &quot;S&quot; &lt;x&gt; (@a.b_c-d) · Status Rodeo"'));
  assert.ok(markup.includes('href="/users/a.b_c-d/feed.xml"'));
});

test('a known user gets their feed link ahead of the sitewide one, and the ETag is dropped', async () => {
  const spy = [];
  const response = await userPage(fakeSupabase({ profiles: [chris], spy }), get(), 'chris', shell(), options);
  const html = await response.text();

  assert.ok(html.indexOf('/users/chris/feed.xml') !== -1);
  assert.ok(html.indexOf('/users/chris/feed.xml') < html.indexOf('href="/feed.xml"'));
  assert.ok(html.includes('href="/feed.xml"'));
  assert.equal(response.headers.get('ETag'), null);
  assert.equal(response.status, 200);
  assert.deepEqual(spy[0].filters, [['username', 'chris']]);
  assert.equal(spy[0].columns, 'username, display_name, avatar');
});

test('an unknown user, a bad username or a failed lookup leaves the page unchanged', async () => {
  for (const [username, supabase] of [
    ['nobody', fakeSupabase({ profiles: [chris] })],
    ['Chris', fakeSupabase({ profiles: [chris] })],
    ['bad name', fakeSupabase({ profiles: [chris] })],
    [undefined, fakeSupabase({ profiles: [chris] })],
    ['chris', fakeSupabase({ error: { message: 'boom' } })],
  ]) {
    const original = shell();
    const response = await userPage(supabase, get(), username, original, options);
    assert.equal(response, original, String(username));
  }
});

test('a bad username makes no database request', async () => {
  const spy = [];
  await userPage(fakeSupabase({ profiles: [chris], spy }), get(), 'a/b', shell(), options);
  assert.equal(spy.length, 0);
});

test('a slow database does not hold the page up', async () => {
  const original = shell();
  const started = Date.now();
  const response = await userPage(fakeSupabase({ hang: true }), get(), 'chris', original, options);
  assert.equal(response, original);
  assert.ok(Date.now() - started < 1000);
});

test('HEAD, non-HTML, error responses and a missing rewriter are passed through without a lookup', async () => {
  const spy = [];
  const supabase = fakeSupabase({ profiles: [chris], spy });
  const cases = [
    [new Request('https://status.rodeo/users/chris', { method: 'HEAD' }), shell(), options],
    [get(), shell({ headers: { 'Content-Type': 'application/json' } }), options],
    [get(), new Response('nope', { status: 500, headers: { 'Content-Type': 'text/html' } }), options],
    [get(), shell(), { Rewriter: undefined, timeoutMs: 50 }],
  ];

  for (const [request, original, opts] of cases) {
    assert.equal(await userPage(supabase, request, 'chris', original, opts), original);
  }

  assert.equal(spy.length, 0);
});

test('a known user gets their own preview tags instead of the default set', async () => {
  const html = await (await userPage(fakeSupabase({ profiles: [chris] }), get(), 'chris', shell(), options)).text();

  assert.equal((html.match(/property="og:title"/g) ?? []).length, 1);
  assert.equal((html.match(/name="twitter:card"/g) ?? []).length, 1);
  assert.ok(!html.includes('default.webp'));
  assert.ok(html.includes('<meta property="og:title" content="Chris (@chris)" />'));
  assert.ok(html.includes('<meta property="og:url" content="https://status.rodeo/users/chris" />'));
  assert.ok(html.includes('<meta property="og:image" content="https://status.rodeo/avatars/icons/sheriff-star.webp" />'));
  assert.ok(html.includes('content="Statuses from Chris (@chris) on Status Rodeo."'));
});

test('profile preview escapes the name and shows the default icon for an unknown avatar value', () => {
  const markup = profilePreviewMarkup({ username: 'a.b', display_name: 'Sam "S" <x>', avatar: '../chris' });

  assert.ok(markup.includes('content="Sam &quot;S&quot; &lt;x&gt; (@a.b)"'));
  assert.ok(markup.includes('/avatars/icons/cowboy-hat.webp'));
  assert.ok(!markup.includes('../chris'));
  assert.ok(!markup.includes('<x>'));
});

test('an unknown user keeps the default preview tags', async () => {
  const html = await (await userPage(fakeSupabase({ profiles: [] }), get('/users/nobody'), 'nobody', shell(), options)).text();

  assert.ok(html.includes('default.webp'));
});
