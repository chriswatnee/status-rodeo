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
  `functions/` endpoints; `/api/users/<username>/status` returns the HTML app shell instead of JSON.
- `npm run build` : production build into `dist/`
- `npm run preview` : preview the build
- To test the API locally: `npm run build`, then `npx wrangler pages dev dist`.
  Wrangler only gives the functions their Supabase variables if a `.dev.vars`
  file in the project root defines `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`. Without it, `env.VITE_...` is undefined and
  the endpoints return 500. `.dev.vars` is gitignored.

- `npm test` : unit tests (Node's built-in runner, no dependencies) for the status
  length rule, the posting logic, the avatar icons and the avatar save, the status delete and edit, the hat tips logic, the status id
  parser, link detection, the profile page's feed autodiscovery and link previews, the status link previews, the default preview tags in `index.html`, the composer placeholders and the RSS feeds in `tests/`.

There are no linters. Before finishing a change, run `npm test` and
`npm run build`, and check the affected pages in the browser.

## Deployment

Cloudflare Pages project `status-rodeo`, connected to the GitHub repo. Every push
to `main` deploys to production automatically (status.rodeo, also
status-rodeo.pages.dev).

Build settings: framework preset None, build command `npm run build`, output
directory `dist`, root directory blank.

Client-side routes such as `/users/<username>` and `/statuses/<id>` work through
Cloudflare Pages' SPA fallback. No `_redirects` file is needed. Because of that
fallback, a missing or non-public status still answers HTTP 200 (the app draws its
"Page not found" view); there is no real 404 status for client routes.

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
  `/statuses/:id`, `/profile/edit`, otherwise not-found) and all views. Links to app pages are intercepted and
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
- `src/status-id.js` parses the id in `/statuses/<id>` (plain positive whole numbers, no
  leading zeros, at most 15 digits; anything else is null and the page is not-found
  without a request). It has unit tests.
- `src/linkify.js` finds web addresses in a status (plain text in, parts out, never HTML; unit
  tested). Only `http://` and `https://` addresses count; sentence punctuation at the end is
  not part of the link and a closing bracket is only kept if the address opened one; an
  address with a username or password, or a host without a dot, stays plain text. It also
  returns `@name` as a `mention` part (see "Mentions" under Design direction). The
  page builds the nodes in `fillStatusText()` (`src/main.js`, used by `createStatusRow()`).
- `src/placeholders.js` is the list of Western-flavoured placeholder lines for the composer and
  `pickPlaceholder()`, which chooses one at random and never the same as the last one (unit
  tested, including a length cap). `renderHome()` sets the textarea's `placeholder` from it.
- `src/avatar-icons.js` is the list of the 12 avatar icons (name and label, in picker order),
  `DEFAULT_AVATAR` (`cowboy-hat`, the same as the database default) and `avatarName()` /
  `avatarPath()` / `avatarLabel()`. Any value that is not one of the icons (missing, from a
  newer or older version) becomes the default, so there is always an icon and a stored value
  never reaches a URL unchecked. No DOM, so the functions use it too. Unit tested, including
  that `public/avatars/icons/` holds exactly these files.
- `src/set-avatar.js` saves the signed-in user's choice: `setAvatar()` updates only the
  `avatar` column of their own row and checks that one row changed (a refused update is not an
  error to PostgREST). Results are ok, `unknown` (not an icon, nothing sent), `session-expired`
  or `failed`; never throws. Unit tested. The picker is `showAvatarEditor()` on the Edit profile
  page (`renderEditProfile()` in `src/main.js`), a form with Save and Cancel; see "Edit profile
  page" under Design direction.
- `src/delete-status.js` deletes one of the signed-in user's own statuses (no DOM, unit tested):
  `deleteStatus()` runs `delete().eq('id', id).select('id')` and counts the rows that come back, because
  a refused delete is not an error to PostgREST. Zero rows is followed by one read: the status is gone
  (deleted elsewhere) counts as done, still there means refused. Results are ok, `invalid` (id not a
  positive whole number, nothing sent), `session-expired` or `failed`; never throws. The "…" menu that
  uses it is `createStatusMenu()` / `showDeleteConfirm()` in `src/main.js`; see "Your own statuses"
  under Design direction.
- `src/update-status.js` edits the content of one of the signed-in user's own statuses (no DOM, unit
  tested): `updateStatus()` validates the trimmed text with `validateStatus()` (same 1 to 280 rule as
  posting), runs `update({ content }).eq('id', id).select('id, content, edited_at')` and counts the rows
  that come back (a refused update is not an error to PostgREST). Zero rows is followed by one read: the
  status is gone means `gone`, still there means refused (`failed`). Results are ok (with the saved
  `content` and `editedAt`), `empty`, `too-long`, `invalid`, `gone`, `session-expired` or `failed`; never
  throws. The editor is `startEdit()` in `src/main.js`; see "Your own statuses" under Design direction.
- `src/status-limit.js` is the 280-character rule (counts Unicode code points, so
  it matches Postgres `char_length`); `src/post-status.js` validates and inserts a
  status. Both are plain modules with unit tests.
- `src/hat-tips.js` is the Hat Tips logic (no DOM, unit tested): `fetchHatTipInfo()`
  (one `hat_tip_info` request for counts and "is it mine" for a list of status ids),
  `setHatTip()` (insert or delete, idempotent, tells an expired session from other
  failures) and `createHatTipStore()` (what every button shows, keyed by status id;
  optimistic update with rollback, one save at a time per status). The button is built
  by `createHatTipActions()` in `src/main.js`; see "Hat tips" under Design direction.
- `src/rss.js` and `src/feed.js` are the RSS feeds (no DOM, unit tested). `rss.js` turns
  rows into RSS 2.0 text (escaping, removal of characters XML forbids, the short plain
  title, canonical URLs); `feed.js` reads the public statuses through a Supabase client
  that is passed in and builds the `Response` (`sitewideFeed()`, `userFeed()`). They live
  in `src/` on purpose: only `functions/` is scanned for routes, and the client never
  imports them. See "RSS feeds" under API.
