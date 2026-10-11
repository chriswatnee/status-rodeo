import test from 'node:test';
import assert from 'node:assert/strict';
import { setAvatar } from '../src/set-avatar.js';

// A stand-in for the Supabase client. `answer` is what the update returns (or a function
// that throws); `user` is what auth.getUser() finds.
function fakeSupabase({ answer = { data: [{ avatar: 'cactus' }], error: null }, user = { id: 'me' } } = {}) {
  const calls = { update: [], eq: [], select: [], getUser: 0 };

  return {
    calls,
    from(table) {
      assert.equal(table, 'profiles');

      const chain = {
        update(values) {
          calls.update.push(values);

          return chain;
        },
        eq(column, value) {
          calls.eq.push([column, value]);

          return chain;
        },
        select(columns) {
          calls.select.push(columns);

          return typeof answer === 'function' ? answer() : Promise.resolve(answer);
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

test('updates only the avatar column of the user\'s own row', async () => {
  const supabase = fakeSupabase();
  const result = await setAvatar(supabase, { userId: 'u1', avatar: 'cactus' });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(supabase.calls.update, [{ avatar: 'cactus' }]);
  assert.deepEqual(supabase.calls.eq, [['user_id', 'u1']]);
  assert.deepEqual(supabase.calls.select, ['avatar']);
});

test('a name that is not an icon is refused without a request', async () => {
  const supabase = fakeSupabase();

  for (const avatar of ['nope', '', '../x', undefined, 'Cactus']) {
    const result = await setAvatar(supabase, { userId: 'u1', avatar });

    assert.deepEqual(result, { ok: false, reason: 'unknown' });
  }

  assert.equal(supabase.calls.update.length, 0);
});

test('an update that changed no row is a failure, not a success', async () => {
  // A refused update (someone else's row, a policy) is not an error to PostgREST.
  for (const data of [[], null, [{ avatar: 'a' }, { avatar: 'b' }]]) {
    const result = await setAvatar(fakeSupabase({ answer: { data, error: null } }), { userId: 'u1', avatar: 'cactus' });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'failed');
  }
});

test('a server error is a failure and keeps the login', async () => {
  const supabase = fakeSupabase({ answer: { data: null, error: { code: '500', message: 'boom' }, status: 500 } });
  const result = await setAvatar(supabase, { userId: 'u1', avatar: 'cactus' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
  assert.equal(supabase.calls.getUser, 0);
});

test('a network error that throws is a failure', async () => {
  const supabase = fakeSupabase({
    answer: () => {
      throw new TypeError('Failed to fetch');
    },
  });
  const result = await setAvatar(supabase, { userId: 'u1', avatar: 'cactus' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
});

test('a refusal because the login is gone is a session expiry', async () => {
  for (const answer of [
    { data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
    { data: null, error: { code: '42501', message: 'permission denied' }, status: 403 },
    { data: null, error: { message: 'JWT expired' }, status: 400 },
  ]) {
    const supabase = fakeSupabase({ answer, user: null });
    const result = await setAvatar(supabase, { userId: 'u1', avatar: 'cactus' });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'session-expired');
    assert.equal(supabase.calls.getUser, 1);
  }
});

test('a permission error while still signed in is a plain failure', async () => {
  const supabase = fakeSupabase({
    answer: { data: null, error: { code: '42501', message: 'permission denied' }, status: 403 },
  });
  const result = await setAvatar(supabase, { userId: 'u1', avatar: 'cactus' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
  assert.equal(supabase.calls.getUser, 1);
});
