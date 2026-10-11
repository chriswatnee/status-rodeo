import { createClient } from '@supabase/supabase-js';
import { statusPage } from '../../../src/status-page.js';

// /statuses/<id>: the app's own page (the SPA fallback), with Open Graph tags added to the head
// so a pasted link shows a preview card. If anything goes wrong the page is sent as is.
export async function onRequest({ env, params, request, next }) {
  const response = await next();

  if (request.method !== 'GET') return response;

  try {
    const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

    return await statusPage(supabase, request, params.id, response);
  } catch (error) {
    console.error(error);

    return response;
  }
}