- `src/user-page.js` is the feed autodiscovery and link preview for a profile page (no DOM, unit tested
  with a fake `HTMLRewriter`): `userPage()` takes the app shell the SPA fallback gives for
  `/users/<username>`, looks the user up (one `profiles` query for `username, display_name, avatar`, 1.5 s
  limit) and, if they exist, adds `<link rel="alternate" type="application/rss+xml" title="Name (@user) ·
  Status Rodeo" href="/users/<username>/feed.xml">` just before the sitewide one, removes the shell's
  default preview tags and appends the user's own (title "Name (@user)", description "Statuses from Name
  (@user) on Status Rodeo.", canonical `https://status.rodeo/users/<username>`, the avatar icon). It sends
  the page unchanged on any problem (unknown or invalid username, failed or slow lookup, HEAD, non-HTML).
  The entry point is `functions/users/[username]/index.js`. See "RSS feeds" under API and "Link previews"
  under Design direction.
- `src/preview-tags.js` builds the Open Graph / Twitter tags shared by the status and profile pages
  (`previewTagsMarkup()`, always the small `summary` card with a 512x512 square picture),
  `PREVIEW_TAGS_SELECTOR` (what the functions remove from the shell before adding their own) and
  `escapeAttribute()`. `index.html` carries the default set for the home page and any page without its
  own; `tests/index-html.test.js` checks the shell's tags all match the selector and the picture exists.
- `src/status-page.js` is the link preview for a status address (no DOM, unit tested with a fake
  `HTMLRewriter`): `statusPage()` takes the app shell for `/statuses/<id>`, reads the public status
  with its author (`id, content, profiles(display_name, username, avatar)`, 1.5 s limit), removes the shell's
  default preview tags and appends Open Graph tags to the head: `og:title` "Status by Name (@user)",
  `og:description` (the status on one line, cut at 200 characters), `og:url` (canonical
  `https://status.rodeo/statuses/<id>`), `og:image` (the author's avatar icon,
  `/avatars/icons/<name>.webp`, 512x512; the default icon for an unknown value), `og:site_name` and
  `twitter:card` `summary` (the small card). It sends the page unchanged on any problem (invalid id,
  missing or private status, failed or slow lookup, HEAD, non-HTML), which includes the `avatar` column
  not existing yet. The entry point is `functions/statuses/[id]/index.js`. Same pattern and caveats as
  `src/user-page.js`.
- API handlers live in `functions/api/`. The feed endpoints are `functions/feed.xml.js`
  and `functions/users/[username]/feed.xml.js` (each just creates the client and calls
  `src/feed.js`).
- The folder `functions/api/users/[username]/` must be named with literal square
  brackets. With any other name, `params.username` is undefined.

## API

- `/api/users/<username>/status` returns the latest public status for one user.
- This is the only JSON endpoint. The sitewide `/api/status` (latest status from
  anyone) was removed on 2026-10-12 because nothing used it; the owner's personal
  site uses the per-user endpoint.

### RSS feeds

- `/feed.xml`: RSS 2.0 of the 30 newest public statuses from everyone.
- `/users/<username>/feed.xml`: the same for one user (404 if there is no such user;
  an empty valid feed if they have no public statuses). The username must match
  `[A-Za-z0-9_.-]{1,50}` and the case must match exactly, otherwise it is a 404 without a
  database request.
- Newest first: `created_at` descending, then `id` descending (so statuses posted in the
  same instant have a fixed order). Both queries filter on `visibility = 'public'` and
  use the public key, so Row Level Security applies as on the site. User ids and email
  addresses are never selected or output.
- Each item: `<title>` is the status on one line, cut at 80 characters with an ellipsis;
  `<description>` is the complete text as plain text (escaped for XML, never HTML);
  `<link>` and `<guid>` are `https://status.rodeo/statuses/<id>`; `<pubDate>` is RFC 822;
  `<dc:creator>` is the display name (RSS's own `<author>` needs an email address, so it
  is not used). Characters XML forbids are removed, and a status that is empty after that
  is left out, because one bad status must not break the feed. Hat tip counts are not in
  the feeds.
- Links, GUIDs and the feed's own `atom:link rel="self"` always use `https://status.rodeo`,
  even when the feed was fetched from a preview or pages.dev, so a status keeps one GUID.
  `lastBuildDate` is the newest item's date, not the request time.
- Responses: `Content-Type: application/rss+xml; charset=utf-8`, `Cache-Control: public,
  max-age=300`. GET and HEAD work (HEAD has no body); other methods are 405. Failures are a
  plain-text 500 with `no-store`; an unknown user is a 404 with `max-age=60`. There is no
  Cloudflare Cache API layer: add one only if real usage shows database load.
- Autodiscovery: `index.html` has a `<link rel="alternate" type="application/rss+xml">` for
  `/feed.xml` on every page. A profile page also advertises that user's feed: a function in front of
  `/users/<username>` (`functions/users/[username]/index.js`, logic in `src/user-page.js`) calls
  `next()` for the app shell and, for an existing user, inserts a per-user link before the
  sitewide one with `HTMLRewriter` (feed readers do not run the app's JavaScript, so it has to be
  in the HTML the server sends). The function costs one small database query per full page load
  of a profile (not for in-app navigation), is skipped for HEAD, and never breaks the page. Its
  ETag is removed because the body is changed. `npm run dev` does not run it (like the feeds).
  Cloudflare-only behaviour (`next()` returning the SPA fallback, `[username]/index.js` matching
  `/users/<name>` and `/users/<name>/`, `HTMLRewriter`) cannot be run in the unit tests, so
  check it on a preview after changing it: `curl -s https://<preview>/users/chris | grep alternate`
  should show the user's link first, then the sitewide one, and `/users/nobody` only the sitewide one.
- `npm run dev` does not run the feeds (like `/api/users/<username>/status`, `/feed.xml` returns the app
  shell); test them with `wrangler pages dev` or a Cloudflare preview. Verified in
  Cloudflare's documentation: `[username]` matches one path segment, Functions run before
  static files and the SPA fallback, a trailing slash reaches the same Function, and
  `onRequest` receives every method (so HEAD is handled in the code). Not covered by the
  documentation, so check it on a preview after changing it: that `feed.xml.js` becomes
  `/feed.xml`.

## Data and security

Supabase was set up partly by hand in the dashboard. `supabase/schema.sql` is a
snapshot of the tables, foreign keys, RLS, and policies. It is not a migration,
and nothing applies it automatically. This section and that file were checked
against the live database on 2026-10-06. The live database is authoritative: if
either disagrees with it, trust the database and fix them.

