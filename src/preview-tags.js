// The Open Graph / Twitter tags that make a pasted link show a small card in chat apps, shared by
// the status page (src/status-page.js) and the profile page (src/user-page.js). The app shell,
// index.html, carries the default set for the home page (and any page without its own); the
// functions replace that set with the page's own, so a crawler never sees two titles.
//
// Always the small `summary` card with a square picture (an avatar icon, 512x512): a large card
// would need a separate 1200x630 image per page.
import { SITE_URL } from './rss.js';

// Matches every tag this module writes, so the default set can be removed before the page's own
// set is added.
export const PREVIEW_TAGS_SELECTOR = 'meta[property^="og:"], meta[name="twitter:card"]';

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

// `imagePath` is a path on this site (for example /avatars/icons/cactus.webp).
export function previewTagsMarkup({ title, description, url, imagePath, imageAlt }) {
  const tags = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Status Rodeo'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', url],
    ['property', 'og:image', SITE_URL + imagePath],
    ['property', 'og:image:width', '512'],
    ['property', 'og:image:height', '512'],
    ['property', 'og:image:alt', imageAlt],
    ['name', 'twitter:card', 'summary'],
  ];

  return tags
    .map(([attribute, key, value]) => `<meta ${attribute}="${key}" content="${escapeAttribute(value)}" />`)
    .join('\n    ')
    .concat('\n  ');
}
