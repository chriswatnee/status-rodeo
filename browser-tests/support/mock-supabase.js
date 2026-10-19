// A fake of src/supabase.js for the browser tests. It runs in the page and reads its settings and data
// from `window.__mock`, which harness.mjs sets before the app loads. Reads only (plus a session that
// can be signed in or out); nothing here talks to a real database.
//
// Settings on window.__mock:
//   signedIn      true to be signed in as user u1 (chris)
//   delay         ms every table query waits (simulates a slow network)
//   sessionDelay  ms getSession waits (default 0)
//   rpcDelay      ms the hat_tip_info call waits
//   db            { profiles, statuses, hat_tips }
const state = window.__mock;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function builder(table) {
  const q = { filters: [], order: null, limit: null, head: false, range: null, single: false, maybe: false };
  const b = {
    select(_columns, options) {
      if (options && options.head) q.head = true;
      return b;
    },
    eq(key, value) { q.filters.push((row) => row[key] === value); return b; },
    gt(key, value) { q.filters.push((row) => row[key] > value); return b; },
    lt(key, value) { q.filters.push((row) => row[key] < value); return b; },
    in(key, values) { q.filters.push((row) => values.includes(row[key])); return b; },
    order(key, options) { q.order = [key, !options || options.ascending !== false]; return b; },
    limit(n) { q.limit = n; return b; },
    range(from, to) { q.range = [from, to]; return b; },
    single() { q.single = true; return b; },
    maybeSingle() { q.maybe = true; return b; },
    then(resolve, reject) { return run().then(resolve, reject); },
  };

  async function run() {
    await sleep(state.delay || 0);
    let rows = state.db[table].filter((row) => q.filters.every((filter) => filter(row)));

    if (q.order) {
      const [key, ascending] = q.order;
      rows = [...rows].sort((a, c) => (a[key] < c[key] ? -1 : a[key] > c[key] ? 1 : 0) * (ascending ? 1 : -1));
    }

    const total = rows.length;
    if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
    if (q.limit != null) rows = rows.slice(0, q.limit);

    if (q.single) {
      return rows.length
        ? { data: rows[0], error: null }
        : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
    }

    if (q.maybe) return { data: rows[0] ?? null, error: null };
    if (q.head) return { data: null, count: total, error: null };

    if (table === 'statuses') {
      rows = rows.map((row) => ({ ...row, profiles: state.db.profiles.find((p) => p.user_id === row.user_id) }));
    }

    return { data: rows, error: null };
  }

  return b;
}

const me = () => (state.signedIn ? 'u1' : null);

export const supabase = {
  from: (table) => builder(table),

  async rpc(_name, args) {
    await sleep(state.rpcDelay || 0);
    const publicIds = new Set(state.db.statuses.filter((s) => s.visibility === 'public').map((s) => s.id));
    const rows = [...new Set(args.status_ids)]
      .filter((id) => publicIds.has(id))
      .map((id) => {
        const tips = (state.db.hat_tips || []).filter((t) => t.status_id === id);
        return { status_id: id, tips: tips.length, tipped: me() ? tips.some((t) => t.user_id === me()) : false };
      });

    return { data: rows, error: null };
  },

  auth: {
    getSession: async () => {
      await sleep(state.sessionDelay || 0);
      return { data: { session: me() ? { user: { id: 'u1' } } : null }, error: null };
    },
    getUser: async () => (me() ? { data: { user: { id: 'u1' } }, error: null } : { data: { user: null }, error: { message: 'Auth session missing!' } }),
    signInWithPassword: async () => {
      state.signedIn = true;
      return { data: { session: { user: { id: 'u1' } } }, error: null };
    },
    signOut: async () => {
      state.signedIn = false;
      return { error: null };
    },
  },
};
