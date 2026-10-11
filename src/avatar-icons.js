// The avatar icons: every profile shows one of these Western objects, picked by its owner and
// stored in profiles.avatar as the file name without the extension. There are no user
// uploads and no letter fallback. The files are public/avatars/icons/<name>.webp (see
// "Design direction" in CLAUDE.md for the artwork spec). No DOM, so the Cloudflare functions
// can use it too.

// In the order the picker shows them.
export const AVATAR_ICONS = [
  { name: 'cowboy-hat', label: 'Cowboy hat' },
  { name: 'cowboy-boot', label: 'Cowboy boot' },
  { name: 'horseshoe', label: 'Horseshoe' },
  { name: 'lantern', label: 'Lantern' },
  { name: 'coffee-mug', label: 'Coffee mug' },
  { name: 'cactus', label: 'Cactus' },
  { name: 'guitar', label: 'Guitar' },
  { name: 'sheriff-star', label: 'Sheriff star' },
  { name: 'bandana', label: 'Bandana' },
  { name: 'cattle-skull', label: 'Cattle skull' },
  { name: 'coiled-rope', label: 'Coiled rope' },
  { name: 'wagon-wheel', label: 'Wagon wheel' },
];

// What a profile gets until its owner picks (the database default is the same name).
export const DEFAULT_AVATAR = 'cowboy-hat';

const KNOWN = new Set(AVATAR_ICONS.map((icon) => icon.name));

export function isAvatarName(value) {
  return typeof value === 'string' && KNOWN.has(value);
}

// The icon to show for a stored value. Anything that is not one of the icons (a missing
// column or value, a name from a newer or older version of the app) shows the default,
// so there is always an icon and the value never reaches a URL unchecked.
export function avatarName(value) {
  return isAvatarName(value) ? value : DEFAULT_AVATAR;
}

export function avatarPath(value) {
  return `/avatars/icons/${avatarName(value)}.webp`;
}

export function avatarLabel(value) {
  return AVATAR_ICONS.find((icon) => icon.name === avatarName(value)).label;
}
