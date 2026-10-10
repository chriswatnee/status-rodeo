import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPOSER_PLACEHOLDERS, PLACEHOLDER_MAX_LENGTH, pickPlaceholder } from '../src/placeholders.js';

test('every line is short enough to stay on one line on a small phone', () => {
  for (const line of COMPOSER_PLACEHOLDERS) {
    assert.ok(Array.from(line).length <= PLACEHOLDER_MAX_LENGTH, line);
    assert.equal(line, line.trim());
    assert.notEqual(line, '');
  }
});

test('lines are unique, one line each, and use the curly apostrophe like the original', () => {
  assert.equal(new Set(COMPOSER_PLACEHOLDERS).size, COMPOSER_PLACEHOLDERS.length);

  for (const line of COMPOSER_PLACEHOLDERS) {
    assert.ok(!/[\n\r]/.test(line), line);
    assert.ok(!line.includes("'"), line);
  }
});

test('every line is Western-flavoured, not the plain default', () => {
  assert.ok(!COMPOSER_PLACEHOLDERS.includes('What’s your status?'));
});

test('picks by the random number, including both ends', () => {
  assert.equal(pickPlaceholder(null, () => 0), COMPOSER_PLACEHOLDERS[0]);
  assert.equal(pickPlaceholder(null, () => 0.999999), COMPOSER_PLACEHOLDERS.at(-1));
  assert.equal(pickPlaceholder(null, () => 1), COMPOSER_PLACEHOLDERS.at(-1));
});

test('never repeats the previous line', () => {
  for (const previous of COMPOSER_PLACEHOLDERS) {
    for (let n = 0; n < 100; n += 1) {
      assert.notEqual(pickPlaceholder(previous, () => n / 100), previous);
    }
  }
});

test('works with a one-line list and an unknown previous line', () => {
  assert.equal(pickPlaceholder('x', () => 0.5, ['only']), 'only');
  assert.equal(pickPlaceholder('only', () => 0.5, ['only']), 'only');
  assert.ok(COMPOSER_PLACEHOLDERS.includes(pickPlaceholder('not in the list')));
});

test('every line can come up', () => {
  const seen = new Set();

  for (let n = 0; n < COMPOSER_PLACEHOLDERS.length * 4; n += 1) {
    seen.add(pickPlaceholder(null, () => n / (COMPOSER_PLACEHOLDERS.length * 4)));
  }

  assert.equal(seen.size, COMPOSER_PLACEHOLDERS.length);
});
