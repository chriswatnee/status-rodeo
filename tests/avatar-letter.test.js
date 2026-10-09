import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarLetter } from '../src/avatar-letter.js';

test('uses the first letter of the display name, uppercased', () => {
  assert.equal(avatarLetter('Chris', 'chris'), 'C');
  assert.equal(avatarLetter('sofie', 'sofie'), 'S');
  assert.equal(avatarLetter('éclair', 'e'), 'É');
});

test('falls back to the username, then to a question mark', () => {
  assert.equal(avatarLetter('', 'rodeo'), 'R');
  assert.equal(avatarLetter(null, 'rodeo'), 'R');
  assert.equal(avatarLetter('', ''), '?');
  assert.equal(avatarLetter(undefined, undefined), '?');
  assert.equal(avatarLetter('   ', ''), '?');
});

test('ignores leading spaces', () => {
  assert.equal(avatarLetter('  chris', 'chris'), 'C');
});

test('keeps an emoji whole instead of splitting its surrogate pair', () => {
  assert.equal('🤠'.charAt(0).length, 1); // the old approach: half an emoji
  assert.equal(avatarLetter('🤠 Rodeo', 'rodeo'), '🤠');
  assert.equal(avatarLetter('☀️ Sunny', 'sunny'), '☀️');
});

test('keeps flags and family emoji whole', () => {
  assert.equal(avatarLetter('🇺🇸 Team', 'team'), '🇺🇸');
  assert.equal(avatarLetter('👨‍👩‍👧‍👦 Family', 'family'), '👨‍👩‍👧‍👦');
  assert.equal(avatarLetter('👍🏽 Nice', 'nice'), '👍🏽');
});

test('without Intl.Segmenter it still never splits a surrogate pair', () => {
  assert.equal(avatarLetter('🤠 Rodeo', 'rodeo', null), '🤠');
  assert.equal(avatarLetter('chris', 'chris', null), 'C');
  assert.equal(avatarLetter('', '', null), '?');
});
