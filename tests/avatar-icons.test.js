import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AVATAR_ICONS,
  DEFAULT_AVATAR,
  avatarLabel,
  avatarName,
  avatarPath,
  isAvatarName,
} from '../src/avatar-icons.js';

test('there are twelve icons with unique names and labels', () => {
  assert.equal(AVATAR_ICONS.length, 12);
  assert.equal(new Set(AVATAR_ICONS.map((icon) => icon.name)).size, 12);
  assert.equal(new Set(AVATAR_ICONS.map((icon) => icon.label)).size, 12);
});

test('every icon has its file in public/avatars/icons and no stray files are there', () => {
  const files = fs.readdirSync(new URL('../public/avatars/icons/', import.meta.url)).sort();

  assert.deepEqual(files, AVATAR_ICONS.map((icon) => `${icon.name}.webp`).sort());
});

test('names are plain kebab-case, the same shape the database check allows', () => {
  for (const { name } of AVATAR_ICONS) assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('the default is one of the icons and matches the database default', () => {
  assert.equal(isAvatarName(DEFAULT_AVATAR), true);
  assert.equal(DEFAULT_AVATAR, 'cowboy-hat');
});

test('a known name is used as it is', () => {
  assert.equal(avatarName('cactus'), 'cactus');
  assert.equal(avatarPath('cactus'), '/avatars/icons/cactus.webp');
  assert.equal(avatarLabel('cactus'), 'Cactus');
});

test('anything else shows the default, so a value can never build another path', () => {
  for (const value of [undefined, null, '', 'nope', 'Cactus', '../chris', 'cactus.webp', 'a/b', 42, {}]) {
    assert.equal(avatarName(value), DEFAULT_AVATAR);
    assert.equal(avatarPath(value), '/avatars/icons/cowboy-hat.webp');
    assert.equal(isAvatarName(value), false);
  }
});
