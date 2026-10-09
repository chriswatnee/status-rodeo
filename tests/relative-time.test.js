import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeTime, absoluteTime } from '../src/relative-time.js';

const now = Date.UTC(2026, 9, 9, 16, 0, 0);
const ago = (ms) => new Date(now - ms).toISOString();
const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('under a minute, and in the future, is "just now"', () => {
  assert.equal(relativeTime(ago(0), now), 'just now');
  assert.equal(relativeTime(ago(59 * 1000), now), 'just now');
  assert.equal(relativeTime(ago(-5 * MIN), now), 'just now');
});

test('minutes', () => {
  assert.equal(relativeTime(ago(MIN), now), '1 minute ago');
  assert.equal(relativeTime(ago(5 * MIN + 30e3), now), '5 minutes ago');
  assert.equal(relativeTime(ago(59 * MIN + 59e3), now), '59 minutes ago');
});

test('hours', () => {
  assert.equal(relativeTime(ago(HOUR), now), '1 hour ago');
  assert.equal(relativeTime(ago(5 * HOUR), now), '5 hours ago');
  assert.equal(relativeTime(ago(23 * HOUR + 59 * MIN), now), '23 hours ago');
});

test('days, for the first week', () => {
  assert.equal(relativeTime(ago(DAY), now), '1 day ago');
  assert.equal(relativeTime(ago(2 * DAY + 3 * HOUR), now), '2 days ago');
  assert.equal(relativeTime(ago(6 * DAY + 23 * HOUR), now), '6 days ago');
});

test('a week or more shows the date, with the year only if it differs', () => {
  const week = relativeTime(ago(7 * DAY), now);
  assert.match(week, /^Oct \d+$/);
  assert.match(relativeTime('2025-03-02T12:00:00Z', now), /^Mar \d+, 2025$/);
});

test('absoluteTime includes the year and the time', () => {
  assert.match(absoluteTime('2026-10-07T10:40:00Z'), /^Oct \d+, 2026, \d+:\d{2}\s?[AP]M$/);
});
