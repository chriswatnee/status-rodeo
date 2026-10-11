// Feed autodiscovery for a profile page. A feed reader given /users/<name> does not run the
// app's JavaScript, so it only sees the <link rel="alternate"> in the static index.html (the
// sitewide feed). The Cloudflare function in functions/users/[username]/index.js takes the
// app shell for that address and, when the user exists, adds that user's feed link in front of
// the sitewide one. Everything here fails soft: on any problem the page is sent unchanged,
// because a profile page must never break or wait on this. The HTMLRewriter class is passed
// in so this can be unit tested without Cloudflare (tests/user-page.test.js).
import { USERNAME } from './feed.js';

// A slow database must not hold up the page: after this the page is sent without the link.
export const LOOKUP_TIMEOUT_MS = 1500;

// Text for a double-quoted HTML attribute: control characters removed, whitespace collapsed.
export function escapeAttribute(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// The link tag for one user. The href is relative, like the sitewide one in index.html.
export function feedLinkMarkup({ username, display_name: displayName }) {
  const title = escapeAttribute(`${displayName} (@${username}) · Status Rodeo`);
  const href = escapeAttribute(`/users/${encodeURIComponent(username)}/feed.xml`);

  return `<link rel="alternate" type="application/rss+xml" title="${title}" href="${href}" />\n    `;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`profile lookup took over ${ms} ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function findProfile(supabase, username) {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('username', username)
    .maybeSingle();

  if (error) throw error;

  return data;
}

// Returns the response unchanged, or a copy with the user's feed link added to the head.
export async function userPage(
  supabase,
  request,
  username,
  response,
  { Rewriter = globalThis.HTMLRewriter, timeoutMs = LOOKUP_TIMEOUT_MS } = {}
) {
  if (request.method !== 'GET' || !response.ok || !Rewriter) return response;
  if (!response.headers.get('Content-Type')?.includes('text/html')) return response;
  if (typeof username !== 'string' || !USERNAME.test(username)) return response;

  let profile;

  try {
    profile = await withTimeout(findProfile(supabase, username), timeoutMs);
  } catch (error) {
    console.warn('Feed autodiscovery skipped:', error);

    return response;
  }

  if (!profile) return response;

  const markup = feedLinkMarkup(profile);
  const rewritten = new Rewriter()
    .on('link[rel="alternate"][type="application/rss+xml"]', {
      element(element) {
        element.before(markup, { html: true });
      },
    })
    .transform(response);

  // The body no longer matches the file's validator, so it must not be revalidated with it.
  const result = new Response(rewritten.body, rewritten);
  result.headers.delete('ETag');

  return result;
}
