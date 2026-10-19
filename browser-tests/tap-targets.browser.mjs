import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, closeBrowser } from './support/harness.mjs';

after(closeBrowser);

// The point at a control's edge must hit the control (or something inside it), not a neighbour.
const hits = (page, selector, inset) => page.evaluate(([selector, inset]) => {
  const el = document.querySelector(selector);
  if (!el) return 'missing';
  const r = el.getClientRects()[0]; // the first line, if the link wraps
  const points = [[r.left + inset, r.top + inset], [r.right - inset, r.top + inset], [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset], [r.left + r.width / 2, r.top + r.height / 2]];
  return points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit && (hit === el || el.contains(hit)); });
}, [selector, inset]);

for (const width of [360, 390]) {
  test(`taps land on the control at ${width}px`, async () => {
    const { page, close } = await openPage('/users/chris', { width, signedIn: true, rpcDelay: 0 });
    await page.waitForSelector('.hat-tip');
    assert.equal(await hits(page, '.hat-tip', 2), true, 'hat tip');
    assert.equal(await hits(page, '.status-menu-button', 2), true, '"..." button');
    assert.equal(await hits(page, '.status-link', 1), true, 'a link inside a status');
    await close();
  });

  test(`name and time links are tall enough to tap at ${width}px`, async () => {
    const { page, close } = await openPage('/', { width, signedIn: true });
    for (const selector of ['.status-name a, a.status-name', 'a.status-time']) {
      const height = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return 0;
        const r = el.getBoundingClientRect();
        return r.height;
      }, selector);
      assert.ok(height >= 18, `${selector} is ${height}px tall`);
    }
    await close();
  });
}
