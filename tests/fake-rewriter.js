// Stands in for Cloudflare's HTMLRewriter in the page-function tests. It supports only the three
// selectors those functions register, and applies them to a small HTML string:
//   - the profile's feed link: `before(html)` puts markup in front of the sitewide feed link;
//   - the preview tags: `remove()` drops every og:* and twitter:card <meta>;
//   - `head`: `append(html)` adds markup at the end of the head.
// Handlers run in the order they were registered, like the real one.
import assert from 'node:assert/strict';
import { PREVIEW_TAGS_SELECTOR } from '../src/preview-tags.js';

const FEED_LINK = 'link[rel="alternate"][type="application/rss+xml"]';

export function createFakeRewriter(shell) {
  return class FakeRewriter {
    handlers = [];

    on(selector, handlers) {
      assert.ok([FEED_LINK, PREVIEW_TAGS_SELECTOR, 'head'].includes(selector), `unexpected selector ${selector}`);
      this.handlers.push([selector, handlers]);
      return this;
    }

    transform(response) {
      let out = shell;

      for (const [selector, handlers] of this.handlers) {
        if (selector === FEED_LINK) {
          handlers.element({
            before(html, options) {
              assert.deepEqual(options, { html: true });
              out = out.replace(/ *<link rel="alternate"[^>]*>/, (existing) => `    ${html}${existing.trimStart()}`);
            },
          });
        } else if (selector === PREVIEW_TAGS_SELECTOR) {
          for (const tag of out.match(/ *<meta (?:property="og:|name="twitter:card")[^>]*>\n?/g) ?? []) {
            handlers.element({ remove: () => { out = out.replace(tag, ''); } });
          }
        } else {
          handlers.element({
            append(html, options) {
              assert.deepEqual(options, { html: true });
              out = out.replace('</head>', `${html}</head>`);
            },
          });
        }
      }

      return new Response(out, { status: response.status, headers: response.headers });
    }
  };
}
