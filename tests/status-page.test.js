import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DESCRIPTION_LIMIT, previewMarkup, statusPage } from '../src/status-page.js';

mock.method(console, 'warn', () => {});

const SHELL = '<head>\n    <title>Status Rodeo</title>\n  </head>';

// Stands in for Cloudflare's HTMLRewriter: appends the markup inside <head>.
class FakeRewriter {
  on(selector, handlers) {
    assert.equal(selector, 'head');
    this.handlers = handlers;
    return this;
  }

  transform(response) {
    let out = SHELL;
    this.handlers.element({
      append(html, options) {
        assert.deepEqual(options, { html: true });
        out = SHELL.replace('</head>', `${html}</head>`);
      },
    });

    return new Response(out, { status: response.status, headers: response.headers });
  }
}

const shell = (headers = {}) =>
  new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"abc"', ...headers } });

const sofie = { display_name: 'Sofie', username: 'sofie', avatar: 'cactus' };
const rows = [
  { id: 7, content: 'Sunset over the "mesa" & a <b>big</b> sky.\nHat tip!', visibility: 'public', profiles: sofie },
  { id: 8, content: 'Secret', visibility: 'private', profiles: sofie },
  { id: 9, content: 'Odd avatar value', visibility: 'public', profiles: { display_name: 'Newbie', username: 'newbie', avatar: '../chris' } },
];

function fakeSupabase({ error = null, hang = false, spy = [] } = {}) {
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
          return Promise.resolve({ data: rows.find((r) => query.filters.every(([c, v]) => r[c] === v)) ?? null, error: null });
        },
      };
      return builder;
    },
  };
}

const get = () => new Request('https://status.rodeo/statuses/7');
const options = { Rewriter: FakeRewriter, timeoutMs: 50 };

test('a public status gets Open Graph tags: author, text, canonical url and avatar', async () => {
  const spy = [];
  const response = await statusPage(fakeSupabase({ spy }), get(), '7', shell(), options);
  const html = await response.text();

  assert.ok(html.includes('<meta property="og:title" content="Status by Sofie (@sofie)" />'));
  assert.ok(html.includes('content="Sunset over the &quot;mesa&quot; &amp; a &lt;b&gt;big&lt;/b&gt; sky. Hat tip!"'));
  assert.ok(html.includes('<meta property="og:url" content="https://status.rodeo/statuses/7" />'));
  assert.ok(html.includes('<meta property="og:image" content="https://status.rodeo/avatars/icons/cactus.webp" />'));
  assert.ok(html.includes('<meta property="og:image:width" content="512" />'));
  assert.ok(html.includes('<meta property="og:image:height" content="512" />'));
  assert.ok(html.includes('<meta property="og:image:alt" content="Sofie\'s avatar: cactus" />'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary" />'));
  assert.ok(html.indexOf('og:title') < html.indexOf('</head>'));
  assert.equal(response.headers.get('ETag'), null);
  assert.deepEqual(spy[0].filters, [['id', 7], ['visibility', 'public']]);
  assert.equal(spy[0].columns, 'id, content, profiles(display_name, username, avatar)');
});

test('an avatar value that is not one of the icons shows the default icon, never another path', async () => {
  const html = await (await statusPage(fakeSupabase(), get(), '9', shell(), options)).text();

  assert.ok(html.includes('content="https://status.rodeo/avatars/icons/cowboy-hat.webp"'));
  assert.ok(!html.includes('chris'));
  assert.ok(html.includes('<meta property="og:image:width" content="512" />'));
});

test('a profile without an avatar value (the column is missing or empty) shows the default icon', () => {
  const markup = previewMarkup({ id: 1, content: 'hi', profiles: { display_name: 'Newbie', username: 'newbie' } });

  assert.ok(markup.includes('content="https://status.rodeo/avatars/icons/cowboy-hat.webp"'));
});

test('a long status is cut with an ellipsis at the description limit', () => {
  const markup = previewMarkup({ id: 1, content: 'a'.repeat(300), profiles: sofie });
  const description = markup.match(/og:description" content="([^"]*)"/)[1];

  assert.equal(description, 'a'.repeat(DESCRIPTION_LIMIT) + '…');
});

test('a missing, private or invalid status, or a failed or slow lookup leaves the page unchanged', async () => {
  for (const [idText, supabase] of [
    ['404', fakeSupabase()],
    ['8', fakeSupabase()],
    ['abc', fakeSupabase()],
    ['007', fakeSupabase()],
    [undefined, fakeSupabase()],
    ['7', fakeSupabase({ error: { message: 'boom' } })],
    ['7', fakeSupabase({ hang: true })],
  ]) {
    const original = shell();
    assert.equal(await statusPage(supabase, get(), idText, original, options), original, String(idText));
  }
});

test('an invalid id makes no database request', async () => {
  const spy = [];
  await statusPage(fakeSupabase({ spy }), get(), '1e3', shell(), options);
  assert.equal(spy.length, 0);
});

test('HEAD, non-HTML, error responses and a missing rewriter pass through without a lookup', async () => {
  const spy = [];
  const supabase = fakeSupabase({ spy });
  const cases = [
    [new Request('https://status.rodeo/statuses/7', { method: 'HEAD' }), shell(), options],
    [get(), shell({ 'Content-Type': 'application/json' }), options],
    [get(), new Response('nope', { status: 500, headers: { 'Content-Type': 'text/html' } }), options],
    [get(), shell(), { ...options, Rewriter: undefined }],
  ];

  for (const [request, original, opts] of cases) {
    assert.equal(await statusPage(supabase, request, '7', original, opts), original);
  }

  assert.equal(spy.length, 0);
});
