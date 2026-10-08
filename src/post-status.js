import { validateStatus } from './status-limit.js';

// Validates and inserts a status. Never throws: the result says what happened,
// so the caller can keep the composer text when the post fails.
export async function submitStatus(supabase, text) {
  const result = validateStatus(text);

  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return { ok: false, reason: 'not-signed-in', error };
  }

  const { error: insertError } = await supabase
    .from('statuses')
    .insert({
      user_id: data.user.id,
      content: result.content,
    });

  if (insertError) {
    return { ok: false, reason: 'insert-failed', error: insertError };
  }

  return { ok: true };
}
