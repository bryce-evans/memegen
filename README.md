# memegen

A self-hosted meme generator with a public gallery. Pick a template (or bring your own image, GIF, or video), place and animate text, then save, post, and vote.

## Features

- **Templates**: the checked-in [library](library/README.md) combines canonical checkout and online formats in one [manifest](library/MANIFEST.json), with 1–5 content-risk scores, search tags, and default captions. Work settings include ratings 1–3 and exclude 4–5. Search by tag, name, or what's in the picture ("dog" finds doge), filter by kind, see what's hot, and check each template's usage chart. Uploading an image that's already a template lists existing matches before you save.
  Template cards open directly when selected, with usage count and flame beside the title and a rounded hover highlight.
- **Editor**: text boxes that wrap and shrink to fit (drag their corners to resize, the handle above to rotate; ⌘⌫ in a box's text removes it), custom fonts, image layers (upload or paste a screenshot), and a shared sticker library.
- **Animation**: for GIFs and videos, a frame-by-frame timeline with per-layer visibility windows, keyframes, and a live loop preview. Exports are GIF or MP4, and MP4s keep their audio.
- **Caption memes**: a top-section toggle adds a white band with its own text above the media.
- **Multi-panel templates**: reusable image packs for customizing panel count, repetition, order, and layout—not simply images containing multiple frames. Use three Galaxy Brains or eight, or four Drake rejections followed by one approval instead of the default one of each. Packs include Panik/Kalm/Panik, Vince McMahon, Mr. Incredible, Galaxy Brain, Drake, and Tuxedo Pooh; their images are cropped from reviewed online source sheets during seeding. Fixed-format sequences such as Anakin/Padmé remain ordinary image templates with editable captions.
  To build a pack from one sheet, choose **Create → Build from images → Split sheet**. Upload a still image, draw the first rectangle (or enter its pixel bounds), choose horizontal/right or vertical/down propagation, and set the gap in source pixels. Numbered previews show every complete crop; partial crops at the image edge are excluded. **Add crops to pack** uploads separate PNG images that can be reused, omitted, or reordered. Cancel uploads nothing; the original sheet stays local.
- **Quick Creator**: start with a random template or search for one, then describe the meme. Your Agent Provider edits text/font/top-section content for media templates and captions for multi-panel templates. Panels use the template's saved default layout, order, grid, mirroring, and caption size without flattening the image pack. The optional Image Generator edits single still images only. Publish posts the result; Full editor (or clicking the preview) continues the complete draft, including your typed title, even before an AI update. Configure your own provider keys/models under your profile's API Keys tab.
- **Gallery**: Popular (day, week, month, year, or all time) and Recent feeds, voting, threaded comments, favorites, search (posts, templates, or users), and tag pages. Feed cards open their meme when clicked anywhere and show its info over it on hover or, set under your profile's Settings tab, its title and votes below it (Google-style).
- **Unlisted sharing**: unlisted memes and templates stay out of public discovery but open for anyone with their direct link, including drafts. Media bytes remain directly accessible. Unlisted is not confidential storage; editing and deletion require the owner or an admin.
- **Keyboard**: Backspace, Delete, or Escape goes back a page (outside text fields). Leaving the editor this way with an unpublished meme asks first.
- **Profiles and leaderboard**: a Profile tab with h-score, high score, and tiered stats (bronze to diamond: tile outlines and stars); the user's memes and templates; and, on your own profile, API Keys (Agent Provider and Image Generator) plus private Favorites and Recent activity tabs. Leaderboard tier stars are enlarged and vertically centered beside their numbers.
- **Skins**: Painted (default), Basic (the original dark, yellow-accent look), and Google from `packages/ui`. Dev tools can switch skins; production is locked to Painted. Only Painted uses colorful gradient action buttons and offers per-user dark mode. Google uses flat Material-inspired controls, neutral gray outline/filled vote icons, and below-image card details by default; an explicit card-layout preference still wins.
- **Header and columns**: the painted skin uses a 56px header with about 8px of clearance above and below search. Its 120px brand slot is aligned to the left column; reduced wordmark padding allows a 1.75× logo to fill the bar without clipping. Main content is centered in the viewport; navigation occupies up to 220px in the left rail and editor controls occupy the right rail, stacking on narrow screens.
  On desktop, the visible wordmark, Create's plus icon, and navigation icons share the same left inset.
  Desktop galleries (Popular, Recent, search results, and tags), profiles, and the Create start page extend through the unused right rail; individual posts stay compact and centered. Quick Creator allows a taller, aspect-preserving preview, and upload artwork grows proportionally with its cards. The Painted header's brush-stroke background is 20% larger without changing its lettering or the sign-in logo.
  The desktop editor reserves a wider controls rail so Text, Image, Sticker, and Top section fit on one line; controls still stack below the workspace on narrow screens.
- **Snapshots**: back up or restore the whole site (database and media) as one zip.
- **Meme titles**: enter a title before saving or publishing in the editor or Quick Creator. Titles start empty; template names are never used as defaults.
- **Post view**: author, date, and compact tags sit above the title; smaller Share/Download controls align beside it. A labeled star **Favorite** toggle sits to the right of votes. Only favorited posts show a filled star beside the title. The media, comments, and private owner controls retain their single-column layout; action rows wrap on narrow screens.
- **Admin moderation**: separate **Admin tools** panels on posts and templates support editing content/tags, **Delist**, and deletion; admins can also delete others' comments. Before removing a template, review and remove its related posts (including drafts and variation uses), individually or with explicit bulk confirmation. Media assets are retained.
- **Feedback and reports**: the bottom-right sparkle opens Bug, Suggestion, or Hug feedback with optional screenshots. **Flag post** and **Flag template** open a modal over the current page for sex, drugs, violence, gore, or other concerns, without screenshots. Closing keeps the draft; delivery failures allow retry. Both use the configured email, Slack, or webhook connector.
- **Admin**: admins get an Admin tab after API Keys on their own full-width profile. It shows 7-, 30-, or 90-day UTC plots of unique sign-ins, posts, user-added templates, new users, and comments, with expandable accessible daily values. Site-wide totals include stored assets formatted as KB/MB/GB. There is no separate sidebar entry or global entity-deletion page; moderation stays with each entity's controls.
- **Deletion audit**: administrator deletions are recorded atomically in immutable history, readable through the admin-only `/api/admin/audit` endpoint. Records survive actor/target removal; database owners remain trusted because they can alter protections. Referenced assets/templates and accounts that still own content require explicit cleanup first; the built-in account, your own account, and the last admin are protected.

Post pages use a compact heading with 8pt author/date/tags, muted gray tag labels, and a title 2pt larger than the skin's XL font, in a content column capped at 940px that shrinks to fit narrow screens. Images and videos fill the available width up to 940px and scale proportionally within a 680px height limit, without cropping.

All rendering happens in the browser. The servers only store, validate, and index. How it works and why: [ARCH.md](ARCH.md).

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- Node.js ≥ 24.2
- Git (for the pinned library prerequisite download)
- PostgreSQL 14+ with its client tools (`psql`, `createdb`, `pg_dump`, `pg_restore`, at least as new as the server)
- To export video memes: a Chromium-based browser, Safari 17+, or Firefox 130+ (WebCodecs). Images and GIFs work in any browser.
- ffmpeg (only for the e2e tests)

## Quick start

Start Postgres if it isn't running:

```sh
brew services start postgresql@16
# or: docker run -d --name memegen-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
#     (then point the *_DATABASE_URL values in config/dev.env at postgres://postgres@localhost:5432/...)
```

Then set up, seed, and run:

```sh
./run.sh config/dev.env setup             # install, create databases, migrate
./run.sh config/dev.env library download  # pinned templates + fonts; preserves an existing checkout
bunx playwright install chromium          # the seed renders sample memes in headless Chromium
./run.sh config/dev.env seed              # templates, then sample users/memes/votes/comments
./run.sh config/dev.env dev               # storage :4001, API :4000, search :4002, web :5173
```

Open http://localhost:5173 and sign in with any username (there are no passwords in dev). Some pages to try:

| Page | URL |
|---|---|
| Popular / Recent | http://localhost:5173/, http://localhost:5173/recent |
| Create (template browser + editor) | http://localhost:5173/create |
| Leaderboard | http://localhost:5173/leaderboard |
| A profile | http://localhost:5173/u/dana |
| A tag page | http://localhost:5173/t/oldschool |

In dev, a **Dev tools** panel on the sign-in page switches skins and previews the sign-in intros (kept in your browser).

### Admin access

For local development, `./run.sh config/dev.env seed` with `SEED_SAMPLE=true` creates **bae** as an admin. Re-running it also grants admin to an existing case-insensitive `bae` account without recreating sample content. Sign in as `bae`, or reload/refocus if already signed in. This sample seed refuses to run outside `MODE=dev`.

For other accounts or production, apply migrations, sign in once to create the account, then have a trusted database operator grant its role using the target database's connection URL:

```sh
psql "$DATABASE_URL" -c "UPDATE users SET is_admin = true WHERE lower(username) = lower('YOUR_USERNAME');"
```

Sign-in never grants admin privileges; only the explicit development sample seed provisions `bae`. Reload or refocus the app to refresh the panel. To revoke access, run the same update with `is_admin = false`; server authorization checks apply immediately. Re-running the sample seed re-grants `bae` its local admin role.

Analytics excludes `@memegen` from user counts and excludes its built-in templates (including variations) from template counts. Posted memes include public and unlisted posts; drafts are separate. Content metrics reflect retained records, so deleting content reduces the counts; storage includes retained assets even after their posts are removed.

Unique sign-ins count a user once per UTC day after a successful login, not on session restoration or page views. Migration 021 starts tracking; earlier dates are gaps in the plots and marked “Not tracked” in daily values, rather than invented history. The first tracked day and current day may be partial. Login date/user-ID records survive account deletion to preserve historical counts; Admin exposes aggregates, not individual login records.

**Security:** `AUTH_MODE=dev` deliberately permits impersonation and is only for trusted local use. Deployments must use `AUTH_MODE=oidc`; production rejects dev authentication. Admin roles remain local database permissions, not claims supplied by the identity provider.

## Commands

Everything runs through `./run.sh <config> <command>`:

| Command | What it does |
|---|---|
| `setup` | validate deployment settings, `bun install`, create missing databases, migrate |
| `migrate` | apply pending migrations |
| `seed` | import templates and the configured datasets (see [Seeding](#seeding)) |
| `reset` | wipe the database and local storage, then `seed` *(dev only)* |
| `dev` | migrate, then run storage + API + Vite with reload *(dev only)* |
| `build` | production build of the web app |
| `start` | build, migrate, then serve everything on `WEB_PORT` |
| `snapshot save [out.zip] [--label name]` | write the database and every asset into one zip |
| `snapshot load <in.zip> [--replace]` | load a snapshot into a clean system; `--replace` wipes first *(dev only)* |
| `typecheck` | check runtime import boundaries and TypeScript |
| `test` / `e2e` | unit/integration tests / Playwright browser tests *(dev only)* |
| `config` | print configured keys, secrets and database URL credentials masked |
| `deployment [--options]` | validate local deployment settings, or show connector choices and setup links; no connector network calls or secret output |

## Configs

Configs are plain `KEY=value` files:

- `config/dev.env` (committed): local Postgres, local file storage, sample data.
- `config/prod.env` (gitignored, copied from `config/prod.env.example`): real data. `MODE=prod` refuses dev-only commands and sample data, and requires OIDC, HTTPS, a strong `INTERNAL_TOKEN`, and a real `DATABASE_URL`.
- `config/starter.env` (committed): builds the starter-content snapshot in its own database.

Main keys (see `config/dev.env` and `config/prod.env.example` for all of them):

- `AUTH_MODE`: `oidc` for deployment; `dev` for trusted local username login only. `dev` is rejected outside `MODE=dev`. The sign-in screen reads this choice from the server, not the web build.
- `PUBLIC_ORIGIN`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`: required for OIDC. Use a confidential web client with discovery and authorization code + PKCE; keep its secret server-side. `PUBLIC_ORIGIN` is the browser-facing HTTPS origin, without a path. Loopback HTTP is allowed only in development.
- `AUTH_SESSION_TTL_SECONDS`: absolute session lifetime, default 604800 (7 days), range 1–2592000. Sessions use HttpOnly cookies and hashed database tokens; logout revokes the current session immediately.
- `WEB_PORT`, `API_PORT`, `STORAGE_PORT`: the web app proxies `/api` and `/storage` to these. Set `API_URL`/`STORAGE_URL` only when the services run on other hosts.
- `STORAGE_PROVIDER`: `local` (files in `.data/storage`) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, …).
- `MAX_*`: upload caps. Defaults are 20 MB per file. Longest edge: images 4096 px, GIFs 1024 px, videos 1920 px. Frames: GIFs 500, videos 1800.
- `INTERNAL_TOKEN`: guards the API's `/internal/*` routes.
- `FEEDBACK_PROVIDER`: `email`, `slack`, or `webhook`; required in production. `disabled` is allowed only in development. See [Feedback connector setup](#feedback-connector-setup).
- `INTRO`: the sign-in page's intro, baked into the web build. `basic` (default) shows the card alone; `party` explodes memes, confetti, and streamers out from behind it; `nyan` flies nyan cat in a straight line from the bottom right, behind the card, and out of its top-left corner, leaving its rainbow behind.
- `OPENAI_IMAGE_MODEL` (default `gpt-image-2`), `GEMINI_IMAGE_MODEL` (default `gemini-nano-banana-2.1`): default models for the Image Generator. `OPENAI_TEXT_MODEL` (default `gpt-5-mini`), `GEMINI_TEXT_MODEL` (default `gemini-2.5-flash`), `ANTHROPIC_TEXT_MODEL` (default `claude-haiku-5-5`): default models for the Agent Provider. Users may name their own models instead. Users bring their own API keys, so the server needs none. `OPENAI_BASE_URL`/`GEMINI_BASE_URL`/`ANTHROPIC_BASE_URL` point at a proxy or gateway.
- `SEARCH_ENABLED`: `true` runs the template search sidecar on `SEARCH_PORT` (default 4002): CLIP image embeddings in a FAISS index, so template search also matches what's in the picture and new uploads are checked for duplicates. `false` searches tags and names only, and only byte-identical duplicates are caught. The first start downloads the model (about 600 MB) into `SEARCH_DATA_DIR` (default `.data/search`), which also caches the embeddings. `SEARCH_MODEL` picks another transformers.js CLIP export; `SEARCH_URL` points the API at a sidecar on another host.

### Deployment setup

**Recommended:** OIDC authentication with server-side sessions. Use Google or Auth0 for hosted identity, or Keycloak/Authentik when self-hosting. These use the same connector; no provider-specific app code is needed. Authentication requires no local password database or password-recovery email service.

The production template documents the choices and links to provider consoles/setup guides:

```sh
cp config/prod.env.example config/prod.env
chmod 600 config/prod.env
./run.sh config/prod.env deployment --options
# Edit config/prod.env with the connectors below.
./run.sh config/prod.env deployment
./run.sh config/prod.env setup
./run.sh config/prod.env start
```

| Connector | Required setup |
|---|---|
| PostgreSQL | Dedicated database, `DATABASE_URL`, and backups. |
| Identity | `AUTH_MODE=oidc`; confidential OIDC web client, issuer URL, client ID, and secret. Register **exactly** `PUBLIC_ORIGIN/api/auth/callback` as its redirect URI and enable `openid`. Configure allowed users/groups and MFA at the provider. |
| Media | `STORAGE_PROVIDER=s3` with bucket and AWS role/default credentials or both explicit S3 credentials; optional endpoint for R2/MinIO. Alternatively, `local` with `LOCAL_STORAGE_DIR` on a durable, backed-up volume. |
| Public HTTPS | Set `PUBLIC_ORIGIN`; terminate TLS at a reverse proxy to `WEB_PORT`. Preserve Cookie, Set-Cookie, and Origin headers. Keep API, storage, and search ports private. |
| Internal services | Generate `INTERNAL_TOKEN` with `openssl rand -hex 32`; production requires at least 32 characters. |
| Feedback/reports | Choose `FEEDBACK_PROVIDER=email`, `slack`, or `webhook`; configure and verify a destination before opening access. |
| Semantic search — optional | `SEARCH_ENABLED=true` runs the local CLIP/FAISS sidecar; persist its model/cache directory. The template defaults to false. Name/tag search still works. |
| AI — optional | Users supply OpenAI/Gemini/Anthropic keys in their profiles; no deployment-wide AI secret is required. |

`deployment` is a **local configuration preflight**, not a connection or credential test. `setup` and `start` also enforce it. After configuring real services, verify SSO login/logout, an upload, feedback receipt, and backup/restore before opening access. OIDC discovery failures stop the services rather than enabling dev login. Logout ends the local app session, not the provider's SSO session.

### Feedback connector setup

Setup agents must confirm the operator's destination, configure it, run the deployment preflight, and—with approval—send an identified setup message and verify receipt. Never put real credentials in committed files or chat.

| Provider | Settings |
|---|---|
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `FEEDBACK_EMAIL_FROM`, `FEEDBACK_EMAIL_TO`. One sender/recipient address each. Set both `SMTP_USER` and `SMTP_PASSWORD` if authentication is required. Production uses implicit TLS (`465`, `true`) or required STARTTLS (`587`, `false`). Screenshots are MIME attachments. |
| Slack | `FEEDBACK_SLACK_BOT_TOKEN`, `FEEDBACK_SLACK_CHANNEL`. Create/install a bot at [Slack apps](https://api.slack.com/apps), grant `chat:write` and `files:write`, and invite it to the channel. Text is posted with private screenshot uploads in its thread; incoming webhooks alone cannot upload screenshots. |
| Webhook | `FEEDBACK_WEBHOOK_URL` and optional `FEEDBACK_WEBHOOK_TOKEN` (sent as `Authorization: Bearer …`). HTTPS is required; loopback HTTP is permitted only in development. |

The webhook receives JSON: `kind`, `message`, `path`, `user: {id, username}`, `screenshots: [{name, contentType, base64}]`; reports also contain `target: {kind, id}` and `reason`. A 2xx response acknowledges delivery; a JSON response explicitly reporting `ok: false`, `success: false`, `delivered: false`, or an error is treated as failure.

Submission requires sign-in and a matching browser Origin. The button remains visible on sign-in but does not capture that screen. Automatic screenshots omit form fields, API key settings, and feedback controls; other visible personal information may remain, so review before sending. Up to two screenshots, 2 MiB each, and 4,000 text characters are accepted. Screenshots are sent directly to the connector, never added to public media storage. Reports attach no screenshot automatically. Capture failures permit manual upload or text-only feedback.

Delivery failures retain the draft and are not reported as success. There is no background retry queue; a failed multipart Slack delivery may already have posted text before its image upload failed. Destination retention/access controls are the operator's responsibility. In development, set `PUBLIC_ORIGIN` when using a hostname other than the default `http://localhost:WEB_PORT`.

### Existing accounts and OIDC

Provider **issuer + subject** identifies an account. New identities get a unique `member_…` username and no admin permissions. Existing usernames/emails are never auto-linked, because development accounts did not prove ownership.

To preserve an existing account, a trusted operator must verify the person's issuer/subject through the identity provider, then create the mapping **before their first OIDC login**, using the target database:

```sql
INSERT INTO auth_identities (issuer, subject, user_id)
SELECT 'EXACT_VERIFIED_ISSUER', 'VERIFIED_SUBJECT', id
FROM users WHERE lower(username) = lower('EXISTING_USERNAME')
RETURNING user_id;
```

Confirm exactly one row was returned. A mapping conflict requires investigation; do not overwrite an existing identity by matching names or emails. Admins require the same identity verification before linking. To revoke all app sessions for a user, delete their rows from `auth_sessions`; changing `users.is_admin` takes effect on the next request. Snapshot restores also restore sessions, so invalidate session/login-transaction rows when restoring into another deployment.

## Seeding

`seed` loads whatever the config enables:

| Key | Loads |
|---|---|
| `SEED_TEMPLATES_FROM` | fonts and local templates/variations from a [jacebrowning/memegen](https://github.com/jacebrowning/memegen) checkout. `library download` prepares this directory. Root metadata/defaults come from the unified manifest; unknown and retired folders are skipped. |
| `SEED_TEMPLATE_MANIFEST` | rated still/GIF templates, text placements, and native panel crop recipes from `library/MANIFEST.json` by default; set to an empty value to disable the manifest importer, or another rated manifest path to replace its selection. Panel imports require Playwright Chromium (`bunx playwright install chromium`). The checkout importer remains independently configurable. Media are stored locally, not hotlinked in the app. |
| `SEED_MAX_RISK` | integer 1–5, default **3**. Imports only entries at or below the ceiling; reseeding hides previously imported built-ins above it. Use 3 for work settings (ratings 4–5 excluded), 1 for the most conservative selection, or 5 to include every rating. |
| `SEED_SAMPLE=true` | the dev sample site: twelve users (`dana`, `eli`, …) with about 20 memes, votes, comments, and favorites. Needs the templates. *(dev only)* |
| `SEED_STICKERS_FROM` | every PNG (≤ 512×512) in that folder becomes a built-in sticker *(dev only)* |
| `SEED_STARTER=true` | a few work-appropriate example memes posted by `memegen` |

To start over: `./run.sh config/dev.env reset`.

Preview the corpus without seeding: `./run.sh config/dev.env library serve`, then open http://127.0.0.1:8088/. The inspector supports text/tag/rating filters and optional captions rendered with the editor's real fonts and layout. It needs no running application or database. Offline metadata browsing also works by opening [`library/index.html`](library/index.html).

The library importer loads configured checkout content, then the manifest, with one migration/registry/reconciliation lifecycle. Reruns preserve successful imports and existing IDs, bytes, defaults, and saved memes. Reconciliation makes over-ceiling and retired templates **unlisted**, not inaccessible by link, and runs even after partial import failure. `--limit 0` still installs checkout fonts and reconciles; it is not a dry run. Disabling both sources skips reconciliation.

See [the library guide](library/README.md) for corpus editorial rules, source provenance, font/layout vocabulary, gallery controls, and safe reseeding. The catalog is a reviewed checked-in selection, not a live feed. Source availability is not redistribution permission; review rights before deploying or sharing snapshots.

## Snapshots

A snapshot is one zip holding the whole database and every image, GIF, video, and font.

```sh
# Back up real data (read-only, safe while the app runs)
./run.sh config/prod.env snapshot save

# Dev: save the sample data once, restore it in seconds
./run.sh config/dev.env snapshot save .data/snapshots/sample.zip --label sample
./run.sh config/dev.env snapshot load .data/snapshots/sample.zip --replace

# Ship starter content to a new deployment
./run.sh config/starter.env setup
./run.sh config/starter.env reset
./run.sh config/starter.env snapshot save .data/snapshots/starter.zip --label starter
./run.sh config/prod.env setup && ./run.sh config/prod.env snapshot load starter.zip
```

- Older snapshots load and are migrated forward. Snapshots from newer code are refused.
- Loads only go into a clean system (empty, or freshly set up), so they never overwrite real data.
- Every file is checksummed. A missing or corrupt asset fails the save or load.
- Snapshots go to `.data/snapshots/` (gitignored) and can hold user data, so keep them out of git.

## Tests

```sh
./run.sh config/dev.env typecheck                    # import boundaries + TypeScript
./run.sh config/dev.env test                         # serial unit/integration tests
./run.sh config/dev.env e2e                          # library inspector + full application
./run.sh config/dev.env e2e nav.spec.ts               # one spec; Playwright args pass through
./run.sh config/dev.env e2e --project=library         # gallery only; no database or app stack
./run.sh config/dev.env e2e --project=chrome --ui     # application Playwright UI
```

The e2e suite runs in branded Google Chrome, because MP4 export needs its H.264/AAC support. `E2E_CHANNEL=chromium` uses Playwright's Chromium instead, but then the video spec fails. `ffprobe` must be on `PATH`.

Destructive setup requires dedicated database names: `memegen_test`, `memegen_snapshot_test`, and `memegen_e2e`. They may be hosted remotely but must differ from the main database name. PostgreSQL URLs may use `ssl`, `sslmode`, `connect_timeout`, and `application_name` options; target overrides are refused. E2E storage is confined to `.data/e2e-storage` and must differ from main storage. Production mode always refuses resets.

The unit tests and full-application browser suite run the search sidecar's real CLIP model, so their first run downloads it into `.data/search` (shared with `dev`). The library project uses local fixtures and the real browser renderer without PostgreSQL, application services, or CLIP. Test selection is resolved before starting infrastructure; a filter matching neither suite fails.

Fixtures in `e2e/fixtures/` are gitignored. Recreate them once (needs ffmpeg and the `demo/` checkout from Quick start):

```sh
mkdir -p e2e/fixtures && cd e2e/fixtures
ffmpeg -f lavfi -i testsrc=size=640x480 -frames:v 1 still.png
ffmpeg -f lavfi -i testsrc=size=160x120:rate=10:duration=1.2 \
  -filter_complex "split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 anim.gif
ffmpeg -f lavfi -i testsrc=size=320x240:rate=30:duration=1 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart clip.mp4
ffmpeg -f lavfi -i color=c=red:size=1100x60:rate=5:duration=0.4 too-wide.gif
ffmpeg -f lavfi -i testsrc=size=400x400 -frames:v 1 panel-a.jpg
ffmpeg -f lavfi -i color=c=blue:size=400x300 -frames:v 1 panel-b.jpg
ffmpeg -f lavfi -i color=c=magenta:size=120x80 -frames:v 1 sticker.png
ffmpeg -f lavfi -i mandelbrot=size=640x480 -frames:v 1 dup.png
ffmpeg -i dup.png -q:v 4 dup.jpg
cp ../../demo/jacebrowning-memegen/fonts/TitilliumWeb-Black.ttf .
cp "../../demo/jacebrowning-memegen/fonts/SIL Open Font License.txt" OFL.txt
cd ../..
```

## Fonts and licensing

The seed imports Impact (licensed for this project) and the SIL OFL fonts Titillium Web, Noto Sans, Noto Sans Hebrew, and Kalam. It skips the proprietary Segoe UI, Tahoma, and HG Mincho. Users can upload their own fonts in the editor.
