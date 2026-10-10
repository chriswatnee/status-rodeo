# Status Rodeo

A personal status-sharing site, live at status.rodeo. It started as a tiny
service (post a short status, show recent ones, expose the latest as JSON for use
on the owner's personal site) and is now technically a multi-user social network
with two users.

## Stack

- Vanilla HTML/CSS/JavaScript, built with Vite (no framework)
- Supabase: Postgres + Auth (tables: `profiles`, `statuses`)
- Cloudflare Pages hosting, with API endpoints in `functions/` (Pages Functions)
- GitHub for source

## Commands

- `npm run dev` : Vite dev server at http://localhost:5173. It does not run the
  `functions/` endpoints; `/api/status` returns the HTML app shell instead of JSON.
- `npm run build` : production build into `dist/`
- `npm run preview` : preview the build
- To test the API locally: `npm run build`, then `npx wrangler pages dev dist`.
  Wrangler only gives the functions their Supabase variables if a `.dev.vars`
  file in the project root defines `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`. Without it, `env.VITE_...` is undefined and
  the endpoints return 500. `.dev.vars` is gitignored.

- `npm test` : unit tests (Node's built-in runner, no dependencies) for the status
  length rule, the posting logic and the avatar letter in `tests/`.

There are no linters. Before finishing a change, run `npm test` and
`npm run build`, and check the affected pages in the browser.

## Deployment

Cloudflare Pages project `status-rodeo`, connected to the GitHub repo. Every push
to `main` deploys to production automatically (status.rodeo, also
status-rodeo.pages.dev).

Build settings: framework preset None, build command `npm run build`, output
directory `dist`, root directory blank.

Client-side routes such as `/users/<username>` work through Cloudflare Pages' SPA
fallback. No `_redirects` file is needed.

## Environment

- The client and the functions both read `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (the functions read them as `env.VITE_...`).
- Locally they live in `.env.local`, which is gitignored (`*.local`); a plain
  `.env` is not. In production they are set by hand in the Cloudflare Pages
  dashboard, for both Production and Preview.
- Never write real values into this file or commit them.
- `VITE_` variables are bundled into the client. Never put a secret or a Supabase
  service-role key in one.

## Structure

- `src/main.js` holds client-side routing by pathname (`/`, `/users/:username`,
  otherwise not-found) and all views. Links to app pages are intercepted and
  navigate with the History API (`navigate()`, `popstate`), so moving between
  pages never reloads the browser page; other links, new-tab or modified clicks
  and `#` links behave normally. The masthead and sidebar are a shared frame built
  once by `mount()`; each page replaces only `#page` (the area beside the sidebar).
  `route()` draws the page for the current path (and runs last in the file, after
  everything it uses is defined). The sidebar is built by `sidebarMarkup()` and
  wired once by `initSidebar()`, which handles sign-in, sign-out and the signed-in
  identity and keeps the auth state in module variables. A page reacts to the
  signed-in state with `setPageHooks({ onSession, onProfile })` (the home page uses
  them for the composer); the hooks run at once if the state is already known.
  `updateNav()` marks the current page in the navigation. Change the sidebar in
  those functions, not per page. A page that loads data asynchronously must check
  `isCurrent()` (passed to `renderUserPage`) after awaiting, so a visitor who has
  moved on isn't overwritten, and call `pageReady()` once its title is known: after a
  navigation (not the first load) it announces the new page title in a hidden
  live region (`#route-announcer`) and, if the clicked link is gone, moves focus
  to `#page`. Each page sets `document.title`. Not-found is drawn
  inside the frame, with the sidebar.
- `src/avatar-letter.js` picks the letter shown when a user has no avatar file. It
  works on whole characters (grapheme clusters), so a name starting with an emoji
  isn't cut in half. It has unit tests.
- `src/status-limit.js` is the 280-character rule (counts Unicode code points, so
  it matches Postgres `char_length`); `src/post-status.js` validates and inserts a
  status. Both are plain modules with unit tests.
- API handlers live in `functions/api/`.
- The folder `functions/api/users/[username]/` must be named with literal square
  brackets. With any other name, `params.username` is undefined.

## API

- `/api/status` returns the latest public status from any user.
- `/api/users/<username>/status` returns the latest public status for one user.
- Anything that shows a particular person's current status, such as the owner's
  personal site, must use the per-user endpoint. `/api/status` will show whoever
  posted most recently.

## Data and security

Supabase was set up partly by hand in the dashboard. `supabase/schema.sql` is a
snapshot of the tables, foreign keys, RLS, and policies. It is not a migration,
and nothing applies it automatically. This section and that file were checked
against the live database on 2026-10-06. The live database is authoritative: if
either disagrees with it, trust the database and fix them.

Tables:
- `statuses`: `id` int8 identity primary key, `user_id` uuid not null, `content`
  text not null (1 to 280 characters, see below), `visibility` text not null default `'public'`, `created_at`
  timestamptz default now().
- `profiles`: `user_id` uuid primary key, `created_at` timestamptz default now(),
  `username` text not null unique, `display_name` text not null.

Foreign keys (all NO ACTION): `statuses.user_id` references both `auth.users.id`
and `profiles.user_id`; `profiles.user_id` references `auth.users.id`. Keep the
`statuses` to `profiles` key. The feed query embeds
`profiles(display_name, username)`, and without that relationship PostgREST
returns PGRST200.

Other facts:
- Posting writes directly from the browser to Supabase (the Cloudflare Functions
  are read-only). A status is 1 to 280 characters and cannot be blank. This is
  enforced twice: in the browser (`src/status-limit.js`) and by the database CHECK
  constraint `statuses_content_check` on `statuses.content`
  (`char_length(content) between 1 and 280 and content !~ '^\s*$'`), which is
  validated and was checked against production on 2026-10-08. Both count Unicode code
  points (Postgres `char_length`), so an emoji is 1 character and a flag is 2. A
  violation comes back as Postgres error `23514`; the browser shows its generic
  "Couldn't post" message and keeps the text. If you change the limit, change it in
  both places.
- The app only uses `visibility = 'public'`. There is no CHECK constraint on
  `visibility`. `statuses_content_check` is the only CHECK constraint.
- No trigger creates a profile when an Auth user is created. Profiles are
  provisioned by hand, so creating an Auth user alone does not give a working
  account.

Row Level Security is enabled on both tables. Policies:
- "Public statuses are viewable": `statuses` select, role `public`, using
  `visibility = 'public'`
- "Users can create their own statuses": `statuses` insert, role `authenticated`,
  with check `(select auth.uid()) = user_id`
- "Public profiles are viewable": `profiles` select, role `public`, using `true`
- These are the only policies. There are no update or delete policies on
  `statuses`, and no insert, update, or delete policies on `profiles`.

Writes through the Data API are governed only by these policies. There are no
storage buckets, and GraphQL is disabled.

The `anon` and `authenticated` roles hold every table privilege on both tables
(the Supabase default), so RLS is the only thing limiting access. Never disable
RLS on these tables, and don't add broad policies without checking what they
expose.

Access control is enforced by RLS, not by the client. Client-side filters such as
`visibility = 'public'` are not security. Check the live policies before changing
queries or inserts.

Auth settings: email is the only enabled provider, anonymous sign-ins are off,
email confirmation is required, and public sign-up is disabled. Accounts are
created by hand in the Supabase dashboard (Authentication > Users > Add user) and
then given a `profiles` row. The Auth Site URL is `https://status.rodeo`; no
redirect URLs are configured.

## Conventions

- Render user-provided content with `textContent` or DOM APIs, never `innerHTML`.
  Static template markup is fine.
- `src/style.css` starts with a minimal browser reset (global `border-box`,
  `text-size-adjust`, `margin: 0` on form controls) and is not a full reset:
  everything else uses browser defaults, so set margins explicitly on elements
  you rely on.
- Icons: the Status Rodeo icon family is 25 hand-drawn 24x24 SVGs in `src/icons/`
  (one file each, kebab-case names: home, profile, users, search, notifications,
  settings, sign-out, sign-in, edit-profile, pencil, delete, reply, like, share,
  copy-link, more, refresh, history, success, warning, error, info, close, back,
  external-link). They are drawn with `currentColor`, a 1.8 stroke, round caps and
  joins, and a soft 18% fill in the same colour; no gradients. Only icons imported
  in `src/icons.js` are bundled (Vite `?raw`), so add an import and an entry when
  you first use one. `iconMarkup(name)` returns the decorative markup
  (`<span class="icon" aria-hidden="true">`), for use beside text that already
  names the action; the icon is sized `1.2rem` and coloured `--heading`. Icons are
  used only beside labels of things that already work: the nav items (home,
  profile), Post (pencil), Sign in, Sign out and failure messages (error, via
  `setErrorNote()` and the `icon-error` class, which uses the warning colour).
  "Try again" is a plain link without an icon. Icons inside buttons take the
  button's text colour. Don't add links, features or per-status icons (like,
  reply, share, menu) just because an icon exists. Sign out is styled like a nav
  item (under a small "Signed in" label; on phones only the button shows and the
  label is read out, not displayed), and failure messages get a soft tint
  (`--warn-tint`). Post and Sign in use 1.2rem side padding. The `pencil` icon serves both new status
  and edit status.
- A "Skip to content" link is the first focusable element (`.skip-link`, built by
  `mount()`). It is off-screen until focused; its click is handled in the
  document click listener, which focuses `#page` without changing the address.
- Every control needs a visible keyboard focus ring (`:focus-visible` in
  `src/style.css`, including `select`). Text colours were checked against WCAG AA
  (4.5:1) on the panel and band backgrounds; keep new text at or above that.
- Anything that looks interactive must actually work. Decoration must not create
  fake features.
- `[hidden] { display: none !important; }` in `src/style.css` is intentional.
  Without it, rules like `.composer { display: grid; }` override the `hidden`
  attribute in Firefox. Don't remove it without checking that hidden UI stays
  hidden.

## Design direction

The look is a full-resolution illustrated Western world (not pixel art) with a
quiet, readable app interface underneath. The illustration provides the
personality; the HTML/CSS provides the app. Do not steer toward pixel art, retro
OS or terminal looks, or an overt video-game interface.

Current state: two-column layout (account/navigation sidebar plus main status
column) with a palette and proportions sampled from the mockup: a tan page
background, lighter cream panels, a warm header band on the feed, `#351709`
headings, near-black body text, muted text `#6b625b`, a brown "Post" button,
blue links, about 12px radius, and soft warm borders and shadows. See the CSS
variables in `src/style.css`; sizes are in `rem`, and the root font size grows
with the viewport so desktop proportions hold. Avatar slots show the first
letter of the display name until `/avatars/<username>.webp` exists. Chris and Sofie
have theirs (`public/avatars/chris.webp`, `public/avatars/sofie.webp`: 512x512 RGB
quality-92 WebPs, full-bleed artwork with its own sky background; the frame, border and
rounded corners are CSS). A new user needs a same-named square WebP. The display
font is self-hosted Zilla Slab Bold (`public/fonts/zilla-slab-bold.woff2`, used
for the feed heading, profile name and avatar letters). Body text, statuses and controls use self-hosted Nunito
(`public/fonts/nunito-variable.woff`, a Latin subset of the variable font limited to
weights 400-800, `--font-body`), with the system sans-serif as the fallback; form
controls inherit it. Lora (a serif) was tried and rejected because it made the feed
read like a blog, and Poppins because it was too wide for small phones. The masthead is
`public/masthead.webp` (3072x768, 4:1, quality-90 WebP; the original PNG is
kept outside the repo), rendered full width above the app by the `masthead()`
helper in `src/main.js`, with alt text and a visually hidden `h1`. It links to
`/` on every page except the home page (the picture is moved in and out of the
link, never rebuilt, so the image doesn't reload). Under 640px a `<picture>` source swaps in
`public/masthead-mobile.webp` (1536x768, 2:1, quality-90 WebP): a tighter crop of
the same artwork (cowboy, horse, dog and the sign, from x 614 to 2150 of the
3072px original) so the sign stays readable, and the placeholder becomes 2:1. At 360px and under (very small phones)
the side padding, the composer's avatar column and a few font sizes tighten so the
composer placeholder fits on one line and the "Latest first" dropdown isn't clipped.

Page texture (experiment): the tan page background carries a faint wood grain,
`public/textures/wood-grain.webp` (1024x1024 lossy WebP, ~65 KB, drawn at 512px so it
is crisp on high-density screens). It is a seamless tile: the source image had a
visible left/right seam, which was cross-faded away before encoding, and its mean
colour was shifted to `--bg` so the page colour does not change. Lossy WebP adds a
small error at a tile's edge, so re-check the seams (compare the pixel difference
across the tile edge with the difference between ordinary neighbouring columns)
whenever the image is re-encoded, and resize it from a wrapped copy, never plain.
It lives in `:root` in `src/style.css`: `--page-texture` (the image, `none` restores
the flat background), `--wood-veil` (how much flat tan is laid over the grain, 60%;
higher is fainter, 100% is flat) and `--wood-tile` (512px). Only the page background
uses it; the masthead, panels and text are unchanged. Both background layers must keep `repeat`: the page background is only
as tall as the content, so a non-repeating veil stops there and the grain below it shows at
full strength (this was a bug in the first version). `html` also has `min-height: 100%` so the background is at least as tall as the screen on short pages. `color-mix()` is needed for the
veil; a browser without it drops the declaration and shows the flat tan.

Spacing: panels share three variables in `:root` (`src/style.css`): `--gap`
(0.9rem, between panels in both directions and under the masthead), `--inset`
(1.3rem, side padding inside every panel, feed rows included) and `--inset-y`
(0.85rem, top and bottom padding of the sidebar, composer and profile card, so
their avatars line up). Use them instead of new one-off values. The sidebar
identity block uses a tight line-height so the avatar, not the text, sets its
row height. The sidebar identity is the avatar beside the name and @username at every
width; there is no "View profile" link ("My profile" in the navigation goes to the same page). The page's
side margin is about 0.7rem but never under 14px, and feed rows have 0.55rem of
vertical padding. In a feed row the avatar is top-aligned (level with the name)
while the text block is centered, so short posts look centered beside the avatar
and long posts don't leave the avatar floating mid-row.

Feeds: the home feed (everyone) and the profile feed share `createFeedPager()` in
`src/main.js`. A "Latest first / Oldest first" dropdown sits in the panel heading
(`sortSelectMarkup()`); the heading reads "Recent Statuses" for Latest first and
"Oldest Statuses" for Oldest first. Five statuses show at a time, with a "Show older" button
("Show newer" in oldest-first order) that loads the next 5. The pager asks for 6
to know if there are more, and pages by `created_at` past the last status shown
(`lt` for latest first, `gt` for oldest first), not by offset. Changing the order
reloads from the first page, and responses that arrive after the order changed
are dropped. Posting on the home page switches back to "Latest first" so the new
status is visible. The chosen order is remembered in this browser
(`src/sort-order.js`, `localStorage` key `status-rodeo:sort-order`, `asc` or `desc`,
with unit tests): both feeds start in it, and picking an order in either dropdown
saves it for both. It is per browser and device, not in the database, and if
storage is blocked it quietly falls back to Latest first. The switch to Latest first
after posting is temporary and does not change the saved choice. Motion: rows
added by "Show older / newer" spring up one after another (`.status-enter`, 0.45s,
70ms stagger), a status you just posted pops in at the top, and all rows fade in
(`.status-fade`, 0.3s) after the sort order changes. The first page load is not
animated. After a navigation the page area (not the masthead or sidebar) fades
and slides in (`.page-enter`, 0.3s); the first load is not animated. Buttons press down (scale 0.96) when clicked, and "Show older" pulses
while loading. A pressed button's tappable area shrinks with it, so each of those
buttons has an invisible `::after` layer (`inset: -3%`) that keeps the full area
tappable; without it a press near the edge of the wide "Show older" button only
gave it focus and lost the click. Keep that layer if you change the press effect. On iPhones a tap that lands while the page is still moving (a fling or
the bounce at the bottom) reaches the button but gets no click, so the first tap
seemed to do nothing; the pager (`createFeedPager()`) therefore presses "Show
older / newer" itself when a short, still touch ends on it and no click follows (a
normal tap sets a flag first, so it never runs twice). Hover styles are
wrapped in `@media (hover: hover)` so phones never get them (an animated hover style
can make iOS treat the first tap as "just hovering" and skip the click), and links,
buttons and selects have `touch-action: manipulation`. Put new `:hover` rules inside
that media query, and don't animate a hover colour (a `transition` on `background-color`). Keep motion short and subtle, and turn it off under
`prefers-reduced-motion`.

Profile page: the header card shows the avatar, display name and one muted line,
"@username · Joined Sep 2026 · 14 statuses" (the joined month comes from
`profiles.created_at`; the count is a second, head-only query, and is left out
if it fails). The tab title is "Display name (@username) · Status Rodeo". The
feed shows that user's latest 5 public statuses, or "Name hasn't posted yet.",
or "Couldn't load statuses." if the query fails. The line stays on one row so the
card is only as tall as the avatar and lines up with the sidebar: on phones it is
smaller (0.82rem), and if it still doesn't fit it is cut off with an ellipsis. An
unknown username shows "Page not found", and so does any unknown path: a panel
(`.notice`) with the display-font heading and a link back home.

Composer: the text field and its actions are one rounded box (`.composer-fields`,
which draws the focus ring via `:focus-within`): the text on top, then a row with
the live `0/280` counter at the left and the Post button at the right, and any
error message under it. The counter is in the existing muted colour. Under 640px the composer's avatar is hidden (it is
already in the sidebar bar just above) and the box takes the full width. It turns rust and bold with 20 or fewer characters left, and a
visually hidden live region announces the remaining count there. Typing and
pasting stop at 280 Unicode code points (nothing already typed is removed), empty
or over-limit statuses are not sent, and a failed post keeps the text and shows a
short message under the buttons. While a post is in flight (until the feed has
reloaded) the Post button reads "Posting…", keeps its width, is marked
`aria-busy` and ignores further clicks; the text box is read-only until the
insert finishes.

