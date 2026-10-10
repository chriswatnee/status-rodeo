// Finds web addresses in a status so they can be shown as links. It works on plain
// text and returns parts; it never produces HTML. The page turns the parts into DOM
// nodes (see createStatusText in src/main.js), so a status can only ever add a link
// element with a checked address, never markup.
//
// Rules, kept deliberately plain and predictable:
//   * only addresses that start with http:// or https:// (not "example.com", and never
//     javascript:, data:, ftp: or a bare //host);
//   * the shown text is the address exactly as typed, so what you read is where it
//     goes;
//   * punctuation that ends a sentence is not part of the link: "see https://a.com/b."
//     links https://a.com/b, and a closing bracket only belongs to the link when the
//     address opened one (Wikipedia-style .../Foo_(bar));
//   * an address with a username or password in it (https://paypal.com@evil.com), or a
//     host without a dot, is left as plain text.

const ADDRESS = /https?:\/\/[^\s<>"]+/gi;
const SENTENCE_END = new Set(['.', ',', ';', ':', '!', '?', "'", '…']);
const OPENING = { ')': '(', ']': '[', '}': '{' };

function count(text, character) {
  let total = 0;

  for (const c of text) if (c === character) total += 1;

  return total;
}

function trimEnd(candidate) {
  let end = candidate.length;

  while (end > 0) {
    const last = candidate[end - 1];
    const body = candidate.slice(0, end);

    if (SENTENCE_END.has(last) || (OPENING[last] && count(body, last) > count(body, OPENING[last]))) {
      end -= 1;
    } else {
      break;
    }
  }

  return candidate.slice(0, end);
}

// The address to link to for `text`, or null if it should stay plain text.
function safeHref(text) {
  let url;

  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.')) return null;

  return url.href;
}

// [{ type: 'text', text }, { type: 'link', text, href }, ...]. The texts joined
// together are always exactly the input.
export function linkify(content) {
  const text = String(content ?? '');
  const parts = [];

  function push(part) {
    const last = parts.at(-1);

    if (part.type === 'text' && last?.type === 'text') {
      last.text += part.text;
    } else if (part.text !== '') {
      parts.push(part);
    }
  }

  let position = 0;

  for (const match of text.matchAll(ADDRESS)) {
    const address = trimEnd(match[0]);
    const href = safeHref(address);

    if (href === null) continue;

    push({ type: 'text', text: text.slice(position, match.index) });
    push({ type: 'link', text: address, href });
    position = match.index + address.length;
  }

  push({ type: 'text', text: text.slice(position) });

  return parts.length ? parts : [{ type: 'text', text }];
}
