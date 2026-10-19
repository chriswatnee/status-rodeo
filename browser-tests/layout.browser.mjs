import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, closeBrowser } from './support/harness.mjs';
import { chrisStatusId } from './support/data.js';

after(closeBrowser);

const widths = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];
const pages = [
  ['home', '/'],
  ['own profile', '/users/chris'],
  ['other profile', '/users/sofie'],
  ['long-named profile', '/users/a-very-long-username-for-stress-tests'],
  ['status page', `/statuses/${chrisStatusId}`],
  ['edit profile', '/profile/edit'],
  ['not found', '/nowhere'],
];

for (const signedIn of [false, true]) {
  for (const [name, url] of pages) {
    test(`no sideways scrolling: ${name}, ${signedIn ? 'signed in' : 'signed out'}`, async () => {
      for (const width of widths) {
        const { page, errors, close } = await openPage(url, { width, signedIn });
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        await close();
        assert.equal(scroll, client, `${name} is ${scroll}px wide in a ${client}px window at ${width}px`);
        assert.deepEqual(errors, []);
      }
    });
  }
}

// After the page is revealed, the content must not move while queries finish.
const topOfContent = (page) => page.evaluate(() => Math.round(document.querySelector('#page').getBoundingClientRect().top));

for (const [name, url] of [['home', '/'], ['own profile', '/users/chris'], ['other profile', '/users/sofie'], ['status page', `/statuses/${chrisStatusId}`]]) {
  test(`nothing jumps after the reveal: ${name}`, async () => {
    const { page, close } = await openPage(url, { width: 390, signedIn: true, delay: 600, sessionDelay: 200, wait: 'none' });
    await page.waitForFunction(() => !document.documentElement.classList.contains('fonts-pending'), null, { timeout: 15000 });
    const first = await topOfContent(page);
    const seen = new Set([first]);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      seen.add(await topOfContent(page));
    }
    await close();
    assert.deepEqual([...seen], [first], `the page content moved: ${[...seen].join(', ')}`);
  });
}