`supabase/live-state-check.sql` is the read-only "docs vs live database" check (22 rows, one SELECT,
changes nothing, no rollback needed): tables and columns, keys and foreign keys, the two CHECKs, RLS,
the exact policies and their conditions, table and column privileges of `anon` and `authenticated`,
the triggers (including that none on `auth.users` creates profiles), the two app functions (not Supabase's `rls_auto_enable()`), storage
buckets and a few data sanity rows. Every row must say `ok = true`; `detail` shows what it found.
It passes on a database built from `schema.sql` and fails when any one of a dozen objects is changed
(tested on local Postgres 16 on 2026-10-12). Run it in the Supabase SQL editor after any change made
by hand in the dashboard, and fix the docs or the database for any false row. It was run against
production on 2026-10-12 (by Sofie): 19 of 22 rows were `ok = true`, and the policies matched exactly.
The three differences were docs errors, not database problems: `created_at` is NOT NULL on `statuses`
and `profiles` (the docs said nullable), and `public` also holds Supabase's own `rls_auto_enable()`
(SECURITY DEFINER, `search_path` pg_catalog, executable by `anon` and `authenticated`), which the
function check now ignores. Docs, `schema.sql` and the script were corrected to match; the corrected
script has not been re-run on production yet. Its header lists what
SQL cannot see (auth settings, GraphQL, project pausing), which are checked by hand in the dashboard.

Tables:
- `statuses`: `id` int8 identity primary key, `user_id` uuid not null, `content`
  text not null (1 to 280 characters, see below), `visibility` text not null default `'public'`, `created_at`
  timestamptz not null default now().
- `profiles`: `user_id` uuid primary key, `created_at` timestamptz not null default now(),
  `username` text not null unique, `display_name` text not null, `avatar` text not null
  default `'cowboy-hat'` (see "Avatar icons" below).

Foreign keys (all NO ACTION): `statuses.user_id` references both `auth.users.id`
and `profiles.user_id`; `profiles.user_id` references `auth.users.id`. Keep the
`statuses` to `profiles` key. The feed query embeds
`profiles(display_name, username)`, and without that relationship PostgREST
returns PGRST200.

Other facts:
- Posting writes directly from the browser to Supabase (the Cloudflare Functions
  are read-only). A status is 1 to 280 characters and cannot be blank. This is
  enforced twice: in the browser (`src/status-limit.js`) and by the database CHECK
  constraint on `statuses.content` (named `statuses_content_length_check` in production; this file
  and `schema.sql` used to say `statuses_content_check`, which was wrong, found 2026-10-12)
  (`char_length(content) between 1 and 280 and content !~ '^\s*$'`), which is
  validated and was checked against production on 2026-10-08. Both count Unicode code
  points (Postgres `char_length`), so an emoji is 1 character and a flag is 2. A
  violation comes back as Postgres error `23514`; the browser shows its generic
  "Couldn't post" message and keeps the text. If you change the limit, change it in
  both places.
- The app only uses `visibility = 'public'`. There is no CHECK constraint on
  `visibility`. The content length constraint is the only CHECK constraint on `statuses`.
- No trigger creates a profile when an Auth user is created. Profiles are
  provisioned by hand, so creating an Auth user alone does not give a working
  account.

Hat tips (live in production): `hat_tips (status_id, user_id, created_at)` with primary
key `(status_id, user_id)`, foreign keys to `statuses(id)` and `auth.users(id)` both
`ON DELETE CASCADE`, RLS with select/insert/delete policies on the caller's own rows
(insert also requires a public status; there is no update), table privileges for
`authenticated` only (select, insert, delete; none for `anon`), and
`hat_tip_info(bigint[])`, a `SECURITY DEFINER` function owned by `postgres` with an empty
`search_path`, executable by `anon` and `authenticated`, that returns counts and the
caller's own tipped flag for up to 100 public statuses and never user ids. The SQL is
`supabase/hat-tips.sql` (also copied into `supabase/schema.sql`). It was applied by hand
(by Muse) and checked with `supabase/hat-tips-verify.sql` on 2026-10-10: preflight 5 of 5,
verification 27 of 27, owner check confirmed (as reported to Chris; the results were not
pasted into the session). Re-run the verify script after any change to either object; every
row must say `ok = true` and it changes nothing permanently (it only skips a couple of
`statuses` ids). The three older sections here were last checked against the live database
on 2026-10-06, and the check constraint on 2026-10-08.

Avatar icons (live in production): `profiles.avatar` is text, not null, default `'cowboy-hat'`,
with the CHECK `profiles_avatar_check` (plain kebab-case, at most 40 characters; it does not list
the icons, so a new icon needs no SQL). UPDATE on `profiles` is taken away from `anon` and
`authenticated` and granted back to `authenticated` on the `avatar` column only, and the policy
"Users can update their own profile" (`profiles` update, role `authenticated`, using and with check
`(select auth.uid()) = user_id`) limits it to your own row. The column grant is what keeps
`username`, `display_name`, `user_id` and `created_at` read-only from the Data API. The SQL is
`supabase/avatar-icons.sql` (also copied into `supabase/schema.sql`). It was applied by hand (by
Muse) and checked with `supabase/avatar-icons-verify.sql` on 2026-10-11: 20 of 20 rows `ok = true`,
and every existing profile showed `cowboy-hat` (as reported to Chris; the results were not pasted
into the session). Re-run the verify script after any change to these objects; it rolls back
everything it does. Code that selects `avatar` needs the column to exist: a select that names a
missing column fails, which would break every feed. The three older sections here were last
checked against the live database on 2026-10-06, and the check constraint on 2026-10-08.

Edit and delete (live in production): `supabase/status-edit-delete.sql` adds `statuses.edited_at
timestamptz` (null until the content is first changed; a trigger sets it, only when `content` really
changes), the policy "Users can update their own statuses" plus `UPDATE (content)` for `authenticated`
only (so `id`, `user_id`, `visibility`, `created_at` and `edited_at` stay read-only from the Data API),
and "Users can delete their own statuses" plus `DELETE` for `authenticated` (hat tips go with a deleted
status through `ON DELETE CASCADE`). `anon` has neither UPDATE nor DELETE. It was applied by hand (by
Muse) on 2026-10-12 and checked with `supabase/status-edit-delete-verify.sql`: 23 of 24 rows
`ok = true` at first (all behaviour checks passed; the false row was the script's check on the
constraint's name, since replaced by a check on what the constraint enforces; the results were not
pasted into the session). Re-run on 2026-10-12 after the fix: 24 of 24 `ok = true` (as reported to Chris).
Re-run it after any change to these objects; it rolls back everything it does. Code may now select
`statuses.edited_at`; the delete UI uses the delete policy and the edit UI the update policy.

Row Level Security is enabled on `profiles`, `statuses` and `hat_tips`. Policies on
`profiles` and `statuses`:
- "Public statuses are viewable": `statuses` select, role `public`, using
  `visibility = 'public'`
- "Users can create their own statuses": `statuses` insert, role `authenticated`,
  with check `(select auth.uid()) = user_id`
- "Public profiles are viewable": `profiles` select, role `public`, using `true`
- "Users can update their own profile": `profiles` update, role `authenticated`, using and with
  check `(select auth.uid()) = user_id` (only the `avatar` column is updatable, see above)
- "Users can update their own statuses": `statuses` update, role `authenticated`, using and with
  check `(select auth.uid()) = user_id` (only the `content` column is updatable, see above)
- "Users can delete their own statuses": `statuses` delete, role `authenticated`, using
  `(select auth.uid()) = user_id`
- These are the only policies on those two tables. There are no insert or delete
  policies on `profiles`.
  (`hat_tips` has its own three policies, described above.)

Writes through the Data API are governed only by these policies. There are no
storage buckets, and GraphQL is disabled.

The `anon` and `authenticated` roles hold every table privilege on `profiles` (except UPDATE, see
Avatar icons above) and `statuses` (the Supabase default; `hat_tips` is stricter, see above), so RLS is the only thing limiting access. Never disable
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
- Icons: the Status Rodeo icon family is 26 hand-drawn 24x24 SVGs in `src/icons/`
  (one file each, kebab-case names: home, profile, users, search, notifications,
  settings, sign-out, sign-in, edit-profile, pencil, delete, reply, like, share,
  copy-link, more, refresh, history, success, warning, error, info, close, back,
  external-link, hat-tip). They are drawn with `currentColor`, a 1.8 stroke, round caps and
  joins, and a soft 18% fill in the same colour; no gradients. Only icons imported
  in `src/icons.js` are bundled (Vite `?raw`), so add an import and an entry when
  you first use one. `iconMarkup(name)` returns the decorative markup
  (`<span class="icon" aria-hidden="true">`), for use beside text that already
  names the action; the icon is sized `1.2rem` and coloured `--heading`. Icons are
  used only beside labels of things that already work: the nav items (home,
  profile), Post (pencil), Sign in, Sign out, Edit profile (edit-profile), the Tip your hat button (hat-tip), the owner's "…" menu button (more) and its Delete item (delete) and
  failure messages (error, via
  `setErrorNote()` and the `icon-error` class, which uses the warning colour).
  "Try again" is a plain link without an icon. Icons inside buttons take the
  button's text colour. Don't add links, features or per-status icons (like,
  reply, share) just because an icon exists; the hat tip is the only per-status control for
  everyone, the "…" menu is for the status's owner only (see "Your own statuses"), and the heart
  (`like`) stays unused. Sign out is styled like a nav
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
background, lighter cream panels, a warm header band on the feed (its heading is 1.5rem on
screens 640px and wider), `#351709` headings, near-black body text, muted text `#6e6055`
(a warm grey-brown, 5.3:1 on the panels), a pale peach active nav item (`--nav-active`), a brown "Post" button with cream
text (`--button-text`, not pure white), warm rust-brown links (`--link` `#8a3f14`, 6.6:1 on the panels; the
keyboard focus ring has its own `--focus`), avatars with a 1px mid-brown border
(`--avatar-border`, matching the 1px panel edges), about 12px radius, text fields (the composer box and the sign-in inputs) have a stronger 1px edge (`--border-strong` `#a98258`, 3.1:1 on the panel, the WCAG minimum for a field's boundary) than the panels' `--border`, and soft warm borders and shadows. See the CSS
variables in `src/style.css`; sizes are in `rem`, and the root font size grows
with the viewport so desktop proportions hold. Avatar icons: every avatar is one of 12 Western
objects (`public/avatars/icons/<name>.webp`: bandana, cactus, cattle-skull, coffee-mug,
coiled-rope, cowboy-boot, cowboy-hat, guitar, horseshoe, lantern, sheriff-star, wagon-wheel),
chosen by its owner and stored in `profiles.avatar`; see `src/avatar-icons.js`. There are no
uploads, no per-user files (the old `public/avatars/chris.webp` and `sofie.webp` were removed;
they are in git history) and no letter fallback: a profile without a valid value shows the
default (cowboy hat). The frame, border and rounded corners are CSS. Spec for any new icon, so the
set stays cohesive: 512x512 square, opaque sRGB WebP (quality 90, 24-40 KB), no alpha, no baked
border, shadow or rounded corners. One shared flat parchment background (about `#f8ce87` at the
edges; backgrounds were colour-matched to it, only background-coloured pixels shifted); keep
the outer edge quiet. One centred object, dark-brown outline, painterly shading lit from the
upper left, small ground shadow, site palette, no text. Keep the object within about 72% of the
width (up to 85% for wide ones like the hat and skull), nothing near a corner (the avatar radius
clips there), and a bold silhouette that still reads at 44px (the smallest avatar). The art
was made in ChatGPT as 1254x1254 PNGs; the originals are kept outside the repo. Adding an icon
means adding the file, an entry in `AVATAR_ICONS` (the test checks the folder matches the list)
and nothing in the database. The display
font is self-hosted Zilla Slab Bold (`public/fonts/zilla-slab-bold.woff2`, used
for the feed heading and profile name). Body text, statuses and controls use self-hosted Nunito
(`public/fonts/nunito-variable.woff`, a Latin subset of the variable font limited to
weights 400-800, `--font-body`), with the system sans-serif as the fallback; form
controls inherit it. Lora (a serif) was tried and rejected because it made the feed
read like a blog, and Poppins because it was too wide for small phones. The masthead is
a painted picture of a blank hanging wooden sign at sunset. The desktop artwork is an
AI upscale (4284x804, about 5.3:1) of the original 2142x402 painting, shipped as three WebPs
at quality 90, made by Lanczos downsizing: `public/masthead-1700.webp` (~115 KB),
`masthead-2550.webp` (~200 KB) and `masthead-3400.webp` (~305 KB). The `<img>` picks one with
`srcset` (width descriptors) and `sizes="min(1698px, calc(100vw - 28px))"`, so a 1x screen
gets 1700 and a 2x screen gets up to 3400, always at least one image pixel per device pixel
(no browser upscaling). Note that `naturalWidth` of an `<img srcset>` reports the layout
size, not the file's width; read the width from `currentSrc`. The originals are kept outside
the repo. It is built by the `masthead()` helper in `src/main.js`. The words "Status Rodeo" are real
text, not part of the picture: the page's visible `h1` (`.masthead-title`, Zilla Slab
Bold, cream with a dark outline) is laid over the sign by the CSS, sized with container
units (`cqw`, the masthead is a size container) so it keeps its place on the sign at every
width. The picture is therefore decorative (`alt=""`). The masthead is a framed, rounded
picture with the same outer edges as the content container (`.site`) below it, so it is as
wide as the sidebar and feed together (at most 81rem, about 1698px, because the container
stops growing there). The image retry (see Loading states) removes `srcset` and `sizes`
before setting a `?retry=n` `src`, because `srcset` would otherwise override it. Under 640px a `<picture>` source
swaps in `public/masthead-mobile.webp` (1250x402, 3.1:1, quality-90 WebP): the middle of the
same artwork, full height, centred on the sign (the sign is too wide for anything squarer). The title links to `/` on every page except
the home page (`setMastheadLink()` swaps the h1's text for a link; the picture is never
touched, so it doesn't reload), and the link's `::after` covers the whole masthead so the
picture is clickable too; its keyboard focus ring is drawn around the masthead. If you
change the artwork, re-check where the sign is: the title's position and size are
`--title-y` and `--title-size` in `.masthead` (desktop and the phone block). At 360px and under (very small phones)
the composer's text padding and a few font sizes tighten so the
composer placeholder fits on one line and the "Latest first" dropdown isn't clipped.

Icons for the browser tab and home screen: the star under the title on the masthead's sign, cropped
square from the 4284x804 upscaled artwork (so about 1:1, no upscaling) with the wood behind it.
`public/favicon.ico` (16, 32 and 48px), `public/favicon-192.png` (192px) and
`public/apple-touch-icon.png` (180px, full-bleed, iOS rounds the corners itself) are linked from
`index.html`. They are static files like the avatars; the originals are kept outside the repo.
If the artwork changes, re-crop them (star centre about x=2145, y=523 in the 4284x804 image;
150px window for the favicon, 166px for the apple icon, which keeps the neighbouring rivets out).

Browser colour and description: `index.html` has `<meta name="theme-color" content="#f5dab3">` (the
page background, `--bg`, so a phone's address bar and status area blend into the page; keep the two in
step if `--bg` changes) and a `<meta name="description">` for search results and link previews of the
home page. Both live in the app shell, so every page (profiles and statuses too) carries them;
a status page's own Open Graph tags are added by the function on top.

Page background: flat `--bg` (`#f5dab3`), the same value as the `theme-color` meta, so a phone's
address bar blends into the page. A faint wood-grain tile was tried and removed on 2026-10-12 (it is in
git history); `html` keeps `min-height: 100%` so the colour covers short pages.

Spacing: panels share three variables in `:root` (`src/style.css`): `--gap`
(0.9rem, between panels in both directions and under the masthead), `--inset`
(1.3rem, side padding inside every panel, feed rows included) and `--inset-y`
(0.85rem, top and bottom padding of the sidebar, composer and profile card, so
their avatars line up). On phones (under 640px) the same variables are 1rem and 0.65rem, so the sidebar
bar, composer and feed share one left edge (checked at 320, 360, 390 and 430px) and the composer
matches the sidebar's height padding; the gap between panels stays 0.9rem everywhere. Use them instead of new one-off values. The sidebar
identity block uses a tight line-height so the avatar, not the text, sets its
row height. The sidebar identity is the avatar beside the name and @username at every
width (each on one line, cut off with an ellipsis if very long; its grid column is
`minmax(0, 1fr)`, because an auto column grows to fit a long username and pushes it out of the card); there is no "View profile" link ("My profile" in the navigation goes to the same page). The page's
side margin is about 0.7rem but never under 14px, and feed rows have 0.45rem of
vertical padding. Avatars have a 0.5rem radius (`--radius-avatar`, a touch rounder than small
controls, closer to the panels' 0.6rem); in the feed rows (and their loading placeholders) they
are 3.5rem on screens 640px and wider, while the sidebar, composer and profile card keep `--avatar`
(4rem) so their avatars line up, and the phone sizes are unchanged. In a feed row the avatar is top-aligned (level with the name)
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
smaller (0.82rem; 0.78rem at 360px and under), at 340px and under the word "Joined" is dropped
from view (it is its own `span.joined-word`, kept for screen readers, and `.profile p` is
`position: relative` so it stays inside the clip), which makes the usual line fit at 320, 360, 390
and 430px; if it still doesn't fit (a very long username) it is cut off with an ellipsis. An
unknown username shows "Page not found", and so does any unknown path: a panel
(`.notice`) with the display-font heading and a link back home.

Edit profile page: `/profile/edit` (`renderEditProfile()`, a trailing slash is accepted; `/profile`
and anything longer are not-found) is where you change your avatar. Everyone's profile page is
unchanged except that the signed-in owner sees an outlined "Edit profile" button (the `edit-profile`
icon, `a.profile-edit#profile-edit`) inside the profile card. From 900px it is a pill at the card's
right edge, level with the avatar; below that it wraps onto its own full-width line under the identity
(44px tall), because the card's one-line "@name · Joined … · 14 statuses" needs the room (a button
beside it cut it off at every phone width; `.profile > div` is `flex: 1 1 0` so the identity never
wraps itself). Same pattern as other social apps (Twitter/X, Instagram, GitHub). The page is a `.feed-panel` headed "Edit profile": your avatar, name
and @username, then "Avatar" with the 12 icons as buttons (`.avatar-choice`, `aria-label` and tooltip
the icon's name, `aria-pressed` on the chosen one, which also gets a ring and a check so it is not
shown by colour alone; four columns on phones, up to six per row on wide screens, at least 44px
each), then a note, the Save and Cancel buttons and "Back to my profile". The page is a real
`<form class="edit-form" novalidate>`. The avatar is the only thing to edit: the database only lets you
update that column (see Data and security). Picking an icon only previews it on this page (the avatar
beside your name and the pressed icon change; the sidebar, composer, profile card and feed rows keep the
saved one) and the note says "Not saved yet." Save (`.edit-save`, styled like Post and sharing its
press, busy and 44px-area rules) is disabled until the choice differs from the saved icon; Cancel
(`.edit-cancel`, outlined like the Edit profile button) puts the saved icon back and clears the note;
picking the saved icon again also counts as no change. Save sends one `setAvatar()`: while it runs the
button reads "Saving…" (same width, `aria-busy`), Cancel and the icons are inert, and nothing else can
start (one save at a time). On success the avatar changes everywhere on the page right away (sidebar,
composer, the avatar on this page, your profile card and your rows, through `showAvatarEverywhere()`),
the page stays where it is, the live note says "Avatar saved as cactus." and focus moves to the chosen
icon (the disabled Save button can't keep it). If the save fails nothing outside this page ever changed;
the choice stays selected with "Couldn't save your avatar. Try again." so Save can be tried again, and
Cancel drops it; if the login is gone you are signed out locally and the sign-in form says "Your
session expired. Sign in again to change your avatar." Leaving the page with an unsaved choice drops it
without asking (it is only an icon). More fields are planned: each needs its own column grant, a CHECK
constraint and verify checks in SQL first (the `username` is deliberately not meant to become
editable: `/users/<username>` addresses and the owner's personal-site API depend on it). A signed-out visitor sees "Sign in to edit your profile." and the editor appears
when they sign in (`setPageHooks`; a refreshed session does not rebuild it under someone who is
choosing); if the profile can't be loaded it says "Couldn't load your profile." The tab title is
"Edit profile · Status Rodeo". The 12 files are not lazy-loaded here: it is a page you open on
purpose. Feed rows carry `data-username` so their avatars can be swapped.

Status page: `/statuses/<id>` (`renderStatusPage()`) is the stable address of one
status, by its numeric id so it survives a username change. It is a `.feed-panel` with
the heading "Status" and the same status row as the feeds (hat tip included, same shared
state). It is one query for a public status with its author (`profiles(display_name,
username)`), retried like the feeds. A bad id (see `src/status-id.js`) makes no request
and shows "Page not found"; so does a status that is missing or not public (private ones
are hidden by RLS and by the explicit `visibility = 'public'` filter). A failed request
is not "Page not found": it shows "Couldn't load this status." with a "Try again"
button. The tab title is "Status by Display name (@username) · Status Rodeo". The time on
every status row (`a.status-time` around the `<time>`, built in `createStatusRow()`) is the
link to it, so a visitor can open it, copy its address or open it in a new tab; plain
clicks navigate in the app, modified clicks are left to the browser. A trailing slash is
accepted.

Link previews: a pasted link shows a small card (the `summary` card with a square picture, on
purpose: a large card would need a separate 1200x630 image per page). Chat apps read the HTML the
server sends and do not run the app's JavaScript, so there are three levels. The home page (and any
page without its own, such as not-found and Edit profile) uses the default set in `index.html`: title
"Status Rodeo", the same description as the meta description, `og:url` `https://status.rodeo/` and the
Sheriff star avatar icon as the picture. A profile (`/users/<username>`, `src/user-page.js`) shows the
name, "Statuses from Name (@user) on Status Rodeo." and the user's avatar icon. A status
(`/statuses/<id>`, `src/status-page.js`) shows the author, the start of the text and the author's avatar
icon. The two functions remove the shell's default tags (`PREVIEW_TAGS_SELECTOR`) before adding their
own, so a crawler never sees two titles. In-app navigation does not change the head (the tags are for
crawlers, which fetch the page fresh). Check it on a preview after changing it: `curl -s
https://<preview>/statuses/<id> | grep og:` should list the status tags once and a missing or private id
the default set; `/users/chris` the profile tags and `/users/nobody` the default set; `/` the default
set. Link-preview bots cache results, so use each service's own debugger or a fresh address when testing.

Links in statuses: a web address in a status is a link (`a.status-link`, the normal link
colour, underlined) on every page that shows statuses. The shown text is the address exactly
as typed, so the text and the destination always agree. A link to another site opens in a
new tab with `rel="noopener noreferrer nofollow ugc"` and an `aria-label` ending "(opens
in a new tab)" (the visible text, and so copy and paste, is unchanged); a link to this site
has no target and is followed inside the app. A status with no address is still one plain
text node. Bare domains ("example.com", "www.…") are deliberately not linked: only
addresses that start with `http://` or `https://`. RSS descriptions stay plain text.

Mentions: `@username` in a status links to `/users/<username>` on every page that shows
statuses (`a.status-link.status-mention`, normal link colour and underline, followed inside the app).
It is display only: the stored text, the RSS feeds and link previews are unchanged, and nobody is
notified (no table, no SQL). `linkify()` finds them: `@` plus 1 to 50 of `A-Z a-z 0-9 _ . -`, not
directly after a letter, digit, `_ . - / @` (so emails, `@@x` and `https://site/@x` are not mentions),
and trailing `.` and `-` are left out ("Hi @chris." mentions chris). The case must match exactly, like
profile addresses. A mention is only a link if the profile exists: after a page of statuses is drawn,
`resolveMentions()` makes one `profiles` query (`username in (...)`, at most 50 names, retried) for the
names not checked yet; until it answers (and if it fails) the mention is plain text in a
`span[data-mention]`, and a name that doesn't exist stays plain text. Answers are kept in
`knownUsernames` for as long as the page is open. Mentioning yourself links too. Not built, by choice:
autocomplete while typing, and notifications or a "mentions of me" page (would need a table and RLS).

Composer: the text field and its actions are one rounded box (`.composer-fields`,
which draws the focus ring via `:focus-within`): the text on top, then a row with
the live `0/280` counter at the left and the Post button at the right, and any
error message under it. The counter is in the existing muted colour. The empty box's placeholder is a random
line from `src/placeholders.js` each time the home page is drawn (the plain "What’s your status?"
is not one of them), never the same line twice in a row. It is only a hint: the field's label stays
"What's your status?". On phones the empty box is shorter (2.9rem) and grows with the text up to
8rem (about five lines, then it scrolls) with `field-sizing: content`; browsers without it (before Chrome 123,
Safari 26.2, Firefox 152) keep the shorter box, which scrolls and can still be dragged taller. The text stays at
16px or more on phones, because iOS zooms the page when a smaller field is focused. Every line is capped at 28 characters so it fits on one line on a 320px
phone (checked in the browser at 320, 360 and 390px); keep new lines Western, mainstream (well-known cowboy phrases), short and with the curly apostrophe. Under 640px the composer's avatar is hidden (it is
already in the sidebar bar just above) and the box takes the full width. It turns rust and bold with 20 or fewer characters left, and a
visually hidden live region announces the remaining count there. Ctrl+Enter (Cmd+Enter on a Mac)
in the text box posts, the same as the Post button (plain Enter is a new line; it is ignored while an input
method is composing and for a held-down key; the box has `aria-keyshortcuts`; no visible hint). Typing and
pasting stop at 280 Unicode code points (nothing already typed is removed), empty
or over-limit statuses are not sent, and a failed post keeps the text and shows a
short message under the buttons. While a post is in flight (until the feed has
reloaded) the Post button reads "Posting…", keeps its width, is marked
`aria-busy` and ignores further clicks; the text box is read-only until the
insert finishes.

Your own statuses (the "…" menu): a status whose `@username` is the signed-in user's has a "…" button
in the top right corner of its row (`.status-menu`, on the feed, profile and status pages). Nobody
else sees it, and a signed-out visitor sees none (the database allows the same and nothing more: only
your own rows can be updated or deleted). `syncStatusMenus()` adds and removes the menus; it runs after
rows are drawn and whenever the signed-in state or the profile loads, so signing in or out changes the
rows already on the page, and the owner is decided by comparing the row's `data-username` with the
signed-in profile (no author ids are sent to the page). The button is a real `<button>` with
`aria-haspopup="menu"`, `aria-expanded` and `aria-controls`; the list is `role="menu"` with
`role="menuitem"` buttons. Opening it (click, tap, Enter, Space or ArrowDown/ArrowUp) focuses the first
item; Escape closes it and returns focus to the button; Tab, a click or tap outside, or opening another
menu closes it; ArrowUp/Down/Home/End move between items. (Focus leaving the menu closes it only when no pointer was pressed in the last 800 ms: iOS Safari focuses the page container, `#page`, between a tap and its click, and closing the menu on that made taps on Edit and Delete land on the feed. Found 2026-10-12 with an on-screen event log on a preview; Chromium does not do this, so the unit and browser tests could not catch it. A pointer outside still closes the menu through `pointerdown`.) One set of document-level listeners serves
every menu. The visible button is about 34px with an invisible `::after` layer that makes the tappable
area 44px or more (like the other small buttons), the items are at least 44px tall, and the header
makes room (`.status.has-menu .status-meta` padding) so a long name never runs under the button. The
list is absolutely positioned and `.feed-panel` no longer has `overflow: hidden`, so a menu on the last
row opens past the panel's bottom edge instead of being cut off (the heading band rounds its own top
corners instead). Hover styles are inside `@media (hover: hover)`. Delete asks first: an inline question
under the status text ("Delete this status? This can't be undone." with Delete and Cancel,
`.status-confirm`, role `group`), with the focus on Cancel so a stray Enter deletes nothing; Escape or
Cancel closes it and returns focus to the "…" button. While deleting, the button reads "Deleting…"
(`aria-busy`) and both buttons are disabled. On success the row is removed, "Status deleted." is
announced (`#status-announcer`, a visually hidden live region next to `#route-announcer`) and focus
goes to the next row's name (or the previous one's, or the page). A feed that loses its last row
reloads (the next page of statuses, or the empty message); a profile's "N statuses" count goes down by
one (both through a `statusdeleted` event on the feed); on a status's own page deleting it goes home.
A failure keeps the status and the question and shows "Couldn't delete this status. Try again." in a
tinted note under the buttons; a gone login signs you out locally and the sign-in form says "Your
session expired. Sign in again to delete your status." Hat tips on a deleted status go with it
(database cascade).

