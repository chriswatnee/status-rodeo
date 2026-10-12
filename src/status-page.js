// Link previews for a status page. Chat apps and social sites build the little card shown when
// someone pastes /statuses/<id> from the HTML the server sends (they do not run the app's
// JavaScript), so the Cloudflare function in functions/statuses/[id]/index.js takes the app
// shell for that address and, when the status is public, adds Open Graph tags to the head:
// the author, the start of the text and the author's avatar icon. Like src/user-page.js it
// fails soft (the page is sent unchanged on any problem) and takes the HTMLRewriter class as an
// argument so it can be unit tested without Cloudflare.
import { avatarLabel, avatarPath } from './avatar-icons.js';
import { PREVIEW_TAGS_SELECTOR, previewTagsMarkup } from './preview-tags.js';
import { cleanXmlText, plainTitle, statusUrl } from './rss.js';
import { parseStatusId } from './status-id.js';

export const LOOKUP_TIMEOUT_MS = 1500;

// How much of the status the preview shows. Apps cut it themselves, usually near this length.
export const DESCRIPTION_LIMIT = 200;

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
    .select('id, content, profiles(display_name, username, avatar)')
    .eq('id', id)
    .eq('visibility', 'public')
    .maybeSingle();

  if (error) throw error;

  return data;
}

// The tags for one status. The picture is the author's avatar icon (512x512); a value that is
// not one of the icons shows the default icon (see src/avatar-icons.js).
export function previewMarkup({ id, content, profiles: author }) {
  const name = author?.display_name ?? 'Status Rodeo';

  return previewTagsMarkup({
    title: author ? `Status by ${name} (@${author.username})` : 'Status',
    description: plainTitle(cleanXmlText(content), DESCRIPTION_LIMIT),
    url: statusUrl(id),
    imagePath: avatarPath(author?.avatar),
    imageAlt: `${name}'s avatar: ${avatarLabel(author?.avatar).toLowerCase()}`,
  });
}

// Returns the response unchanged, or a copy with the preview tags added to the head.
export async function statusPage(
  supabase,
  request,
  idText,
  response,
  { Rewriter = globalThis.HTMLRewriter, timeoutMs = LOOKUP_TIMEOUT_MS } = {}
) {
  if (request.method !== 'GET' || !response.ok || !Rewriter) return response;
  if (!response.headers.get('Content-Type')?.includes('text/html')) return response;

  const id = parseStatusId(idText);

  if (id === null) return response;

  let status;

  try {
    status = await withTimeout(findStatus(supabase, id), timeoutMs);
  } catch (error) {
    console.warn('Link preview skipped:', error);

    return response;
  }

  if (!status) return response;

  const markup = previewMarkup(status);
  const rewritten = new Rewriter()
    .on(PREVIEW_TAGS_SELECTOR, {
      element(element) {
        element.remove(); // the shell's default set; this page has its own
      },
    })
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
