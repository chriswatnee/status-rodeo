import { createClient } from '@supabase/supabase-js';
import { userFeed } from '../../../src/feed.js';

// /users/<username>/feed.xml: that user's 30 newest public statuses, as RSS 2.0.
export function onRequest({ env, params, request }) {
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

  return userFeed(supabase, request, params.username);
}