Editing (the first item in the menu, with the `pencil` icon; Delete is second): Edit replaces the
status text with an inline editor (`startEdit()`, `form.status-edit`) in the same rounded box as the
composer: a textarea holding the saved text with the caret at the end and the focus in it, the live
`n/280` counter (rust and bold at 20 or fewer left, as in the composer), Save and Cancel (44px tall;
they and the counter wrap under each other when the box is narrow on a phone). Typing and pasting stop
at 280 Unicode code points through `limitTyping()`, shared with the composer. Save is disabled until the
trimmed text is valid and different from the saved text. Ctrl+Enter (Cmd+Enter) saves, plain Enter is a
new line, and Escape or Cancel closes the editor without asking (an unsaved edit is only a few
characters) and returns focus to the "…" button. While the editor is open the "…" menu is hidden and a
delete question is closed. While saving, the button reads "Saving…" (same width, `aria-busy`), the
text is read-only and Cancel is disabled. On success the row shows the saved text (links and mentions
rebuilt, mentions resolved again), an "edited" label appears, the editor closes, focus returns to the
"…" button and "Status saved." is announced. A failure keeps the editor and the text with "Couldn't
save your edit. Try again."; a status deleted elsewhere says "This status no longer exists."; a gone
login signs you out locally and the sign-in form says "Your session expired. Sign in again to save
your edit." (the unsaved text is lost, because the editor only exists for the signed-in owner). There
is no time limit on editing. The "edited" label (`span.status-edited`, shown after the time as "· edited",
the exact edit time in its tooltip) comes from `statuses.edited_at`, which a database trigger sets only
when the content really changes; every query that draws a status row selects `edited_at`. The RSS feeds,
link previews and the API are unchanged by edits (a feed item shows the current text).

