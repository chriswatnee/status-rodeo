import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, closeBrowser, timeline } from './support/harness.mjs';

after(closeBrowser);

const shown = (tl) => tl.some(([, , display, opacity]) => display !== 'none' && opacity > 0.5);

test('a fast load never shows the loading star', async () => {
  // Warm up first: the very first page of a run is slow because the browser is still starting.
  await (await openPage('/')).close();
  const { page, close } = await openPage('/');
  assert.equal(shown(await timeline(page)), false);
  await close();
});

test('a slow font load shows the star, then reveals the app once', async () => {
  const { page, close } = await openPage('/', { fontDelay: 2000, wait: 'none' });
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#app')).opacity), '0');
  await page.waitForFunction(() => !document.documentElement.classList.contains('fonts-pending'), null, { timeout: 8000 });
  await page.waitForTimeout(600);
  const tl = await timeline(page);
  assert.equal(shown(tl), true, 'the star was never visible during the wait');
  assert.equal(tl.at(-1)[1], false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#boot')).display), 'none');
  await close();
});

test('if the script never loads, a reload message appears after about 6 s', async () => {
  const { page, close } = await openPage('/', { blockMainJs: true, wait: 'none' });
  await page.waitForTimeout(5000);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('fonts-pending')), true);
  await page.waitForFunction(() => document.body.textContent.includes('Couldn’t load Status Rodeo.'), null, { timeout: 4000 });
  assert.equal(await page.locator('text=Reload the page').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('fonts-pending')), false);
  await close();
});

test('the masthead starts as the page colour and fades in with its picture', async () => {
  const { page, close } = await openPage('/', { mastheadDelay: 1500, wait: 'none' });
  await page.waitForSelector('.masthead', { state: 'attached' });
  const early = await page.evaluate(() => {
    const m = document.querySelector('.masthead');
    return { loaded: m.dataset.loaded ?? null, bg: getComputedStyle(m).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor, shadow: getComputedStyle(m).boxShadow };
  });
  assert.equal(early.loaded, null);
  assert.equal(early.shadow, 'none');
  await page.waitForFunction(() => document.querySelector('.masthead')?.dataset.loaded === 'true' || document.querySelector('.masthead')?.hasAttribute('data-loaded'), null, { timeout: 8000 });
  await close();
});

test('if the picture never loads, the masthead turns dark wood after 8 s', async () => {
  const { page, close } = await openPage('/', { blockMasthead: true });
  await page.waitForFunction(() => document.querySelector('.masthead')?.dataset.loaded === 'failed', null, { timeout: 12000 });
  await page.waitForTimeout(500); // the title fades in over 0.25 s
  const title = await page.evaluate(() => getComputedStyle(document.querySelector('.masthead-title')).opacity);
  assert.equal(title, '1');
  await close();
});
