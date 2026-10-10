import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { sitewideFeed, userFeed } from '../src/feed.js';
import { FEED_LIMIT } from '../src/rss.js';
import { assertWellFormed } from './xml-check.js';

// The handlers log failures with console.error; keep the test output quiet.
mock.method(console, 'error', () => {});

// A stand-in for the Supabase client that really filters, sorts and limits the rows
// it holds, and records every query, so the tests see what the feed would show.
function fakeSupabase({ profiles = [], statuses = [], failOn = null, throwOn = null } = {}) {
  const queries = [];

  function from(table) {
    const query = { table, columns: null, filters: [], orders: [], limit: null };
    queries.push(query);

    const builder = {
      select(columns) { query.columns = columns; return builder; },
      eq(column, value) { query.filters.push([column, value]); return builder; },
      order(column, options) { query.orders.push([column, options?.ascending !== false]); return builder; },
      limit(count) { query.limit = count; return builder; },
      maybeSingle() { query.single = true; return builder; },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };

    async function execute() {
      if (throwOn === table) throw new Error('network down');
      if (failOn === table) return { data: null, error: { message: 'boom' } };

      let rows = (table === 'profiles' ? profiles : statuses).filter((row) =>
        query.filters.every(([column, value]) => row[column] === value)
      );

      for (const [column, ascending] of [...query.orders].reverse()) {
        rows = [...rows].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
      }

      if (query.limit !== null) rows = rows.slice(0, query.limit);

      if (table === 'statuses') {
        rows = rows.map((row) => ({
          id: row.id, content: row.content, created_at: row.created_at,
          ...(query.columns.includes('profiles') ? { profiles: profiles.find((p) => p.user_id === row.user_id) ?? null } : {}),
        }));
      }

      return query.single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
    }

    return builder;
  }

  return { from, queries };
}

const UID_SOFIE = '11111111-aaaa-bbbb-cccc-000000000001';
const UID_CHRIS = '22222222-aaaa-bbbb-cccc-000000000002';
const profiles = [
  { user_id: UID_SOFIE, username: 'sofie', display_name: 'Sofie' },
  { user_id: UID_CHRIS, username: 'chris', display_name: 'Chris' },
];
const row = (id, user_id, created_at, content = `status ${id}`, visibility = 'public') => ({ id, user_id, content, created_at, visibility });
const get = (path = '/feed.xml', method = 'GET') => new Request(`https://status-rodeo.pages.dev${path}`, { method });
const ids = (xml) => [...xml.matchAll(/\/statuses\/(\d+)<\/link>/g)].map((m) => Number(m[1]));

test('sitewide: 200, RSS content type, short cache, newest first from every user', async () => {
  const db = fakeSupabase({
    profiles,
    statuses: [
      row(1, UID_SOFIE, '2026-10-01T10:00:00Z'),
      row(2, UID_CHRIS, '2026-10-03T10:00:00Z'),
      row(3, UID_SOFIE, '2026-10-02T10:00:00Z'),
    ],
  });
  const response = await sitewideFeed(db, get());
  const xml = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/rss+xml; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300');
  assertWellFormed(xml);
  assert.deepEqual(ids(xml), [2, 3, 1]);
  assert.match(xml, /<dc:creator>Chris<\/dc:creator>/);
  assert.match(xml, /<dc:creator>Sofie<\/dc:creator>/);
});

test('sitewide: identical timestamps are ordered by id, newest id first, every time', async () => {
  const same = '2026-10-10T12:00:00Z';
  const db = fakeSupabase({
    profiles,
    statuses: [row(5, UID_SOFIE, same), row(9, UID_CHRIS, same), row(7, UID_SOFIE, same), row(8, UID_CHRIS, '2026-10-11T00:00:00Z')],
  });
  const first = await (await sitewideFeed(db, get())).text();
  const second = await (await sitewideFeed(db, get())).text();

  assert.deepEqual(ids(first), [8, 9, 7, 5]);
  assert.equal(first, second);
  assert.deepEqual(db.queries[0].orders, [['created_at', false], ['id', false]]);
});

