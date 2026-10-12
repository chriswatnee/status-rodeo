// Saves a new text for one of the signed-in user's own statuses. No DOM; takes the Supabase
// client so it can be unit tested. Never throws.
//
// Only the content column can be updated from the browser (a column grant), and only on your own
// rows (a policy). A refused update is not an error to PostgREST: it just changes nothing. So the
// rows that come back are counted, and if there are none one more read tells "the status is gone"
// from "refused". The database sets `edited_at` itself, only when the text really changed.
//
// Result: { ok: true, content, editedAt } (what the database now holds; `editedAt` is null if
// the text was not changed), or { ok: false, reason } where reason is
//   'empty' / 'too-long'  the text breaks the length rule (nothing was sent)
//   'invalid'             the id is not a positive whole number (nothing was sent)
//   'gone'                the status no longer exists (deleted elsewhere)
//   'session-expired'     there is no signed-in user any more
//   'failed'              anything else, including an update that was refused
import { validateStatus } from './status-limit.js';

// Postgres and PostgREST say "no permission" in a few ways: no usable login (401,
// PGRST301/303, or a JWT message) or a row-level-security refusal (42501).
function looksLikeAuthProblem(error, status) {
  return (
    status === 401 ||
    ['PGRST301', 'PGRST303', '42501'].includes(error?.code) ||
    /jwt/i.test(error?.message ?? '')
  );
}

export async function updateStatus(supabase, { id, content }) {
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'invalid' };

  const checked = validateStatus(String(content ?? ''));

  if (!checked.ok) return { ok: false, reason: checked.reason };

  let data;
  let error;
  let status;

  try {
    ({ data, error, status } = await supabase
      .from('statuses')
      .update({ content: checked.content })
      .eq('id', id)
      .select('id, content, edited_at'));
  } catch (thrown) {
    error = thrown;
  }

  if (!error && Array.isArray(data) && data.length === 1) {
    return { ok: true, content: data[0].content, editedAt: data[0].edited_at ?? null };
  }

  if (error && looksLikeAuthProblem(error, status)) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData?.user) return { ok: false, reason: 'session-expired', error };
  }

  if (!error && Array.isArray(data) && data.length === 0) {
    try {
      const { data: row, error: readError } = await supabase.from('statuses').select('id').eq('id', id).maybeSingle();

      if (!readError && row === null) return { ok: false, reason: 'gone' };

      return { ok: false, reason: 'failed', error: readError ?? new Error('the status was not updated') };
    } catch (thrown) {
      return { ok: false, reason: 'failed', error: thrown };
    }
  }

  return { ok: false, reason: 'failed', error: error ?? new Error('unexpected answer') };
}
