const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

// "just now", "5 minutes ago", "2 hours ago", "1 day ago" for the first week,
// then a plain date ("Oct 7", or "Oct 7, 2025" from another year).
export function relativeTime(createdAt, now = Date.now()) {
  const then = new Date(createdAt);
  const elapsed = now - then.getTime();

  // A clock slightly ahead of the server's can make a new status "in the future".
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) return plural(Math.floor(elapsed / DAY), 'day');

  const sameYear = then.getFullYear() === new Date(now).getFullYear();

  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// The exact time, shown as a tooltip on the relative one.
export function absoluteTime(createdAt) {
  return new Date(createdAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
