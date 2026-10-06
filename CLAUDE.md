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

There are no tests or linters. Before finishing a change, run `npm run build` and
check the affected pages in the browser.

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
  otherwise not-found) and all views.
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
  text not null, `visibility` text not null default `'public'`, `created_at`
  timestamptz default now().
- `profiles`: `user_id` uuid primary key, `created_at` timestamptz default now(),
  `username` text not null unique, `display_name` text not null.

Foreign keys (all NO ACTION): `statuses.user_id` references both `auth.users.id`
and `profiles.user_id`; `profiles.user_id` references `auth.users.id`. Keep the
`statuses` to `profiles` key. The feed query embeds
`profiles(display_name, username)`, and without that relationship PostgREST
returns PGRST200.

Other facts:
- The app only uses `visibility = 'public'`. There is no CHECK constraint on
  `visibility`.
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
- Anything that looks interactive must actually work. Decoration must not create
  fake features.
- `[hidden] { display: none !important; }` in `src/style.css` is intentional.
  Without it, rules like `.composer { display: grid; }` override the `hidden`
  attribute in Firefox. Don't remove it without checking that hidden UI stays
  hidden.

## Design direction

Oregon Trail meets early Twitter: a Western look on top of a simple social
layout. Right now the Western feel comes from the palette and the copy; there is
no pixel-art styling in the CSS yet.

Current state: two-column desktop layout (account/navigation sidebar plus main
status column). Palette is warm cream, dark brown, rust/burnt orange, old-web
blue links, tan borders.

Planned:
- A pixel-art Western masthead. Keep "Status Rodeo" as real HTML text, not part
  of the artwork.
- Selectable pixel avatars, stored as real profile data.
