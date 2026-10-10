// Hat Tips, Status Rodeo's friendly "like". This module holds the rules and has no DOM,
// so it can be unit tested (tests/hat-tips.test.js). The button itself is built in
// src/main.js. The database side is in supabase/hat-tips.sql.

// hat_tip_info() looks at no more than this many ids per call (see the migration).
export const HAT_TIP_BATCH_LIMIT = 100;

export function hatTipCountText(count) {
  return `${count} hat ${count === 1 ? 'tip' : 'tips'}`;
}

// Counts and the signed-in visitor's own state for several statuses in one request.
// Statuses the database does not return (not public, or gone) are simply absent from
// `info`. Never throws.
export async function fetchHatTipInfo(supabase, statusIds) {
  const ids = [...new Set(statusIds)];
  const info = new Map();

  for (let start = 0; start < ids.length; start += HAT_TIP_BATCH_LIMIT) {
    const batch = ids.slice(start, start + HAT_TIP_BATCH_LIMIT);
    let response;

    try {
      response = await supabase.rpc('hat_tip_info', { status_ids: batch });
    } catch (error) {
      return { ok: false, error };
    }

    const { data, error } = response;

    if (error) return { ok: false, error };

    for (const row of data ?? []) {
      info.set(row.status_id, { count: Number(row.tips), tipped: Boolean(row.tipped) });
    }
  }

  return { ok: true, info };
}

// Postgres and PostgREST say "no permission" in a few ways: no usable login (401,
// PGRST301/303, or a JWT message) or a row-level-security refusal (42501).
function looksLikeAuthProblem(error, status) {
  return (
    status === 401 ||
    ['PGRST301', 'PGRST303', '42501'].includes(error.code) ||
    /jwt/i.test(error.message ?? '')
  );
}

// Writes the wanted state: tipped = true adds the hat tip, false takes it back. Both
// are safe to repeat (a duplicate means it was already tipped, for example from
// another device; deleting a tip that is not there changes nothing). Never throws.
// Failures are 'session-expired' (there is no signed-in user any more) or 'failed'.
export async function setHatTip(supabase, { statusId, userId, tipped }) {
  let error;
  let status;

  try {
    const response = tipped
      ? await supabase.from('hat_tips').insert({ status_id: statusId, user_id: userId })
      : await supabase
          .from('hat_tips')
          .delete()
          .eq('status_id', statusId)
          .eq('user_id', userId);

    ({ error, status } = response);
  } catch (thrown) {
    error = thrown;
  }

  if (!error || (tipped && error.code === '23505')) return { ok: true };

  if (looksLikeAuthProblem(error, status)) {
    const { data, error: userError } = await supabase.auth.getUser();

    if (userError || !data?.user) return { ok: false, reason: 'session-expired', error };
  }

  return { ok: false, reason: 'failed', error };
}

// What every hat tip control on the page shows, keyed by status id, so the same
// status reads the same wherever it appears. Tapping updates the count at once
// (optimistically) and puts it back if the save fails. A status handles one save at a
// time, so rapid taps can't send conflicting requests.
//
//   get(id)            { count, tipped, pending } or null if not loaded
//   subscribe(fn)      fn(ids) runs after those statuses change; returns an unsubscribe
//   load(ids)          one request for all of them; { ok, missing } (missing: not returned)
//   toggle(id, userId) { ok } or { ok: false, reason: 'busy' | 'unknown' | 'session-expired' | 'failed' }
//   clearTipped()      forget which ones are mine (on sign-out); counts stay
export function createHatTipStore(supabase) {
  const entries = new Map();
  const listeners = new Set();

  function notify(ids) {
    if (ids.length === 0) return;

    for (const listener of listeners) listener(ids);
  }

  return {
    get(id) {
      const entry = entries.get(id);

      return entry ? { count: entry.count, tipped: entry.tipped, pending: entry.pending } : null;
    },

    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },

    async load(statusIds) {
      const ids = [...new Set(statusIds)];
      // An answer that was already on its way when someone tapped is out of date.
      const versions = new Map(ids.map((id) => [id, entries.get(id)?.version ?? 0]));
      const result = await fetchHatTipInfo(supabase, ids);

      if (!result.ok) return { ok: false, error: result.error };

      const changed = [];
      const missing = [];

      for (const id of ids) {
        const info = result.info.get(id);

        if (!info) {
          missing.push(id);
          continue;
        }

        const entry = entries.get(id);

        if (entry && (entry.pending || entry.version !== versions.get(id))) continue;

        entries.set(id, { ...info, pending: false, version: (entry?.version ?? 0) });
        changed.push(id);
      }

      notify(changed);

      return { ok: true, missing };
    },

    async toggle(statusId, userId) {
      const entry = entries.get(statusId);

      if (!entry) return { ok: false, reason: 'unknown' };
      if (entry.pending) return { ok: false, reason: 'busy' };

      const previous = { count: entry.count, tipped: entry.tipped };
      const tipped = !entry.tipped;

      entry.tipped = tipped;
      entry.count = Math.max(0, entry.count + (tipped ? 1 : -1));
      entry.pending = true;
      entry.version += 1;
      notify([statusId]);

      const result = await setHatTip(supabase, { statusId, userId, tipped });

      entry.pending = false;

      if (!result.ok) {
        entry.count = previous.count;
        entry.tipped = previous.tipped;
      }

      notify([statusId]);

      return result;
    },

    clearTipped() {
      const changed = [];

      for (const [id, entry] of entries) {
        if (entry.tipped && !entry.pending) {
          entry.tipped = false;
          changed.push(id);
        }
      }

      notify(changed);
    },
  };
}
