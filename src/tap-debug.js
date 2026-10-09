// TEMPORARY diagnostic, only on the debug-taps preview branch; never merged.
// Shows an on-screen log of touch and click events so we can see what a phone
// does when "Show older" needs a second tap. Enabled with ?debug in the address.
const lines = [];
const t0 = performance.now();
const box = document.createElement('div');
box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;height:26vh;overflow:auto;background:rgba(20,10,5,.88);color:#9fe39f;font:11px/1.35 ui-monospace,Menlo,monospace;padding:6px 8px;white-space:pre-wrap;word-break:break-all;pointer-events:none';
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;right:6px;bottom:calc(26vh + 6px);z-index:100000;display:flex;gap:6px';
function mk(label, fn) { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'font:12px system-ui;padding:6px 10px;border-radius:6px;border:1px solid #888;background:#fff;color:#000'; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; }
function describe(el) {
  if (!el || !el.tagName) return String(el);
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
}
function render() { box.textContent = lines.slice(-40).join('\n'); box.scrollTop = box.scrollHeight; }
function log(msg) { lines.push(String(Math.round(performance.now() - t0)).padStart(6) + ' ' + msg); if (lines.length > 300) lines.shift(); render(); }
bar.append(
  mk('Copy log', async () => { try { await navigator.clipboard.writeText(lines.join('\n')); log('(copied)'); } catch { log('(copy failed; long-press the log text instead)'); } }),
  mk('Clear', () => { lines.length = 0; render(); }),
  mk('Hide/Show', () => { const hide = box.style.display !== 'none'; box.style.display = hide ? 'none' : ''; document.body.style.paddingBottom = hide ? '' : '30vh'; }),
);
document.body.append(box, bar);
// Room under the page so the last button can be scrolled clear of the log.
document.body.style.paddingBottom = '30vh';
log('debug on. ua=' + navigator.userAgent.replace(/\s+/g, ' ').slice(0, 90));
log(`hover=${matchMedia('(hover: hover)').matches} pointer=${matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'} dpr=${devicePixelRatio} vv=${Math.round(visualViewport?.width)}x${Math.round(visualViewport?.height)} scale=${visualViewport?.scale}`);
const mainButton = () => document.querySelector('.feed-more button');
function where(e) {
  const x = e.clientX ?? e.changedTouches?.[0]?.clientX, y = e.clientY ?? e.changedTouches?.[0]?.clientY;
  if (x === undefined) return '';
  const under = document.elementFromPoint(x, y);
  const r = mainButton()?.getBoundingClientRect();
  const inBtn = r ? ` btn[${Math.round(r.left)}-${Math.round(r.right)} x ${Math.round(r.top)}-${Math.round(r.bottom)}]` : '';
  return ` @${Math.round(x)},${Math.round(y)} under=${describe(under)}${inBtn}`;
}
for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click', 'mousedown', 'mouseup']) {
  document.addEventListener(type, (e) => {
    const b = mainButton();
    log(`${type} target=${describe(e.target)}${where(e)}${type === 'click' && b ? ` disabled=${b.disabled} text="${b.textContent}"` : ''}${e.defaultPrevented ? ' PREVENTED' : ''}`);
  }, true);
}
document.addEventListener('focusin', (e) => log('focusin ' + describe(e.target)), true);
let lastScroll = 0;
window.addEventListener('scroll', () => { const n = performance.now(); if (n - lastScroll > 150) { lastScroll = n; log(`scroll y=${Math.round(scrollY)} h=${document.documentElement.scrollHeight}`); } }, { passive: true });
let lastH = document.documentElement.scrollHeight;
new ResizeObserver(() => { const h = document.documentElement.scrollHeight; if (h !== lastH) { log(`page height ${lastH} -> ${h}`); lastH = h; } }).observe(document.documentElement);
try { new PerformanceObserver((list) => list.getEntries().forEach((en) => en.value > 0.001 && log('layout-shift ' + en.value.toFixed(3)))).observe({ type: 'layout-shift', buffered: false }); } catch {}
window.addEventListener('error', (e) => log('ERROR ' + e.message));