Sign-in: the sidebar form is a real `<form id="login" novalidate>` (Enter submits;
email `autocomplete="username"`, password `current-password`, so password managers
fill it). Empty fields show "Enter your email and password." without a request.
While signing in the button reads "Signing in…", keeps its width, is `aria-busy` and
ignores further submits. A rejected login (HTTP 400/401) shows "Wrong email or
password." and selects the password; anything else (network error, 5xx) shows "Couldn't
sign in. Check your connection and try again." The message is `#login-error`
(`role="alert"`, same tint as other failure messages) and is cleared on the next
attempt and on sign-out. The email is kept, the password is cleared on success.

Failed loads: the profile lookup behind the sidebar identity and the feed queries
are retried twice (after 1 s, then 3 s, `withRetry()` in `src/main.js`, logged
with `console.warn`). If every attempt fails, the sidebar shows "Couldn't load
your profile. Try again" and the feed shows "Couldn't load statuses. Try again",
each with a button that tries once more. The sidebar compares the profile
result with the module's current session rather than calling `getSession()`
again, which could answer "no session" for a moment and silently drop the
identity. Signing out stops the retries.

Loading states: the masthead reserves its 4:1 space with a plain colour. Avatars
(`data-state` loading, loaded or fallback) and the feed (three placeholder rows,
`aria-busy`) show pulsing placeholders until their data arrives, and the
sign-in form stays hidden until the session is known. An avatar that fails or
takes over 8 seconds falls back to its letter. A failed avatar or masthead load
is retried twice in the background (after 1.5 s and 4 s, with a `?retry=n` query
so a cached failure is not reused), and a retry that succeeds replaces the
letter. Each failed attempt is logged with `console.warn` (URL and attempt number)
to help trace why images fail. A user with no avatar file costs two extra small
requests and warnings.

