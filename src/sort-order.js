// Remembers which order of statuses the visitor picked ("Latest first" or
// "Oldest first") in this browser, so it is still chosen on the next visit. It is
// kept in localStorage, not in the database, so it is per browser and per device.
// Storage can be missing or throw (private windows, blocked site data), so every
// access is guarded and the feed simply falls back to "Latest first".
const KEY = 'status-rodeo:sort-order';

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Returns 'asc' (Oldest first) or 'desc' (Latest first, the default).
export function readSortOrder(storage = defaultStorage()) {
  try {
    return storage?.getItem(KEY) === 'asc' ? 'asc' : 'desc';
  } catch {
    return 'desc';
  }
}

export function saveSortOrder(order, storage = defaultStorage()) {
  try {
    storage?.setItem(KEY, order === 'asc' ? 'asc' : 'desc');
  } catch {
    // Not remembered; nothing else to do.
  }
}
