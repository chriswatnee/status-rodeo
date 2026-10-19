# Status Rodeo

**Live: https://status.rodeo**

Status Rodeo is a small status-sharing site with a Western look: post a short
status (up to 280 characters), read the latest from everyone, and follow along
by RSS. It started as a tiny service behind [chriswatnee.com](https://chriswatnee.com)
and is now a small multi-user site. Accounts are created by hand, so there is
no public sign-up.

What it does:

- Short statuses, newest first, with an "Oldest first" option.
- Profile pages, a page for each status, and `@mentions` and web links in statuses.
- Edit and delete your own statuses, and "hat tips" (Status Rodeo's likes).
- A pick-your-own avatar from 12 illustrated Western icons.
- RSS feeds for everyone and for each user, and a small JSON endpoint for each
  user's latest status.
- Link previews for profile and status addresses.

It is vanilla HTML, CSS and JavaScript built with [Vite](https://vite.dev), with
no framework. Data and sign-in are [Supabase](https://supabase.com) (Postgres and
Auth), and it is hosted on Cloudflare Pages, with the RSS, JSON and link-preview
endpoints running as Pages Functions.

## Running it locally

You need Node 22 or newer (the version in `.nvmrc`) and npm.

```sh
git clone https://github.com/chriswatnee/status-rodeo.git
cd status-rodeo
npm install
```

Create a file called `.env.local` in the project root with the two Supabase
values for your project. It is gitignored. These are bundled into the browser,
so use only the project URL and the publishable (anon) key, never a service-role
key:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Then:

```sh
npm run dev
```

and open http://localhost:5173.

Other scripts:

- `npm test` runs the unit tests (Node's built-in test runner, no dependencies).
- `npm run test:browser` runs the browser tests (layout, loading, tap targets) in headless Chromium against a fake database. They need Playwright once: `npm install --no-save playwright && npx playwright install chromium`.
- `npm run build` builds the site into `dist/`.
- `npm run preview` serves the built `dist/` locally.

`npm run dev` does not run the Pages Functions, so `/feed.xml`, the JSON
endpoint and link previews return the app page instead. To try them, run
`npm run build` and then `npx wrangler pages dev dist`, with a `.dev.vars` file
in the project root that defines the same two variables (also gitignored).

## How it's organized

```
index.html          the app shell: meta tags, font preloads, loading indicator
src/main.js         routing and every view
src/*.js            small modules with unit tests (posting, editing, links, feeds, ...)
src/icons/          the hand-drawn icon set
src/style.css       all the styles
public/             fonts, the masthead pictures, avatar icons, favicons
functions/          Cloudflare Pages Functions (RSS feeds, JSON, link previews)
supabase/           SQL for the database, and scripts that check it
tests/              unit tests
CLAUDE.md           detailed conventions and design notes
```

## The database

The tables, policies and functions live in Supabase, and `supabase/schema.sql`
is a snapshot of them. It is not a migration and nothing applies it
automatically: changes are applied by hand in the Supabase SQL editor, each with
a script that verifies it. `supabase/live-state-check.sql` is a read-only check
that compares the live database with the documentation. See "Data and security"
in `CLAUDE.md` for the details.

## Hosting

The site runs on Cloudflare Pages, connected to this repository. Every push to
`main` deploys to production, and every pull request gets a preview.

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | leave empty |
| Node version | read from `.nvmrc` |
| Environment variables | `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, for both Production and Preview |

The environment variables are set in the Cloudflare dashboard. There is
deliberately no `wrangler.jsonc`: for a Pages project, a Wrangler config file
becomes the source of truth and the dashboard turns read-only for the settings
it covers, including these variables.

## License

[MIT](LICENSE) © 2026 Chris Watnee
