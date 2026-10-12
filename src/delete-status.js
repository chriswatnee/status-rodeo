// Deletes one of the signed-in user's own statuses. No DOM; takes the Supabase client so it can
// be unit tested. Never throws.
//
// The database lets you delete only your own rows (the policy "Users can delete their own
// statuses"), and a refused delete is not an error to PostgREST: it just deletes nothing. So the
// rows that come back are counted. If nothing was deleted, one more read tells "already gone"
// (fine: it is what the visitor wanted, e.g. deleted in another tab) from "still there" (refused).
// Hat tips on the status go with it (ON DELETE CASCADE in the database).
//
// Result: { ok: true } or { ok: false, reason }, where reason is
//   'invalid'          the id is not a positive whole number (nothing was sent)
//   'session-expired'  there is no signed-in user any more
//   'failed'           anything else, including a delete that was refused

// Postgres and PostgREST say "no permission" in a few ways: no usable login (401,
// PGRST301/303, or a JWT message) or a row-level-security refusal (42501).
function looksLikeAuthProblem(error, status) {
  return (
    status === 401 ||
    ['PGRST301', 'PGRST303', '42501'].includes(error?.code) ||
    /jwt/i.test(error?.message ?? '')
  );
}

export async function deleteStatus(supabase, { id }) {
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'invalid' };

  let data;
  let error;
  let status;

  try {
    ({ data, error, status } = await supabase.from('statuses').delete().eq('id', id).select('id'));
  } catch (thrown) {
    error = thrown;
  }

  if (!error && Array.isArray(data) && data.length === 1) return { ok: true };

  if (error && looksLikeAuthProblem(error, status)) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData?.user) return { ok: false, reason: 'session-expired', error };
  }

  if (!error && Array.isArray(data) && data.length === 0) {
    try {
      const { data: row, error: readError } = await supabase.from('statuses').select('id').eq('id', id).maybeSingle();

      if (!readError && row === null) return { ok: true };

      return { ok: false, reason: 'failed', error: readError ?? new Error('the status was not deleted') };
    } catch (thrown) {
      return { ok: false, reason: 'failed', error: thrown };
    }
  }

  return { ok: false, reason: 'failed', error: error ?? new Error('unexpected answer') };
}
