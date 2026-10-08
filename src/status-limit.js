// The status length rule. The limit counts Unicode code points, not UTF-16 code
// units, so it matches Postgres `char_length()` on the same text. An emoji such
// as 👍 counts as 1 here (JavaScript's `.length` would say 2). Sequences made of
// several code points, such as 👨‍👩‍👧 or a flag, count as several.
export const STATUS_LIMIT = 280;

export function countCharacters(text) {
  let count = 0;

  for (const _ of text) {
    count += 1;
  }

  return count;
}

// The first `limit` code points of `text`, never splitting a surrogate pair.
export function truncateToLimit(text, limit = STATUS_LIMIT) {
  return Array.from(text).slice(0, Math.max(limit, 0)).join('');
}

// What would be posted for the text in the composer: the trimmed content, or the
// reason it cannot be posted.
export function validateStatus(text) {
  const content = text.trim();

  if (!content) {
    return { ok: false, reason: 'empty' };
  }

  if (countCharacters(content) > STATUS_LIMIT) {
    return { ok: false, reason: 'too-long' };
  }

  return { ok: true, content };
}
