// RSS 2.0 for Status Rodeo. This module only turns rows into XML text: no DOM, no
// network, no dependencies, so it is unit tested (tests/rss.test.js). The request
// handling is in src/feed.js and the Cloudflare entry points are in functions/.
//
// Status text is plain text. It goes into <description> as plain text (escaped for
// XML, never as HTML), and a short plain-text version goes into <title>.

// Links, GUIDs and the feed's own address always use the real site, whichever
// address (status.rodeo or a preview) the feed was fetched from, so a status keeps
// the same GUID everywhere.
export const SITE_URL = 'https://status.rodeo';
export const FEED_LIMIT = 30;
export const TITLE_LIMIT = 80;

// XML 1.0 allows tab, newline, carriage return and most of Unicode, but not the
// other control characters or unpaired surrogates (Postgres text can contain them),
// and a single one makes the whole feed unparseable. The C1 range (U+007F to U+009F)
// is legal but discouraged, so it goes too. Removed, not replaced.
const INVALID_XML_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanXmlText(text) {
  return String(text ?? '').replace(INVALID_XML_CHARACTERS, '');
}

export function escapeXml(text) {
  return cleanXmlText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const defaultSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

// A one-line version of a status for <title>: whitespace (including newlines)
// collapsed, cut after `limit` whole characters with an ellipsis if longer. Whole
// characters, not UTF-16 units, so an emoji is never cut in half.
export function plainTitle(content, limit = TITLE_LIMIT, segmenter = defaultSegmenter) {
  const text = cleanXmlText(content).replace(/\s+/g, ' ').trim();
  const characters = segmenter
    ? Array.from(segmenter.segment(text), (part) => part.segment)
    : Array.from(text);

  if (characters.length <= limit) return text;

  return `${characters.slice(0, limit).join('').trimEnd()}…`;
}

export function statusUrl(id) {
  return `${SITE_URL}/statuses/${id}`;
}

export function userUrl(username) {
  return `${SITE_URL}/users/${encodeURIComponent(username)}`;
}

// RFC 822 date, as RSS 2.0 wants ("Sat, 10 Oct 2026 14:00:00 GMT"). Null for a
// missing or invalid date (statuses.created_at is nullable), so the element is left out.
function rfc822(value) {
  if (value === null || value === undefined || value === '') return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

// One <item>, or null if there is nothing to show (no usable id, or a status that is
// empty once invalid characters are removed). Fields: id, content, createdAt, author.
function buildItem({ id, content, createdAt, author }) {
  if (!Number.isSafeInteger(id) || id < 1) return null;

  const text = cleanXmlText(content).trim();

  if (!text) return null;

  const url = statusUrl(id);
  const date = rfc822(createdAt);
  const name = cleanXmlText(author).trim();

  return [
    '    <item>',
    `      <title>${escapeXml(plainTitle(text))}</title>`,
    `      <link>${url}</link>`,
    `      <guid isPermaLink="true">${url}</guid>`,
    date ? `      <pubDate>${date.toUTCString()}</pubDate>` : null,
    name ? `      <dc:creator>${escapeXml(name)}</dc:creator>` : null,
    `      <description>${escapeXml(text)}</description>`,
    '    </item>',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

// The whole feed document. `path` is the feed's own address on the site
// ("/feed.xml"); `items` are newest first, already in the order they should appear.
// lastBuildDate is the newest item's date, not the time of the request, so the same
// content always gives the same document.
export function buildFeed({ title, description, link, path, items }) {
  const built = items.map(buildItem).filter((item) => item !== null);
  const dates = items.map((item) => rfc822(item.createdAt)).filter((date) => date !== null);
  const newest = dates.length ? new Date(Math.max(...dates)) : null;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    '    <language>en-us</language>',
    newest ? `    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : null,
    `    <atom:link href="${escapeXml(SITE_URL + path)}" rel="self" type="application/rss+xml" />`,
    ...built,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
}
