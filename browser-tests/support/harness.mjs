// Browser test harness: opens the real app (index.html, src/, style.css, fonts and pictures from this
// repo) in headless Chromium with src/supabase.js swapped for the fake in mock-supabase.js. No network,
// no real database, no Vite. Playwright is not a dependency of the project (see CLAUDE.md for how to
// install it); set CHROMIUM_PATH to use a Chromium that is already on the machine.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { db } from './data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name); } catch {}
  }
  throw new Error('Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium');
}

const read = (rel) => fs.readFileSync(path.join(root, rel));
let browserPromise;

export function getBrowser() {
  browserPromise ??= loadPlaywright().chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) await (await browserPromise).close();
  browserPromise = undefined;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Options: width (390), height (900), signedIn, delay (ms per query), sessionDelay, rpcDelay,
 * fontDelay (ms before the Nunito file arrives), blockMainJs (answer 404), mastheadDelay,
 * blockMasthead (every masthead request fails), wait ('app' = until the page's feed or notice is
 * drawn, 'none' = return right after the request is sent).
 */
export async function openPage(urlPath, options = {}) {
  const { width = 390, height = 900, wait = 'app' } = options;
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript((mock) => {
    window.__mock = mock;
    // A timeline of the loading state, sampled every 50 ms: [ms, pending, boot display, boot opacity].
    window.__timeline = [];
    const t0 = performance.now();
    setInterval(() => {
      const boot = document.querySelector('#boot');
      if (!boot) return;
      const style = getComputedStyle(boot);
      window.__timeline.push([
        Math.round(performance.now() - t0),
        document.documentElement.classList.contains('fonts-pending'),
        style.display,
        Number(style.opacity),
      ]);
    }, 50);
  }, {
    signedIn: false,
    delay: 0,
    sessionDelay: 0,
    rpcDelay: 0,
    db: structuredClone(db),
    ...options,
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p === '/src/main.js') {
      if (options.blockMainJs) return route.fulfill({ status: 404, body: '' });
      const code = read('src/main.js').toString()
        .replace("import './style.css';", '')
        .replace("'./supabase.js'", "'/mock-supabase.js'");
      return route.fulfill({ contentType: 'text/javascript', body: code });
    }
    if (p.startsWith('/src/icons/') && p.endsWith('.svg')) {
      return route.fulfill({ contentType: 'text/javascript', body: 'export default ' + JSON.stringify(read(p.slice(1)).toString()) });
    }
    if (p.startsWith('/src/') && p.endsWith('.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: read(p.slice(1)) });
    }
    if (p === '/src/style.css') return route.fulfill({ contentType: 'text/css', body: read('src/style.css') });
    if (p === '/mock-supabase.js') return route.fulfill({ contentType: 'text/javascript', body: read('browser-tests/support/mock-supabase.js') });

    if (p === '/fonts/nunito-variable.woff') {
      if (options.fontDelay) await sleep(options.fontDelay);
      return route.fulfill({ contentType: 'font/woff', body: read('public' + p) });
    }
    if (p === '/fonts/zilla-slab-bold.woff2') return route.fulfill({ contentType: 'font/woff2', body: read('public' + p) });

    if (/\.(webp|png|ico)$/.test(p)) {
      if (/masthead/.test(p)) {
        if (options.blockMasthead) return route.abort();
        if (options.mastheadDelay) await sleep(options.mastheadDelay);
      }
      const file = path.join(root, 'public', p);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      const type = p.endsWith('.webp') ? 'image/webp' : p.endsWith('.png') ? 'image/png' : 'image/x-icon';
      return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
    }

    // Everything else is a client route: the app shell, like Cloudflare's SPA fallback.
    const html = read('index.html').toString().replace('</head>', '<link rel="stylesheet" href="/src/style.css"></head>');
    return route.fulfill({ contentType: 'text/html', body: html });
  });

  // 'commit' returns as soon as the response starts, so a slow load can be watched while it happens.
  await page.goto('http://app.test' + urlPath, { waitUntil: 'commit' });
  if (wait === 'app') {
    await page.waitForSelector('.feed:not([aria-busy]), main.site > h2, .edit-form, #page .notice, #page .feed-message', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => !document.documentElement.classList.contains('fonts-pending'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  }

  return { page, errors, close: () => context.close() };
}

export const timeline = (page) => page.evaluate(() => window.__timeline);
