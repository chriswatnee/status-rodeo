// The Status Rodeo icon family lives in src/icons/ (24x24 SVGs drawn with
// currentColor). Only the icons imported here are bundled, so add an import and
// an entry when an icon is first used.
import home from './icons/home.svg?raw';
import profile from './icons/profile.svg?raw';
import pencil from './icons/pencil.svg?raw';
import signIn from './icons/sign-in.svg?raw';
import signOut from './icons/sign-out.svg?raw';
import error from './icons/error.svg?raw';
import hatTip from './icons/hat-tip.svg?raw';

const icons = { home, profile, pencil, 'sign-in': signIn, 'sign-out': signOut, error, 'hat-tip': hatTip };

// Decorative icon markup for use next to text that already names the action. The
// SVG files are static, so inserting them as markup is safe.
export function iconMarkup(name, extraClass = '') {
  const svg = icons[name];

  if (!svg) throw new Error(`Unknown icon: ${name}`);

  const className = extraClass ? `icon ${extraClass}` : 'icon';

  return `<span class="${className}" aria-hidden="true">${svg.trim()}</span>`;
}
