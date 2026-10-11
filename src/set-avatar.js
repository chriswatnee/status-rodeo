// Saves the signed-in user's chosen avatar icon. No DOM; takes the Supabase client so it can be
// unit tested. Never throws.
//
// Result: { ok: true } or { ok: false, reason }, where reason is
//   'unknown'          the name is not one of the icons (nothing was sent)
//   'session-expired'  there is no signed-in user any more
//   'failed'           anything else, including an update that changed no row (the policy
//                      only lets you update your own row, and a refused update is not an
//                      error to PostgREST, so the row count is checked)
import { isAvatarName } from './avatar-icons.js';

// Postgres and PostgREST say "no permission" in a few ways: no usable login (401,
// PGRST301/303, or a JWT message) or a row-level-security refusal (42501).
function looksLikeAuthProblem(error, status) {
  return (
    status === 401 ||
    ['PGRST301', 'PGRST303', '42501'].includes(error?.code) ||
    /jwt/i.test(error?.message ?? '')
  );
}

export async function setAvatar(supabase, { userId, avatar }) {
  if (!isAvatarName(avatar)) return { ok: false, reason: 'unknown' };

  let data;
  let error;
  let status;

  try {
    ({ data, error, status } = await supabase
      .from('profiles')
      .update({ avatar })
      .eq('user_id', userId)
      .select('avatar'));
  } catch (thrown) {
    error = thrown;
  }

  if (!error && Array.isArray(data) && data.length === 1) return { ok: true };

  if (error && looksLikeAuthProblem(error, status)) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData?.user) return { ok: false, reason: 'session-expired', error };
  }

  return { ok: false, reason: 'failed', error: error ?? new Error('no profile row was updated') };
}