test('sitewide: only public statuses are asked for and shown', async () => {
  const db = fakeSupabase({
    profiles,
    statuses: [
      row(1, UID_SOFIE, '2026-10-01T10:00:00Z', 'public one'),
      row(2, UID_SOFIE, '2026-10-02T10:00:00Z', 'SECRET', 'private'),
      row(3, UID_CHRIS, '2026-10-03T10:00:00Z', 'SECRET too', 'followers'),
    ],
  });
  const xml = await (await sitewideFeed(db, get())).text();

  assert.deepEqual(db.queries[0].filters, [['visibility', 'public']]);
  assert.deepEqual(ids(xml), [1]);
  assert.doesNotMatch(xml, /SECRET/);
});

test('sitewide: limited to the newest 30 and selects no user ids', async () => {
  const many = Array.from({ length: 45 }, (_, i) => row(i + 1, UID_SOFIE, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()));
  const db = fakeSupabase({ profiles, statuses: many });
  const xml = await (await sitewideFeed(db, get())).text();

  assert.equal(FEED_LIMIT, 30);
  assert.equal(db.queries[0].limit, 30);
  assert.equal(ids(xml).length, 30);
  assert.equal(ids(xml)[0], 45);
  assert.doesNotMatch(db.queries[0].columns, /user_id/);
  assert.doesNotMatch(xml, new RegExp(`${UID_SOFIE}|${UID_CHRIS}|@|user_id`));
});

test('sitewide: no statuses is a valid empty feed, not an error', async () => {
  const response = await sitewideFeed(fakeSupabase({ profiles }), get());
  const xml = await response.text();

  assert.equal(response.status, 200);
  assertWellFormed(xml);
  assert.doesNotMatch(xml, /<item>/);
});

test('sitewide: a database error is a 500 that is not cached, with no details', async () => {
  const response = await sitewideFeed(fakeSupabase({ failOn: 'statuses' }), get());

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Type'), /^text\/plain/);
  assert.equal(await response.text(), 'Unable to load feed.');
});

test('sitewide: a thrown error (network) is the same 500', async () => {
  const response = await sitewideFeed(fakeSupabase({ throwOn: 'statuses' }), get());

  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Unable to load feed.');
});

test('links and the self link use the real site even when fetched from a preview address', async () => {
  const db = fakeSupabase({ profiles, statuses: [row(1, UID_SOFIE, '2026-10-01T10:00:00Z')] });
  const xml = await (await sitewideFeed(db, get('/feed.xml'))).text();

  assert.match(xml, /<atom:link href="https:\/\/status\.rodeo\/feed\.xml"/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/status\.rodeo\/statuses\/1</);
  assert.doesNotMatch(xml, /pages\.dev/);
});

test('HEAD: same status and headers, no body', async () => {
  const db = fakeSupabase({ profiles, statuses: [row(1, UID_SOFIE, '2026-10-01T10:00:00Z')] });
  const head = await sitewideFeed(db, get('/feed.xml', 'HEAD'));
  const full = await sitewideFeed(db, get('/feed.xml', 'GET'));

  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), full.headers.get('Content-Type'));
  assert.equal(head.headers.get('Cache-Control'), full.headers.get('Cache-Control'));
  assert.equal(await head.text(), '');
});

test('other methods are 405 with Allow, and read nothing', async () => {
  const db = fakeSupabase({ profiles });

  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const response of [await sitewideFeed(db, get('/feed.xml', method)), await userFeed(db, get('/users/sofie/feed.xml', method), 'sofie')]) {
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get('Allow'), 'GET, HEAD');
    }
  }

  assert.equal(db.queries.length, 0);
});

test('user feed: that user only, newest first, author is their display name, titled like their page', async () => {
  const db = fakeSupabase({
    profiles,
    statuses: [
      row(1, UID_SOFIE, '2026-10-01T10:00:00Z'),
      row(2, UID_CHRIS, '2026-10-05T10:00:00Z', 'not hers'),
      row(3, UID_SOFIE, '2026-10-03T10:00:00Z'),
      row(4, UID_SOFIE, '2026-10-04T10:00:00Z', 'SECRET', 'private'),
    ],
  });
  const response = await userFeed(db, get('/users/sofie/feed.xml'), 'sofie');
  const xml = await response.text();

  assert.equal(response.status, 200);
  assertWellFormed(xml);
  assert.deepEqual(ids(xml), [3, 1]);
  assert.doesNotMatch(xml, /not hers|SECRET|Chris/);
  assert.equal((xml.match(/<dc:creator>Sofie<\/dc:creator>/g) ?? []).length, 2);
  assert.match(xml, /<title>Sofie \(@sofie\) · Status Rodeo<\/title>/);
  assert.match(xml, /<link>https:\/\/status\.rodeo\/users\/sofie<\/link>/);
  assert.match(xml, /<atom:link href="https:\/\/status\.rodeo\/users\/sofie\/feed\.xml"/);
  assert.deepEqual(db.queries[1].filters, [['user_id', UID_SOFIE], ['visibility', 'public']]);
  assert.deepEqual(db.queries[1].orders, [['created_at', false], ['id', false]]);
  assert.equal(db.queries[1].limit, 30);
  assert.doesNotMatch(xml, new RegExp(UID_SOFIE));
});

