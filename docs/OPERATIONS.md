# Operations reference

Start with [DEV_SETUP.md](../DEV_SETUP.md) for a local server. Run commands below from the repository root.

- [Admin access](#admin-access)
- [Commands](#commands) and [configuration](#configs)
- [Production deployment](#deployment-setup) and [feedback delivery](#feedback-connector-setup)
- [Seeding](#seeding) and [backups](#snapshots)
- [Intro-video production](#intro-video)
- [Fonts and licensing](#fonts-and-licensing)

## Admin access

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
| `library duplicates` | index seeded template images/GIFs with CLIP and report very close duplicate candidates; requires storage |

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

Preview the corpus without seeding: `./run.sh config/dev.env library serve`, then open http://127.0.0.1:8088/. The inspector supports text/tag/rating filters and optional captions rendered with the editor's real fonts and layout. It needs no running application or database. Offline metadata browsing also works by opening [`library/index.html`](../library/index.html).

The library importer loads configured checkout content, then the manifest, with one migration/registry/reconciliation lifecycle. Reruns preserve successful imports and existing IDs, bytes, defaults, and saved memes. Reconciliation makes over-ceiling and retired templates **unlisted**, not inaccessible by link, and runs even after partial import failure. `--limit 0` still installs checkout fonts and reconciles; it is not a dry run. Disabling both sources skips reconciliation.

See [the library guide](../library/README.md) for corpus editorial rules, source provenance, font/layout vocabulary, gallery controls, and safe reseeding. The catalog is a reviewed checked-in selection, not a live feed. Source availability is not redistribution permission; review rights before deploying or sharing snapshots.

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

## Intro video

[`intro-video/`](../intro-video/) contains the Bun scripts and JSON inputs for the promotional video. Within that directory, Git includes only the three production scripts, `timeline.json`, `production.json`, the two template catalogs, and music-source metadata. An explicit `.gitignore` allowlist excludes all media, rendered HTML, intermediate frames, logs, and historical versions.

**Keep a separate backup of the source media.** A fresh Git checkout alone cannot reproduce the video. Restore these inputs under `intro-video/`, preserving their paths:

- `raw/`: the recorded app clips referenced by `timeline.json`, plus `meme.png` and `fren.png`.
- `template-assets/` and `thumbnails/template-assets/`: image files listed in their tracked `catalog.json` files. Local template IDs are provenance, not portable download links.
- `music/golden-bossa-breeze.mp3`: the user-supplied soundtrack; its provenance is in `music/golden-bossa-breeze-source.json`.

After installing workspace dependencies with `bun install`, install Playwright Chromium with `bunx playwright install chromium` and ensure `ffmpeg` and `ffprobe` are on PATH. The graphics use bundled workspace fonts, with local Radlush Extra Bold preferred when installed; matching the original typography requires that same local font. No running application or database is needed to render from restored inputs.

Run the complete pipeline from the repository root:

```sh
bun intro-video/generate-graphics.ts
bun intro-video/generate-graphics.ts --thumbnails
bun intro-video/generate-audio.ts
bun intro-video/render-video.ts --assemble
```

The outputs are `intro-video/memegen-intro.mp4` and `intro-video/thumbnails/doge-discovers-memegen.png`. The thumbnail is the video's actual first frame as well as embedded cover art. Edit `timeline.json` for scene order, timing, and captions; `generate-graphics.ts` for composition and animation; and the thumbnail catalog for its image selection. The scripts render existing recordings; they do not recapture app interactions or acquire missing media. Production details and source-rights notes are in `production.json`. Repository database snapshots do not back up these production media files.

### Published README video

The approved export is published separately at `docs/videos/memegen-intro.mp4`. `.gitattributes` stores MP4s in that directory through [Git LFS](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage), keeping their bytes out of normal Git history. The small `docs/videos/memegen-intro.png` preview is stored in regular Git so the README image works without downloading LFS objects. The README uses a clickable preview, not an inline GitHub video player.

Both README links use the direct LFS media URL on `media.githubusercontent.com/media/bryce-evans/memegen/main/`, rather than GitHub's failing `blob/main/…?raw=true` file-page route. GitHub serves the MP4 as a binary download, so the README labels it as a download, not an inline player. The URL follows the published `main` branch; forks must update the owner/repository.

Install Git LFS before adding or pushing a new export. To initialize it for this clone and retrieve the published video:

```sh
git lfs install --local
git lfs pull --include="docs/videos/*.mp4"
```

After reviewing a new render, refresh the published video and preview from the repository root:

```sh
cp intro-video/memegen-intro.mp4 docs/videos/memegen-intro.mp4
ffmpeg -hide_banner -loglevel error -y \
  -i intro-video/thumbnails/doge-discovers-memegen.png \
  -vf scale=960:-1 -frames:v 1 -c:v png -compression_level 9 \
  docs/videos/memegen-intro.png
```

Commit `.gitattributes`, the published video, its preview, and the README together. The LFS pre-push hook uploads the video object; do not bypass it. GitHub LFS storage and bandwidth limits apply. Source recordings, music, and intermediate renders remain ignored; publishing this export does not grant redistribution rights to its third-party media.

## Fonts and licensing

The seed imports Impact (licensed for this project) and the SIL OFL fonts Titillium Web, Noto Sans, Noto Sans Hebrew, and Kalam. It skips the proprietary Segoe UI, Tahoma, and HG Mincho. Fonts are supplied by the installation; user font uploads are not allowed.
