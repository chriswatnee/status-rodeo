import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteStatus } from '../src/delete-status.js';

// A stand-in for the Supabase client. `deleted` is what delete().eq().select() returns (or a
// function that throws); `stillThere` is what the follow-up read finds; `user` is what
// auth.getUser() finds.
function fakeSupabase({
  deleted = { data: [{ id: 7 }], error: null },
  stillThere = { data: null, error: null },
  user = { id: 'me' },
} = {}) {
  const calls = { delete: 0, eq: [], select: [], read: 0, getUser: 0 };

  return {
    calls,
    from(table) {
      assert.equal(table, 'statuses');

      let mode = null;
      const chain = {
        delete() {
          calls.delete += 1;
          mode = 'delete';

          return chain;
        },
        eq(column, value) {
          calls.eq.push([mode ?? 'read', column, value]);

          return chain;
        },
        select(columns) {
          calls.select.push(columns);

          if (mode === 'delete') return typeof deleted === 'function' ? deleted() : Promise.resolve(deleted);

          mode = 'read';

          return chain;
        },
        async maybeSingle() {
          calls.read += 1;

          return typeof stillThere === 'function' ? stillThere() : stillThere;
        },
      };

      return chain;
    },
    auth: {
      async getUser() {
        calls.getUser += 1;

        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'no session' } };
      },
    },
  };
}

test('deletes the one status by id and asks for the row back', async () => {
  const supabase = fakeSupabase();
  const result = await deleteStatus(supabase, { id: 7 });

  assert.deepEqual(result, { ok: true });
  assert.equal(supabase.calls.delete, 1);
  assert.deepEqual(supabase.calls.eq, [['delete', 'id', 7]]);
  assert.deepEqual(supabase.calls.select, ['id']);
  assert.equal(supabase.calls.read, 0);
});

test('an id that is not a positive whole number is refused without a request', async () => {
  const supabase = fakeSupabase();

  for (const id of [0, -1, 1.5, NaN, Infinity, '7', null, undefined, 2 ** 60]) {
    assert.deepEqual(await deleteStatus(supabase, { id }), { ok: false, reason: 'invalid' }, String(id));
  }

  assert.equal(supabase.calls.delete, 0);
});

test('nothing deleted and the status is gone: it counts as done (deleted elsewhere)', async () => {
  const supabase = fakeSupabase({ deleted: { data: [], error: null }, stillThere: { data: null, error: null } });

  assert.deepEqual(await deleteStatus(supabase, { id: 7 }), { ok: true });
  assert.equal(supabase.calls.read, 1);
});

test('nothing deleted and the status is still there: the delete was refused', async () => {
  const supabase = fakeSupabase({ deleted: { data: [], error: null }, stillThere: { data: { id: 7 }, error: null } });
  const result = await deleteStatus(supabase, { id: 7 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
});

test('nothing deleted and the follow-up read fails: failed, not done', async () => {
  const supabase = fakeSupabase({
    deleted: { data: [], error: null },
    stillThere: { data: null, error: { message: 'boom' } },
  });

  assert.equal((await deleteStatus(supabase, { id: 7 })).reason, 'failed');

  const throwing = fakeSupabase({
    deleted: { data: [], error: null },
    stillThere: () => {
      throw new Error('network');
    },
  });

  assert.equal((await deleteStatus(throwing, { id: 7 })).reason, 'failed');
});

test('a database error is a failure and the login is only checked for permission-like errors', async () => {
  const plain = fakeSupabase({ deleted: { data: null, error: { code: '500', message: 'boom' }, status: 500 } });

  assert.equal((await deleteStatus(plain, { id: 7 })).reason, 'failed');
  assert.equal(plain.calls.getUser, 0);

  const expired = fakeSupabase({
    deleted: { data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
    user: null,
  });

  assert.equal((await deleteStatus(expired, { id: 7 })).reason, 'session-expired');
  assert.equal(expired.calls.getUser, 1);
});

test('a permission error while still signed in is a plain failure', async () => {
  const supabase = fakeSupabase({
    deleted: { data: null, error: { code: '42501', message: 'permission denied' }, status: 403 },
  });

  assert.equal((await deleteStatus(supabase, { id: 7 })).reason, 'failed');
  assert.equal(supabase.calls.getUser, 1);
});

test('a thrown error never escapes', async () => {
  const supabase = fakeSupabase({
    deleted: () => {
      throw new Error('network down');
    },
  });
  const result = await deleteStatus(supabase, { id: 7 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
  assert.match(result.error.message, /network down/);
});

test('more than one row back is not treated as success', async () => {
  const supabase = fakeSupabase({ deleted: { data: [{ id: 7 }, { id: 8 }], error: null } });

  assert.equal((await deleteStatus(supabase, { id: 7 })).ok, false);
});
