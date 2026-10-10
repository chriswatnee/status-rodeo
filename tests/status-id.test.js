import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatusId } from '../src/status-id.js';

test('accepts plain positive whole numbers', () => {
  assert.equal(parseStatusId('1'), 1);
  assert.equal(parseStatusId('42'), 42);
  assert.equal(parseStatusId('1234567890'), 1234567890);
  assert.equal(parseStatusId('999999999999999'), 999999999999999);
});

test('rejects zero, negatives and leading zeros (one address per status)', () => {
  for (const text of ['0', '00', '-1', '+1', '007', '01']) {
    assert.equal(parseStatusId(text), null, text);
  }
});

test('rejects anything that is not just digits', () => {
  for (const text of ['', ' ', ' 42', '42 ', '4 2', '4.2', '42.0', '1e3', '0x10', 'abc', '42abc', '４２', '٤٢', '42\n', '%34%32']) {
    assert.equal(parseStatusId(text), null, JSON.stringify(text));
  }
});

test('rejects numbers too long to be exact (no request is made for them)', () => {
  assert.equal(parseStatusId('1000000000000000'), null);
  assert.equal(parseStatusId('9223372036854775807'), null);
  assert.equal(parseStatusId('9'.repeat(40)), null);
});

test('rejects values that are not text', () => {
  for (const value of [undefined, null, 42, {}, [], ['42']]) {
    assert.equal(parseStatusId(value), null);
  }
});