Hat tips (Status Rodeo's "like"): every status has a "Tip" pill under its
text (`.status-actions`: the `.hat-tip` button, a `.hat-number` and a `.hat-note`
message line; `.hat-note` is a `div`, not a `p`, because `.status p` is the status
text). Signed-in visitors can tip any public status, their own included, once each;
tapping again takes it back. Everyone sees the count as a bare number beside the button
(`.hat-number`, `aria-hidden`; hidden at zero, and the button stays). The words "hat tip"
are not repeated because the hat icon says them. The full wording lives in a visually hidden
`.hat-count` ("1 hat tip", "2 hat tips"), which the button's `aria-describedby` points at.
Tipped is shown by a filled, tilted hat, the "Tipped" label, `aria-pressed` and the
rust `--accent`, not by colour alone. The button is a real `<button>`; its visible text is
"Tip" / "Tipped", and its accessible name (`aria-label`) is "Tip your hat" / "Hat tipped", so
the visible word is part of the name. Its tooltip (`title`) is "Tip your hat" / "Take back your
hat tip". The sign-in and failure messages keep the full "tip your hat" wording. It stays
on the row rather than moving into a per-status menu. The button has the usual focus ring,
about 44px of tappable area through an invisible `::after` layer, a press effect, hover
styles inside `@media (hover: hover)`, and no hat-tilt transition under
`prefers-reduced-motion`. Don't add the iPhone swallowed-tap workaround used for "Show
older" to this button: it could toggle a tip by accident when someone taps to stop a
scroll. Data: each page of statuses makes one `hat_tip_info` request (the pager calls
`loadHatTips()` after drawing its rows); until it answers, the row keeps its space
(`data-state="loading"`, invisible, same height as the finished button), and if it fails
after the usual retries the rows have no button (`data-state="unavailable"`) while the
feed works as before. A tap changes the count at once and puts it back, with "Couldn't
save your hat tip. Try again.", if the save fails; further taps on a status are ignored
while its save is in flight. Signed out, tapping shows "Sign in to tip your hat." and
sends nothing. If a save finds the login gone, the visitor is signed out locally
(`expireSession()`) and told "Your session expired. Sign in again to tip your hat."
Signing in or out updates the buttons already on the page (`syncHatTips()`). Counts are
read when a page of statuses loads and are not refreshed live. The same status shows the
same state on the home and profile feeds because both read `hatTips`.

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

Loading states: the masthead reserves its space (about 5.3:1, 3.1:1 on phones) with dark wood colour, so the cream title is readable before the picture arrives. Avatars
(`data-state` loading, loaded or fallback) and the feed (three placeholder rows,
`aria-busy`) show pulsing placeholders until their data arrives, and the
sign-in form stays hidden until the session is known. An avatar that fails or
takes over 8 seconds stays a plain empty tile (`data-state="fallback"`, no letter). A failed
avatar or masthead load is retried twice in the background (after 1.5 s and 4 s, with a
`?retry=n` query so a cached failure is not reused), and a retry that succeeds shows the
image. Each failed attempt is logged with `console.warn` (URL and attempt number) to help
trace why images fail.

Target:
- An illustrated masthead above the app. It is its own image asset, never a
  screenshot of the app or a page background. The picture is a blank sign and the
  words "Status Rodeo" are real text over it (the visible `h1`), so the picture has
  empty alt text. No tagline or motto.
- Below it, a calm interface: cream/parchment background, dark brown text, rust
  accents, warm rust-brown links, subtle tan borders, restrained shadows, comfortable
  spacing. Western display type only for the title and a few headings; normal
  readable type for statuses and controls. Self-host any font.
- Sidebar: account identity and navigation. Main column: composer and feed. Feed
  rows are simple (avatar, name, @username, time, text), with no decoration on individual
  statuses. The row header is `Name @username · 3 days ago` (built in `createStatusRow()`): the
  name links to the profile; the `@username` (`.status-handle`) is plain muted text, not a second
  link; "@username · time" is one unit (`.status-sub`) that sits beside the name when there is room
  and otherwise drops to a second line as a whole, so the dot never starts a line (on phones at
  360px and under these are 0.88rem so more rows fit on one line). A name or @username too long for
  the row is cut with an ellipsis (the full name is on the profile page); the time never wraps. The
  time is a link to the status's own page but looks exactly like the plain
  muted time (same colour, size and position; the "· " dot is drawn on the link so only
  the time is underlined, and only on hover, inside the hover media query).
- Avatars are the illustrated icon set (`/avatars/icons/<name>.webp`), picked by the user and
  stored in `profiles.avatar`. Changing an avatar or the interface must never require changing
  the masthead.
- Times are relative, as in the mockup (`src/relative-time.js`, with unit tests):
  "just now", "5 minutes ago", "2 hours ago", "1 day ago" up to 6 days, then a
  plain date ("Oct 7", or "Oct 7, 2025" from another year). The exact time is in
  the `<time>` element's tooltip (`title`) and `datetime`. Visible times refresh
  every minute while a page stays open.
- The mobile layout is designed deliberately, not by scaling the desktop layout
  down. It was reviewed on 2026-10-11 at 320, 360, 390 and 430px on every page (home signed in and
  out, profile own and other, Edit profile signed in and out, a status page, not-found), with stress
  data (a 136-character unbroken word, a long URL, a 43-character display name and a 34-character
  username): no sideways scrolling anywhere, and long text wraps or is cut with an ellipsis instead
  of overlapping. Tap targets on phones (changed 2026-10-12, no visible change): the sidebar's Home /
  My profile / Sign out have a transparent `::after` layer (`inset: -0.45rem -0.2rem`) and are about
  46px tall to tap; the sort dropdown, the "Back to my profile" link and the "Try again" buttons use
  padding with an equal negative margin (layout unchanged, the padding is tappable) for 44px or more;
  the name and the time in a feed row do the same but are only about 36 to 40px, because the status
  text starts right under the header and the previous row's hat tip sits above (the padding is 0.9rem
  above and 0.3rem below, and anything later in the page, such as the status text and its links, is
  painted over it, so a link inside a status is never covered). Don't use a positioned `::after` on the
  name or time: it would paint above the status text. The hat tip, the "…" button and "Show older" have
  an invisible 44px area. Re-check after changing a row's header: elementFromPoint at the edges of the
  hat tip, the "…" button and a link inside a status must still hit them. To re-check after a layout change, open each page at those
  four widths and compare `document.documentElement.scrollWidth` with `clientWidth` (they must be
  equal), with a long unbroken word and a long display name in the data.

A mockup is a visual reference, not a feature list. These controls appear in it
but are not built, and are not to be added without asking: Settings, a "Post a
status" nav link, a users list. (The per-status "…" menu was asked for and built on 2026-10-12, for
the owner's own statuses only; see "Your own statuses".)