Target:
- A wide illustrated masthead above the app. It is its own image asset, never a
  screenshot of the app or a page background. The words "Status Rodeo" are part
  of the artwork: give the image alt text and keep a visually hidden `h1`. No
  tagline or motto.
- Below it, a calm interface: cream/parchment background, dark brown text, rust
  accents, blue links, subtle tan borders, restrained shadows, comfortable
  spacing. Western display type only for the title and a few headings; normal
  readable type for statuses and controls. Self-host any font.
- Sidebar: account identity and navigation. Main column: composer and feed. Feed
  rows are simple (avatar, name, time, text), with no decoration on individual
  statuses.
- Avatars are illustrated image assets named by username (for example
  `/avatars/<username>.webp`), chosen over a database column for now. Changing an
  avatar or the interface must never require changing the masthead.
- Times are relative, as in the mockup (`src/relative-time.js`, with unit tests):
  "just now", "5 minutes ago", "2 hours ago", "1 day ago" up to 6 days, then a
  plain date ("Oct 7", or "Oct 7, 2025" from another year). The exact time is in
  the `<time>` element's tooltip (`title`) and `datetime`. Visible times refresh
  every minute while a page stays open.
- The mobile layout is designed deliberately, not by scaling the desktop layout
  down. The masthead crop is done; the column collapse and the rest of the phone
  layout are still to be reviewed.

A mockup is a visual reference, not a feature list. These controls appear in it
but are not built, and are not to be added without asking: Settings, a "Post a
status" nav link, a users list, per-status menus.
