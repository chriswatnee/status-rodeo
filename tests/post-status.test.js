import test from 'node:test';
import assert from 'node:assert/strict';
import { submitStatus } from '../src/post-status.js';

// A minimal stand-in for the Supabase client that records inserts.
function fakeSupabase({ user = { id: 'user-1' }, userError = null, insertError = null } = {}) {
  const inserts = [];

  return {
    inserts,
    auth: { getUser: async () => ({ data: { user }, error: userError }) },
    from(table) {
      return {
        insert: async (row) => {
          inserts.push({ table, row });
          return { error: insertError };
        },
      };
    },
  };
}

test('a valid status is inserted trimmed, for the signed-in user', async () => {
  const supabase = fakeSupabase();
  const result = await submitStatus(supabase, '  Hello rodeo \n');

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(supabase.inserts, [
    { table: 'statuses', row: { user_id: 'user-1', content: 'Hello rodeo' } },
  ]);
});

test('an empty status is not inserted', async () => {
  const supabase = fakeSupabase();
  const result = await submitStatus(supabase, '   ');

  assert.deepEqual(result, { ok: false, reason: 'empty' });
  assert.equal(supabase.inserts.length, 0);
});

test('a status over 280 characters is not inserted', async () => {
  const supabase = fakeSupabase();
  const result = await submitStatus(supabase, 'x'.repeat(281));

  assert.deepEqual(result, { ok: false, reason: 'too-long' });
  assert.equal(supabase.inserts.length, 0);
});

test('a status of exactly 280 characters is inserted', async () => {
  const supabase = fakeSupabase();
  const result = await submitStatus(supabase, 'x'.repeat(280));

  assert.equal(result.ok, true);
  assert.equal(supabase.inserts.length, 1);
});

test('280 emoji are inserted, 281 are not', async () => {
  const ok = fakeSupabase();
  assert.equal((await submitStatus(ok, '👍'.repeat(280))).ok, true);

  const tooLong = fakeSupabase();
  assert.equal((await submitStatus(tooLong, '👍'.repeat(281))).reason, 'too-long');
  assert.equal(tooLong.inserts.length, 0);
});

test('a failed insert reports insert-failed and does not throw', async () => {
  const insertError = { code: '23514', message: 'check constraint violated' };
  const supabase = fakeSupabase({ insertError });
  const result = await submitStatus(supabase, 'hello');

  assert.deepEqual(result, { ok: false, reason: 'insert-failed', error: insertError });
});

test('no signed-in user means nothing is inserted', async () => {
  const supabase = fakeSupabase({ user: null });
  const result = await submitStatus(supabase, 'hello');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-signed-in');
  assert.equal(supabase.inserts.length, 0);
});

test('an auth error means nothing is inserted', async () => {
  const supabase = fakeSupabase({ userError: { message: 'jwt expired' } });
  const result = await submitStatus(supabase, 'hello');

  assert.equal(result.reason, 'not-signed-in');
  assert.equal(supabase.inserts.length, 0);
});