test('user feed: identical timestamps are ordered by id', async () => {
  const same = '2026-10-10T12:00:00Z';
  const db = fakeSupabase({ profiles, statuses: [row(3, UID_SOFIE, same), row(10, UID_SOFIE, same), row(6, UID_SOFIE, same)] });

  assert.deepEqual(ids(await (await userFeed(db, get(), 'sofie')).text()), [10, 6, 3]);
});

test('user feed: a user with no public statuses gets an empty valid feed', async () => {
  const db = fakeSupabase({ profiles, statuses: [row(1, UID_SOFIE, '2026-10-01T10:00:00Z', 'x', 'private')] });
  const response = await userFeed(db, get(), 'sofie');
  const xml = await response.text();

  assert.equal(response.status, 200);
  assertWellFormed(xml);
  assert.doesNotMatch(xml, /<item>/);
});

test('user feed: an unknown user is 404, briefly cacheable, and no statuses are read', async () => {
  const db = fakeSupabase({ profiles, statuses: [row(1, UID_SOFIE, '2026-10-01T10:00:00Z')] });
  const response = await userFeed(db, get('/users/nobody/feed.xml'), 'nobody');

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal(await response.text(), 'User not found.');
  assert.deepEqual(db.queries.map((q) => q.table), ['profiles']);
});

test('user feed: names that cannot be usernames are 404 without any query', async () => {
  const db = fakeSupabase({ profiles });
  const bad = ['', ' ', 'so fie', 'sofie/../x', 'so%66ie', "x'; drop table profiles;--", 'a'.repeat(51), '日本語', 'sofie\n', undefined, null, ['sofie'], 42];

  for (const name of bad) {
    const response = await userFeed(db, get('/users/x/feed.xml'), name);

    assert.equal(response.status, 404, JSON.stringify(name));
  }

  assert.equal(db.queries.length, 0);
});

test('user feed: usernames are matched exactly', async () => {
  const db = fakeSupabase({ profiles });

  assert.equal((await userFeed(db, get(), 'Sofie')).status, 404);
  assert.equal((await userFeed(db, get(), 'sofie')).status, 200);
});

test('user feed: database errors and thrown errors are 500, not cached', async () => {
  const cases = [
    fakeSupabase({ profiles, failOn: 'profiles' }),
    fakeSupabase({ profiles, failOn: 'statuses' }),
    fakeSupabase({ profiles, throwOn: 'profiles' }),
    fakeSupabase({ profiles, throwOn: 'statuses' }),
  ];

  for (const db of cases) {
    const response = await userFeed(db, get(), 'sofie');

    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await response.text(), 'Unable to load feed.');
  }
});

test('user feed: HEAD gives headers only, and a 404 HEAD has no body either', async () => {
  const db = fakeSupabase({ profiles, statuses: [row(1, UID_SOFIE, '2026-10-01T10:00:00Z')] });
  const ok = await userFeed(db, get('/users/sofie/feed.xml', 'HEAD'), 'sofie');
  const missing = await userFeed(db, get('/users/nobody/feed.xml', 'HEAD'), 'nobody');

  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '');
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), '');
});

test('hostile content in the database cannot break either feed', async () => {
  const hostile = [
    row(1, UID_SOFIE, '2026-10-01T10:00:00Z', '<![CDATA[ ]]> </description></item></channel></rss> & \u0000\u0001 \uD83D'),
    row(2, UID_SOFIE, '2026-10-02T10:00:00Z', 'ok'),
  ];
  const db = fakeSupabase({ profiles: [{ ...profiles[0], display_name: 'So</dc:creator>fie & <x>' }, profiles[1]], statuses: hostile });

  for (const response of [await sitewideFeed(db, get()), await userFeed(db, get(), 'sofie')]) {
    const xml = await response.text();

    assertWellFormed(xml);
    assert.equal((xml.match(/<item>/g) ?? []).length, 2);
  }
});
