import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_LIMIT,
  countCharacters,
  truncateToLimit,
  validateStatus,
} from '../src/status-limit.js';

test('the limit is 280', () => {
  assert.equal(STATUS_LIMIT, 280);
});

test('counts plain text', () => {
  assert.equal(countCharacters(''), 0);
  assert.equal(countCharacters('hello'), 5);
  assert.equal(countCharacters('a b\nc'), 5);
});

test('counts code points, like Postgres char_length, not UTF-16 units', () => {
  assert.equal('👍'.length, 2);
  assert.equal(countCharacters('👍'), 1);
  assert.equal(countCharacters('a👍b'), 3);
  assert.equal(countCharacters('é'), 1);
  assert.equal(countCharacters('日本語'), 3);
  assert.equal(countCharacters('🇺🇸'), 2); // a flag is two code points
  assert.equal(countCharacters('👨‍👩‍👧'), 5); // a ZWJ family is five
});

test('truncateToLimit keeps the first N code points and never splits a pair', () => {
  assert.equal(truncateToLimit('abcdef', 3), 'abc');
  assert.equal(truncateToLimit('👍👍👍', 2), '👍👍');
  assert.equal(truncateToLimit('abc', 10), 'abc');
  assert.equal(truncateToLimit('abc', 0), '');
  assert.equal(truncateToLimit('abc', -5), '');
  assert.equal(countCharacters(truncateToLimit('x'.repeat(500))), 280);
  assert.equal(truncateToLimit('👍'.repeat(300)).isWellFormed(), true);
});

test('empty and whitespace-only statuses are rejected', () => {
  for (const text of ['', ' ', '   \n\t  ', ' ']) {
    assert.deepEqual(validateStatus(text), { ok: false, reason: 'empty' });
  }
});

test('valid statuses are trimmed', () => {
  assert.deepEqual(validateStatus('  hi there \n'), { ok: true, content: 'hi there' });
});

test('exactly 280 characters is allowed, 281 is not', () => {
  assert.equal(validateStatus('x'.repeat(280)).ok, true);
  assert.deepEqual(validateStatus('x'.repeat(281)), { ok: false, reason: 'too-long' });
});

test('the limit counts emoji as one character each', () => {
  assert.equal(validateStatus('👍'.repeat(280)).ok, true); // 560 UTF-16 units
  assert.equal(validateStatus('👍'.repeat(281)).reason, 'too-long');
});

test('surrounding whitespace does not count toward the limit', () => {
  assert.equal(validateStatus(`  ${'x'.repeat(280)}  `).ok, true);
});
