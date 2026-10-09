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
  otherwise not-found) and all views. The sidebar is shared by the home and
  profile pages: `sidebarMarkup()` renders it and `initSidebar()` handles sign-in,
  sign-out and the signed-in identity, with `onSession` and `onProfile` hooks (the
  home page uses them for the composer). Change the sidebar in those two
  functions, not per page.
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
for the feed heading, profile name and avatar letters). The masthead is
`public/masthead.webp` (3072x768, 4:1, quality-90 WebP; the original PNG is
kept outside the repo), rendered full width above the app by the `masthead()`
helper in `src/main.js`, with alt text and a visually hidden `h1`. It links to
`/` on every page except the home page. Under 640px a `<picture>` source swaps in
`public/masthead-mobile.webp` (1536x768, 2:1, quality-90 WebP): a tighter crop of
the same artwork (cowboy, horse, dog and the sign, from x 614 to 2150 of the
3072px original) so the sign stays readable, and the placeholder becomes 2:1.

Spacing: panels share three variables in `:root` (`src/style.css`): `--gap`
(0.9rem, between panels in both directions and under the masthead), `--inset`
(1.3rem, side padding inside every panel, feed rows included) and `--inset-y`
(0.85rem, top and bottom padding of the sidebar, composer and profile card, so
their avatars line up). Use them instead of new one-off values. The sidebar
identity block uses a tight line-height so the avatar, not the text, sets its
row height. From 640px to 1119px the sidebar is under about 240px wide, so its
avatar stacks above the name (side by side, "View profile →" wraps). The page's
side margin is about 0.7rem but never under 14px, and feed rows have 0.55rem of
vertical padding. In a feed row the avatar is top-aligned (level with the name)
while the text block is centered, so short posts look centered beside the avatar
and long posts don't leave the avatar floating mid-row.

Composer: a live `0/280` counter sits left of the Post button in the existing
muted colour. It turns rust and bold with 20 or fewer characters left, and a
visually hidden live region announces the remaining count there. Typing and
pasting stop at 280 Unicode code points (nothing already typed is removed), empty
or over-limit statuses are not sent, and a failed post keeps the text and shows a
short message under the buttons. While a post is in flight (until the feed has
reloaded) the Post button reads "Posting…", keeps its width, is marked
`aria-busy` and ignores further clicks; the text box is read-only until the
insert finishes.

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
- Times stay absolute (for example "Oct 7, 6:40 AM"). The mockup's relative
  times are illustrative; do not change this without asking.
- The mobile layout is designed deliberately, not by scaling the desktop layout
  down. The masthead crop is done; the column collapse and the rest of the phone
  layout are still to be reviewed.

A mockup is a visual reference, not a feature list. These controls appear in it
but are not built, and are not to be added without asking: Settings, a "Post a
status" nav link, a users list, sort controls, per-status menus.
