import test from 'node:test';
import assert from 'node:assert/strict';
import { updateStatus } from '../src/update-status.js';

// A stand-in for the Supabase client. `updated` is what update().eq().select() returns (or a
// function that throws); `stillThere` is what the follow-up read finds; `user` is what
// auth.getUser() finds.
function fakeSupabase({
  updated = { data: [{ id: 7, content: 'new text', edited_at: '2026-10-12T14:00:00Z' }], error: null },
  stillThere = { data: { id: 7 }, error: null },
  user = { id: 'me' },
} = {}) {
  const calls = { update: [], eq: [], select: [], read: 0, getUser: 0 };

  return {
    calls,
    from(table) {
      assert.equal(table, 'statuses');

      let mode = null;
      const chain = {
        update(values) {
          calls.update.push(values);
          mode = 'update';

          return chain;
        },
        eq(column, value) {
          calls.eq.push([mode ?? 'read', column, value]);

          return chain;
        },
        select(columns) {
          calls.select.push(columns);

          if (mode === 'update') return typeof updated === 'function' ? updated() : Promise.resolve(updated);

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

test('updates only the content of that status and returns what the database holds', async () => {
  const supabase = fakeSupabase();
  const result = await updateStatus(supabase, { id: 7, content: 'new text' });

  assert.deepEqual(result, { ok: true, content: 'new text', editedAt: '2026-10-12T14:00:00Z' });
  assert.deepEqual(supabase.calls.update, [{ content: 'new text' }]);
  assert.deepEqual(supabase.calls.eq, [['update', 'id', 7]]);
  assert.deepEqual(supabase.calls.select, ['id, content, edited_at']);
  assert.equal(supabase.calls.read, 0);
});

test('the text is trimmed before it is sent; the answer is what the database says', async () => {
  const supabase = fakeSupabase({ updated: { data: [{ id: 7, content: 'trimmed', edited_at: null }], error: null } });
  const result = await updateStatus(supabase, { id: 7, content: '  trimmed \n' });

  assert.deepEqual(supabase.calls.update, [{ content: 'trimmed' }]);
  assert.deepEqual(result, { ok: true, content: 'trimmed', editedAt: null });
});

test('empty, blank and over-280 text are refused without a request', async () => {
  const supabase = fakeSupabase();

  assert.deepEqual(await updateStatus(supabase, { id: 7, content: '' }), { ok: false, reason: 'empty' });
  assert.deepEqual(await updateStatus(supabase, { id: 7, content: '  \n ' }), { ok: false, reason: 'empty' });
  assert.deepEqual(await updateStatus(supabase, { id: 7, content: null }), { ok: false, reason: 'empty' });
  assert.deepEqual(await updateStatus(supabase, { id: 7, content: 'x'.repeat(281) }), { ok: false, reason: 'too-long' });
  assert.equal(supabase.calls.update.length, 0);

  assert.equal((await updateStatus(supabase, { id: 7, content: 'x'.repeat(280) })).ok, true);
  // 280 emoji are 280 characters, not 560
  assert.equal((await updateStatus(supabase, { id: 7, content: '👍'.repeat(280) })).ok, true);
  assert.equal((await updateStatus(supabase, { id: 7, content: '👍'.repeat(281) })).reason, 'too-long');
});

test('an id that is not a positive whole number is refused without a request', async () => {
  const supabase = fakeSupabase();

  for (const id of [0, -1, 1.5, NaN, '7', null, undefined, 2 ** 60]) {
    assert.deepEqual(await updateStatus(supabase, { id, content: 'ok' }), { ok: false, reason: 'invalid' }, String(id));
  }

  assert.equal(supabase.calls.update.length, 0);
});

test('nothing updated and the status is gone: "gone"', async () => {
  const supabase = fakeSupabase({ updated: { data: [], error: null }, stillThere: { data: null, error: null } });

  assert.deepEqual(await updateStatus(supabase, { id: 7, content: 'x' }), { ok: false, reason: 'gone' });
  assert.equal(supabase.calls.read, 1);
});

test('nothing updated and the status is still there: the update was refused', async () => {
  const supabase = fakeSupabase({ updated: { data: [], error: null }, stillThere: { data: { id: 7 }, error: null } });
  const result = await updateStatus(supabase, { id: 7, content: 'x' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
});

test('nothing updated and the follow-up read fails or throws: failed, not gone', async () => {
  const failing = fakeSupabase({ updated: { data: [], error: null }, stillThere: { data: null, error: { message: 'boom' } } });

  assert.equal((await updateStatus(failing, { id: 7, content: 'x' })).reason, 'failed');

  const throwing = fakeSupabase({
    updated: { data: [], error: null },
    stillThere: () => {
      throw new Error('network');
    },
  });

  assert.equal((await updateStatus(throwing, { id: 7, content: 'x' })).reason, 'failed');
});

test('a database error is a failure; the login is only checked for permission-like errors', async () => {
  const plain = fakeSupabase({ updated: { data: null, error: { code: '500', message: 'boom' }, status: 500 } });

  assert.equal((await updateStatus(plain, { id: 7, content: 'x' })).reason, 'failed');
  assert.equal(plain.calls.getUser, 0);

  const check = fakeSupabase({ updated: { data: null, error: { code: '23514', message: 'check violation' }, status: 400 } });

  assert.equal((await updateStatus(check, { id: 7, content: 'x' })).reason, 'failed');

  const expired = fakeSupabase({
    updated: { data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
    user: null,
  });

  assert.equal((await updateStatus(expired, { id: 7, content: 'x' })).reason, 'session-expired');
  assert.equal(expired.calls.getUser, 1);
});

test('a permission error while still signed in is a plain failure', async () => {
  const supabase = fakeSupabase({ updated: { data: null, error: { code: '42501', message: 'denied' }, status: 403 } });

  assert.equal((await updateStatus(supabase, { id: 7, content: 'x' })).reason, 'failed');
  assert.equal(supabase.calls.getUser, 1);
});

test('a thrown error never escapes', async () => {
  const supabase = fakeSupabase({
    updated: () => {
      throw new Error('network down');
    },
  });
  const result = await updateStatus(supabase, { id: 7, content: 'x' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
  assert.match(result.error.message, /network down/);
});

test('more than one row back is not treated as success', async () => {
  const supabase = fakeSupabase({
    updated: { data: [{ id: 7, content: 'a', edited_at: null }, { id: 8, content: 'b', edited_at: null }], error: null },
  });

  assert.equal((await updateStatus(supabase, { id: 7, content: 'a' })).ok, false);
});
