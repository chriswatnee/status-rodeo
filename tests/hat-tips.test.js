import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAT_TIP_BATCH_LIMIT,
  createHatTipStore,
  fetchHatTipInfo,
  hatTipCountText,
  setHatTip,
} from '../src/hat-tips.js';

// A stand-in for the Supabase client. `rows` are what hat_tip_info answers with;
// `write` decides what an insert or delete returns (and may wait, to hold a request
// open); `user` is what auth.getUser() finds.
function fakeSupabase({ rows = [], rpcError = null, write = async () => ({ error: null }), user = { id: 'me' } } = {}) {
  const calls = { rpc: [], insert: [], delete: [], getUser: 0 };

  return {
    calls,
    async rpc(name, args) {
      calls.rpc.push({ name, args });

      return rpcError ? { data: null, error: rpcError } : { data: rows, error: null };
    },
    from(table) {
      assert.equal(table, 'hat_tips');

      return {
        insert: async (row) => {
          calls.insert.push(row);

          return write('insert', row);
        },
        delete() {
          const filters = {};
          const chain = {
            eq(column, value) {
              filters[column] = value;

              return chain;
            },
            then(resolve, reject) {
              calls.delete.push({ ...filters });

              return Promise.resolve(write('delete', filters)).then(resolve, reject);
            },
          };

          return chain;
        },
      };
    },
    auth: {
      async getUser() {
        calls.getUser += 1;

        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'Auth session missing!' } };
      },
    },
  };
}

const row = (id, tips, tipped = false) => ({ status_id: id, tips, tipped });

// ---------- wording ----------

test('the count reads "1 hat tip", "2 hat tips" and "0 hat tips"', () => {
  assert.equal(hatTipCountText(0), '0 hat tips');
  assert.equal(hatTipCountText(1), '1 hat tip');
  assert.equal(hatTipCountText(2), '2 hat tips');
  assert.equal(hatTipCountText(1200), '1200 hat tips');
});

// ---------- fetching ----------

test('counts for several statuses come from one request, with duplicates removed', async () => {
  const supabase = fakeSupabase({ rows: [row(1, 3, true), row(2, 0)] });
  const result = await fetchHatTipInfo(supabase, [1, 2, 2, 1]);

  assert.equal(supabase.calls.rpc.length, 1);
  assert.deepEqual(supabase.calls.rpc[0], { name: 'hat_tip_info', args: { status_ids: [1, 2] } });
  assert.deepEqual(result.info.get(1), { count: 3, tipped: true });
  assert.deepEqual(result.info.get(2), { count: 0, tipped: false });
});

test('asking for no statuses makes no request', async () => {
  const supabase = fakeSupabase();
  const result = await fetchHatTipInfo(supabase, []);

  assert.equal(result.ok, true);
  assert.equal(result.info.size, 0);
  assert.equal(supabase.calls.rpc.length, 0);
});

test('a big list is split to stay inside the database limit', async () => {
  const supabase = fakeSupabase();
  const ids = Array.from({ length: HAT_TIP_BATCH_LIMIT * 2 + 5 }, (_, i) => i + 1);

  await fetchHatTipInfo(supabase, ids);

  assert.deepEqual(supabase.calls.rpc.map((call) => call.args.status_ids.length), [100, 100, 5]);
});

test('counts that arrive as strings or nulls are read as numbers and booleans', async () => {
  const supabase = fakeSupabase({ rows: [{ status_id: 7, tips: '4', tipped: null }] });
  const { info } = await fetchHatTipInfo(supabase, [7]);

  assert.deepEqual(info.get(7), { count: 4, tipped: false });
});

test('a failed request is reported, not thrown', async () => {
  const supabase = fakeSupabase({ rpcError: { message: 'function does not exist', code: 'PGRST202' } });
  const result = await fetchHatTipInfo(supabase, [1]);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PGRST202');
});

test('a request that throws is reported, not thrown', async () => {
  const supabase = fakeSupabase();

  supabase.rpc = async () => {
    throw new TypeError('Failed to fetch');
  };

  const result = await fetchHatTipInfo(supabase, [1]);

  assert.equal(result.ok, false);
  assert.ok(result.error instanceof TypeError);
});

// ---------- writing ----------

test('tipping inserts one row for the signed-in user', async () => {
  const supabase = fakeSupabase();
  const result = await setHatTip(supabase, { statusId: 5, userId: 'me', tipped: true });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(supabase.calls.insert, [{ status_id: 5, user_id: 'me' }]);
});

test('taking a hat tip back deletes only that user\'s row for that status', async () => {
  const supabase = fakeSupabase();
  const result = await setHatTip(supabase, { statusId: 5, userId: 'me', tipped: false });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(supabase.calls.delete, [{ status_id: 5, user_id: 'me' }]);
});

