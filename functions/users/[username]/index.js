import { createClient } from '@supabase/supabase-js';
import { userPage } from '../../../src/user-page.js';

// /users/<username>: the app's own page (the SPA fallback), with that user's RSS feed added
// to the head so feed readers can discover it. If anything goes wrong the page is sent as is.
export async function onRequest({ env, params, request, next }) {
  const response = await next();

  if (request.method !== 'GET') return response;

  try {
    const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

    return await userPage(supabase, request, params.username, response);
  } catch (error) {
    console.error(error);

    return response;
  }
}
