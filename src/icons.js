// The Status Rodeo icon family lives in src/icons/ (24x24 SVGs drawn with
// currentColor). Only the icons imported here are bundled, so add an import and
// an entry when an icon is first used.
import home from './icons/home.svg?raw';
import profile from './icons/profile.svg?raw';

const icons = { home, profile };

// Decorative icon markup for use next to text that already names the action. The
// SVG files are static, so inserting them as markup is safe.
export function iconMarkup(name) {
  const svg = icons[name];

  if (!svg) throw new Error(`Unknown icon: ${name}`);

  return `<span class="icon" aria-hidden="true">${svg.trim()}</span>`;
}
