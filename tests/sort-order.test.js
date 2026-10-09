import test from 'node:test';
import assert from 'node:assert/strict';
import { readSortOrder, saveSortOrder } from '../src/sort-order.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };

  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    data,
  };
}

test('defaults to Latest first when nothing is saved', () => {
  assert.equal(readSortOrder(fakeStorage()), 'desc');
});

test('remembers Oldest first', () => {
  const storage = fakeStorage();

  saveSortOrder('asc', storage);

  assert.equal(readSortOrder(storage), 'asc');
});

test('remembers going back to Latest first', () => {
  const storage = fakeStorage();

  saveSortOrder('asc', storage);
  saveSortOrder('desc', storage);

  assert.equal(readSortOrder(storage), 'desc');
});

test('only ever stores asc or desc', () => {
  const storage = fakeStorage();

  saveSortOrder('<script>', storage);

  assert.equal(Object.values(storage.data)[0], 'desc');
});

test('ignores a saved value it does not recognise', () => {
  const storage = fakeStorage({ 'status-rodeo:sort-order': 'sideways' });

  assert.equal(readSortOrder(storage), 'desc');
});

test('falls back quietly when storage is missing or throws', () => {
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };

  assert.equal(readSortOrder(null), 'desc');
  assert.equal(readSortOrder(broken), 'desc');
  assert.doesNotThrow(() => saveSortOrder('asc', broken));
  assert.doesNotThrow(() => saveSortOrder('asc', null));
});
