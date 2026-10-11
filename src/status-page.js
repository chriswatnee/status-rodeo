// Link previews for a status page. Chat apps and social sites build the little card shown when
// someone pastes /statuses/<id> from the HTML the server sends (they do not run the app's
// JavaScript), so the Cloudflare function in functions/statuses/[id]/index.js takes the app
// shell for that address and, when the status is public, adds Open Graph tags to the head:
// the author, the start of the text and the author's avatar. Like src/user-page.js it fails
// soft (the page is sent unchanged on any problem) and takes the HTMLRewriter class and the
// avatar check as arguments so it can be unit tested without Cloudflare.
import { SITE_URL, cleanXmlText, plainTitle, statusUrl } from './rss.js';
import { parseStatusId } from './status-id.js';
import { escapeAttribute } from './user-page.js';

export const LOOKUP_TIMEOUT_MS = 1500;

// How much of the status the preview shows. Apps cut it themselves, usually near this length.
export const DESCRIPTION_LIMIT = 200;

// Used when the author has no avatar file (the mobile crop of the masthead, 1250x402).
const FALLBACK_IMAGE = { path: '/masthead-mobile.webp', width: 1250, height: 402, alt: 'Status Rodeo' };

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`status lookup took over ${ms} ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function findStatus(supabase, id) {
  const { data, error } = await supabase
    .from('statuses')
    .select('id, content, profiles(display_name, username)')
    .eq('id', id)
    .eq('visibility', 'public')
    .maybeSingle();

  if (error) throw error;

  return data;
}

// The tags for one status. `hasAvatar` says whether /avatars/<username>.webp exists.
export function previewMarkup({ id, content, profiles: author }, hasAvatar) {
  const name = author?.display_name ?? 'Status Rodeo';
  const title = author ? `Status by ${name} (@${author.username})` : 'Status';
  const image = hasAvatar
    ? { path: `/avatars/${encodeURIComponent(author.username)}.webp`, width: 512, height: 512, alt: `${name}'s avatar` }
    : FALLBACK_IMAGE;
  const tags = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Status Rodeo'],
    ['property', 'og:title', title],
    ['property', 'og:description', plainTitle(cleanXmlText(content), DESCRIPTION_LIMIT)],
    ['property', 'og:url', statusUrl(id)],
    ['property', 'og:image', SITE_URL + image.path],
    ['property', 'og:image:width', String(image.width)],
    ['property', 'og:image:height', String(image.height)],
    ['property', 'og:image:alt', image.alt],
    ['name', 'twitter:card', 'summary'],
  ];

  return tags
    .map(([attribute, key, value]) => `<meta ${attribute}="${key}" content="${escapeAttribute(value)}" />`)
    .join('\n    ')
    .concat('\n  ');
}

// Returns the response unchanged, or a copy with the preview tags added to the head.
export async function statusPage(
  supabase,
  request,
  idText,
  response,
  { Rewriter = globalThis.HTMLRewriter, avatarExists = async () => false, timeoutMs = LOOKUP_TIMEOUT_MS } = {}
) {
  if (request.method !== 'GET' || !response.ok || !Rewriter) return response;
  if (!response.headers.get('Content-Type')?.includes('text/html')) return response;

  const id = parseStatusId(idText);

  if (id === null) return response;

  let status;
  let hasAvatar = false;

  try {
    status = await withTimeout(findStatus(supabase, id), timeoutMs);

    if (status?.profiles?.username) {
      hasAvatar = await withTimeout(avatarExists(status.profiles.username), timeoutMs).catch(() => false);
    }
  } catch (error) {
    console.warn('Link preview skipped:', error);

    return response;
  }

  if (!status) return response;

  const markup = previewMarkup(status, hasAvatar);
  const rewritten = new Rewriter()
    .on('head', {
      element(element) {
        element.append(markup, { html: true });
      },
    })
    .transform(response);

  // The body no longer matches the file's validator, so it must not be revalidated with it.
  const result = new Response(rewritten.body, rewritten);
  result.headers.delete('ETag');

  return result;
}
