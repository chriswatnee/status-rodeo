import { createClient } from '@supabase/supabase-js';
import { sitewideFeed } from '../src/feed.js';

// /feed.xml: the 30 newest public statuses from everyone, as RSS 2.0.
export function onRequest({ env, request }) {
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

  return sitewideFeed(supabase, request);
}
