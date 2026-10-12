import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PREVIEW_TAGS_SELECTOR } from '../src/preview-tags.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// The functions remove the shell's default preview tags with PREVIEW_TAGS_SELECTOR and add their
// own; if the shell had a preview tag the selector doesn't match, a crawler would see two.
test('every preview tag in index.html is one the selector removes', () => {
  const tags = html.match(/<meta (?:property|name)="(?:og:|twitter:)[^>]*>/g) ?? [];

  assert.equal(tags.length, 10);
  assert.equal(PREVIEW_TAGS_SELECTOR, 'meta[property^="og:"], meta[name="twitter:card"]');

  for (const tag of tags) assert.match(tag, /<meta (?:property="og:|name="twitter:card")/);
});

test('the default preview picture is a file that ships with the site', () => {
  const [, path] = html.match(/property="og:image" content="https:\/\/status\.rodeo(\/[^"]+)"/);

  assert.ok(fs.existsSync(new URL(`../public${path}`, import.meta.url)));
});
