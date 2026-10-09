// The letter shown in an avatar slot when there is no avatar image: the first
// character of the display name, or of the username if there is no display name.
//
// It works on whole characters, not UTF-16 units. `name.charAt(0)` returns half
// of an emoji (a lone surrogate, drawn as a broken box), so a name that starts
// with an emoji would break the fallback. Intl.Segmenter keeps multi-part
// emoji (flags, families) whole; where it is missing, the first code point is
// used, which still never splits a surrogate pair.
const defaultSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function avatarLetter(displayName, username, segmenter = defaultSegmenter) {
  const name = (displayName || username || '').trim();

  if (!name) return '?';

  const first = segmenter
    ? segmenter.segment(name)[Symbol.iterator]().next().value.segment
    : Array.from(name)[0];

  return first.toUpperCase();
}