test('a duplicate tip (already tipped, say from another device) counts as success', async () => {
  const supabase = fakeSupabase({ write: async () => ({ error: { code: '23505', message: 'duplicate key' } }) });

  assert.deepEqual(await setHatTip(supabase, { statusId: 5, userId: 'me', tipped: true }), { ok: true });
});

test('a duplicate error is not forgiven when taking a tip back', async () => {
  const supabase = fakeSupabase({ write: async () => ({ error: { code: '23505', message: 'x' } }) });
  const result = await setHatTip(supabase, { statusId: 5, userId: 'me', tipped: false });

  assert.equal(result.ok, false);
});

test('any other database error is a plain failure', async () => {
  const supabase = fakeSupabase({ write: async () => ({ error: { code: '23503', message: 'foreign key' }, status: 409 }) });
  const result = await setHatTip(supabase, { statusId: 5, userId: 'me', tipped: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
  assert.equal(supabase.calls.getUser, 0, 'no need to check the session for a non-auth error');
});

test('a thrown network error is a plain failure', async () => {
  const supabase = fakeSupabase({
    write: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  const result = await setHatTip(supabase, { statusId: 5, userId: 'me', tipped: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
});

test('a rejected login with no user left means the session expired', async () => {
  for (const failure of [
    { status: 401, error: { message: 'JWT expired', code: 'PGRST301' } },
    { status: 403, error: { message: 'new row violates row-level security policy', code: '42501' } },
    { status: 400, error: { message: 'invalid JWT: token is expired' } },
  ]) {
    const supabase = fakeSupabase({ write: async () => failure, user: null });
    const result = await setHatTip(supabase, { statusId: 5, userId: 'me', tipped: true });

    assert.equal(result.reason, 'session-expired', JSON.stringify(failure));
  }
});

test('an auth-looking error while still signed in is a plain failure, not a sign-out', async () => {
  // For example a row-level-security refusal because the status is no longer public.
  const supabase = fakeSupabase({
    write: async () => ({ status: 403, error: { message: 'new row violates row-level security policy', code: '42501' } }),
    user: { id: 'me' },
  });
  const result = await setHatTip(supabase, { statusId: 5, userId: 'me', tipped: true });

  assert.equal(result.reason, 'failed');
  assert.equal(supabase.calls.getUser, 1);
});

// ---------- the shared store ----------

async function loadedStore(overrides = {}, rows = [row(1, 2, false), row(2, 0, true)]) {
  const supabase = fakeSupabase({ rows, ...overrides });
  const store = createHatTipStore(supabase);

  await store.load([1, 2]);

  return { supabase, store };
}

test('loading fills the store and tells listeners which statuses changed', async () => {
  const supabase = fakeSupabase({ rows: [row(1, 2), row(2, 0, true)] });
  const store = createHatTipStore(supabase);
  const heard = [];

  store.subscribe((ids) => heard.push(ids));

  const result = await store.load([1, 2, 3]);

  assert.deepEqual(result, { ok: true, missing: [3] });
  assert.deepEqual(store.get(1), { count: 2, tipped: false, pending: false });
  assert.deepEqual(store.get(2), { count: 0, tipped: true, pending: false });
  assert.equal(store.get(3), null, 'a status the database did not return stays unknown');
  assert.deepEqual(heard, [[1, 2]]);
});

test('a failed load leaves the store as it was', async () => {
  const supabase = fakeSupabase({ rpcError: { message: 'nope' } });
  const store = createHatTipStore(supabase);
  const result = await store.load([1]);

  assert.equal(result.ok, false);
  assert.equal(store.get(1), null);
});

test('tipping updates the count and icon state straight away, before the save finishes', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { store } = await loadedStore({ write: async () => (await gate, { error: null }) });
  const seen = [];

  store.subscribe((ids) => seen.push({ ids, state: store.get(1) }));

  const pending = store.toggle(1, 'me');

  assert.deepEqual(store.get(1), { count: 3, tipped: true, pending: true }, 'updated before the request finishes');

  release();

  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(store.get(1), { count: 3, tipped: true, pending: false });
  assert.equal(seen.length, 2);
});

test('tipping again takes the hat tip back', async () => {
  const { supabase, store } = await loadedStore();

  await store.toggle(1, 'me');
  await store.toggle(1, 'me');

  assert.deepEqual(store.get(1), { count: 2, tipped: false, pending: false });
  assert.equal(supabase.calls.insert.length, 1);
  assert.equal(supabase.calls.delete.length, 1);
});

test('a failed save puts the previous state back and says why', async () => {
  const { store } = await loadedStore({ write: async () => ({ error: { message: 'boom' } }) });
  const states = [];

  store.subscribe(() => states.push(store.get(1)));

  const result = await store.toggle(1, 'me');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
  assert.deepEqual(states.map((s) => [s.count, s.tipped]), [[3, true], [2, false]], 'optimistic, then restored');
  assert.deepEqual(store.get(1), { count: 2, tipped: false, pending: false });
});

test('a failed save of a take-back also restores the hat', async () => {
  const { store } = await loadedStore({ write: async () => ({ error: { message: 'boom' } }) });

  const result = await store.toggle(2, 'me');

  assert.equal(result.ok, false);
  assert.deepEqual(store.get(2), { count: 0, tipped: true, pending: false });
});

test('an expired session restores the state and reports it', async () => {
  const { store } = await loadedStore({
    write: async () => ({ status: 401, error: { message: 'JWT expired', code: 'PGRST301' } }),
    user: null,
  });

  const result = await store.toggle(1, 'me');

  assert.equal(result.reason, 'session-expired');
  assert.deepEqual(store.get(1), { count: 2, tipped: false, pending: false });
});

test('rapid repeated taps send one request and the rest are ignored', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { supabase, store } = await loadedStore({ write: async () => (await gate, { error: null }) });

  const first = store.toggle(1, 'me');
  const second = await store.toggle(1, 'me');
  const third = await store.toggle(1, 'me');

  assert.deepEqual(second, { ok: false, reason: 'busy' });
  assert.deepEqual(third, { ok: false, reason: 'busy' });

  release();
  await first;

  assert.equal(supabase.calls.insert.length + supabase.calls.delete.length, 1);
  assert.deepEqual(store.get(1), { count: 3, tipped: true, pending: false });
});

test('different statuses can be tipped at the same time', async () => {
  const { supabase, store } = await loadedStore();

  await Promise.all([store.toggle(1, 'me'), store.toggle(2, 'me')]);

  assert.equal(supabase.calls.insert.length + supabase.calls.delete.length, 2);
});

test('a status that was never loaded cannot be tipped', async () => {
  const { supabase, store } = await loadedStore();

  assert.deepEqual(await store.toggle(99, 'me'), { ok: false, reason: 'unknown' });
  assert.equal(supabase.calls.insert.length, 0);
});

test('the count never goes below zero', async () => {
  // The visitor is marked as tipped but the count says 0 (the numbers were read at
  // different moments); taking the tip back must not show -1.
  const { store } = await loadedStore({}, [row(1, 0, true)]);

  await store.toggle(1, 'me');

  assert.deepEqual(store.get(1), { count: 0, tipped: false, pending: false });
});

test('your own statuses can be tipped like any other (the store does not tell them apart)', async () => {
  const { supabase, store } = await loadedStore();

  assert.deepEqual(await store.toggle(1, 'the-author'), { ok: true });
  assert.deepEqual(supabase.calls.insert, [{ status_id: 1, user_id: 'the-author' }]);
});

test('a reload does not overwrite a tip that is being saved', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { supabase, store } = await loadedStore({ write: async () => (await gate, { error: null }) });

  const saving = store.toggle(1, 'me');

  supabase.calls.rpc.length = 0;
  await store.load([1]); // the answer was computed before the tip landed

  assert.deepEqual(store.get(1), { count: 3, tipped: true, pending: true });

  release();
  await saving;
});

test('an answer that was already on its way when someone tapped is thrown away', async () => {
  const supabase = fakeSupabase({ rows: [row(1, 2, false)] });
  const store = createHatTipStore(supabase);

  await store.load([1]);

  // Start a reload, and let a tap start and finish before its answer comes back.
  let answer;
  supabase.rpc = async () => new Promise((resolve) => {
    answer = () => resolve({ data: [row(1, 2, false)], error: null });
  });

  const reloading = store.load([1]);

  await store.toggle(1, 'me');
  answer();
  await reloading;

  assert.deepEqual(store.get(1), { count: 3, tipped: true, pending: false });
});

test('signing out forgets which statuses are yours but keeps the counts', async () => {
  const { store } = await loadedStore({}, [row(1, 2, true), row(2, 5, true), row(3, 1, false)]);
  const heard = [];

  await store.load([1, 2, 3]);
  store.subscribe((ids) => heard.push(ids));
  store.clearTipped();

  assert.deepEqual(store.get(1), { count: 2, tipped: false, pending: false });
  assert.deepEqual(store.get(2), { count: 5, tipped: false, pending: false });
  assert.deepEqual(store.get(3), { count: 1, tipped: false, pending: false });
  assert.deepEqual(heard, [[1, 2]], 'only the ones that changed are announced');
});

test('listeners can stop listening', async () => {
  const { store } = await loadedStore();
  let heard = 0;
  const stop = store.subscribe(() => {
    heard += 1;
  });

  await store.toggle(1, 'me');
  stop();
  await store.toggle(1, 'me');

  assert.equal(heard, 2);
});
