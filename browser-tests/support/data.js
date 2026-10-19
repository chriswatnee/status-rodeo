// Test data for the browser tests. Includes stress cases: a very long unbroken word, a long
// display name and username, a web address and a mention.
const hour = 3600e3;
const base = Date.UTC(2026, 9, 8, 12);

export const profiles = [
  { user_id: 'u1', username: 'chris', display_name: 'Chris', created_at: '2026-09-18T12:00:00Z', avatar: 'cowboy-hat' },
  { user_id: 'u2', username: 'sofie', display_name: 'Sofie', created_at: '2026-10-01T12:00:00Z', avatar: 'cactus' },
  {
    user_id: 'u3',
    username: 'a-very-long-username-for-stress-tests',
    display_name: 'A display name that is much too long to fit on one line of a phone',
    created_at: '2026-10-02T12:00:00Z',
    avatar: 'lantern',
  },
];

const make = (n, userNumber, text) =>
  Array.from({ length: n }, (_, i) => ({
    id: userNumber * 100 + i,
    user_id: `u${userNumber}`,
    content: text(n - i),
    visibility: 'public',
    created_at: new Date(base - i * 7 * hour - userNumber * 60e3).toISOString(),
    edited_at: null,
  }));

export const statuses = [
  ...make(8, 1, (n) => `Status number ${n} from Chris. Lorem ipsum dolor sit amet. See https://example.com/a/long/path and hi @sofie.`),
  ...make(4, 2, (n) => `Status number ${n} from Sofie. ${'x'.repeat(136)}`),
  ...make(2, 3, (n) => `Status number ${n} from the long-named user.`),
];

export const hatTips = [{ status_id: 107, user_id: 'u2' }];

export const db = { profiles, statuses, hat_tips: hatTips };

// The id of Chris's newest status (his own, for the owner-only "..." menu).
export const chrisStatusId = 107;
