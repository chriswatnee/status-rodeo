import { createClient } from '@supabase/supabase-js';
import { statusPage } from '../../../src/status-page.js';

// /statuses/<id>: the app's own page (the SPA fallback), with Open Graph tags added to the head
// so a pasted link shows a preview card. If anything goes wrong the page is sent as is.
export async function onRequest({ env, params, request, next }) {
  const response = await next();

  if (request.method !== 'GET') return response;

  try {
    const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

    // An avatar is a static file named by username. A missing file gets the SPA fallback (HTML),
    // so only an image answer counts.
    const avatarExists = async (username) => {
      const url = new URL(`/avatars/${encodeURIComponent(username)}.webp`, request.url);
      const answer = await env.ASSETS.fetch(url);

      return answer.ok && (answer.headers.get('Content-Type') ?? '').startsWith('image/');
    };

    return await statusPage(supabase, request, params.id, response, { avatarExists });
  } catch (error) {
    console.error(error);

    return response;
  }
}
