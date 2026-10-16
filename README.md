# memegen

A self-hosted meme generator with a public gallery. Pick a template (or bring your own image, GIF, or video), place and animate text, then save, post, and vote.

## Features

- **Templates**: about 260 built-in templates with variations, plus your own uploads. Search, filter by kind, see what's hot, and check each template's usage chart.
- **Editor**: text boxes that wrap and shrink to fit (drag their corners to resize), custom fonts, image layers (upload or paste a screenshot), and a shared sticker library.
- **Animation**: for GIFs and videos, a frame-by-frame timeline with per-layer visibility windows, keyframes, and a live loop preview. Exports are GIF or MP4, and MP4s keep their audio.
- **Caption memes**: a top-section toggle adds a white band with its own text above the media.
- **Multi-panel templates**: expanding brain and similar formats, built from an image pack. Memes can add, remove, and reorder panels.
- **Creator**: at the top of Create, a template (a random one to start) drawn with its text, and one Describe field (prefilled with the template's top and bottom text). The AI places the described text and makes any described change to the image (the result becomes a new template), then the editor opens prefilled. Uses OpenAI or Google Gemini with your own API key (added under your profile's AI keys tab). Below it, an Upload card adds a template, multi-panel template, or sticker.
- **Gallery**: Popular (day, week, month, year, or all time) and Recent feeds, voting, threaded comments, favorites, search, and tag pages.
- **Profiles and leaderboard**: a Profile tab with h-score, high score, and tiered badges; the user's memes and templates; and, on your own profile, AI keys plus private Favorites and Recent activity tabs.
- **Skins**: seven interchangeable looks from `packages/ui` (dev only. Prod is locked to `default`).
- **Snapshots**: back up or restore the whole site (database and media) as one zip.

All rendering happens in the browser. The servers only store, validate, and index. How it works and why: [ARCH.md](ARCH.md).

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- Node.js ≥ 24.2
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
git clone --depth 1 https://github.com/jacebrowning/memegen demo/jacebrowning-memegen   # templates + fonts
bunx playwright install chromium     # the seed renders sample memes in headless Chromium
./run.sh config/dev.env setup        # install, create databases, migrate
./run.sh config/dev.env seed         # templates, then sample users/memes/votes/comments
./run.sh config/dev.env dev          # storage :4001, API :4000, web :5173, all reloading on change
```

Open http://localhost:5173 and sign in with any username (there are no passwords in dev). Some pages to try:

| Page | URL |
|---|---|
| Popular / Recent | http://localhost:5173/, http://localhost:5173/recent |
| Create (template browser + editor) | http://localhost:5173/create |
| Leaderboard | http://localhost:5173/leaderboard |
| A profile | http://localhost:5173/u/dana |
| A tag page | http://localhost:5173/t/oldschool |

In dev, a **Dev tools** panel on the sign-in page switches skins.

## Commands

Everything runs through `./run.sh <config> <command>`:

| Command | What it does |
|---|---|
| `setup` | `bun install`, create missing databases, migrate |
| `migrate` | apply pending migrations |
| `seed` | import templates and the configured datasets (see [Seeding](#seeding)) |
| `reset` | wipe the database and local storage, then `seed` *(dev only)* |
| `dev` | migrate, then run storage + API + Vite with reload *(dev only)* |
| `build` | production build of the web app |
| `start` | build, migrate, then serve everything on `WEB_PORT` |
| `snapshot save [out.zip] [--label name]` | write the database and every asset into one zip |
| `snapshot load <in.zip> [--replace]` | load a snapshot into a clean system; `--replace` wipes first *(dev only)* |
| `test` / `e2e` | unit/integration tests / Playwright browser tests *(dev only)* |
| `config` | print the resolved config, secrets masked |

## Configs

Configs are plain `KEY=value` files:

- `config/dev.env` (committed): local Postgres, local file storage, sample data.
- `config/prod.env` (gitignored, copied from `config/prod.env.example`): real data. `MODE=prod` refuses dev-only commands and sample data, and requires a strong `INTERNAL_TOKEN` and a real `DATABASE_URL`.
- `config/starter.env` (committed): builds the starter-content snapshot in its own database.

Main keys (see `config/dev.env` and `config/prod.env.example` for all of them):

- `WEB_PORT`, `API_PORT`, `STORAGE_PORT`: the web app proxies `/api` and `/storage` to these. Set `API_URL`/`STORAGE_URL` only when the services run on other hosts.
- `STORAGE_PROVIDER`: `local` (files in `.data/storage`) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, …).
- `MAX_*`: upload caps. Defaults are 20 MB per file. Longest edge: images 4096 px, GIFs 1024 px, videos 1920 px. Frames: GIFs 500, videos 1800.
- `INTERNAL_TOKEN`: guards the API's `/internal/*` routes.
- `OPENAI_IMAGE_MODEL` (default `gpt-image-2`), `GEMINI_IMAGE_MODEL` (default `gemini-nano-banana-2.1`): models for AI images. `OPENAI_TEXT_MODEL` (default `gpt-5-mini`), `GEMINI_TEXT_MODEL` (default `gemini-2.5-flash`): models that place AI captions. Users bring their own API keys, so the server needs none. `OPENAI_BASE_URL`/`GEMINI_BASE_URL` point at a proxy or gateway.

### Production

```sh
cp config/prod.env.example config/prod.env   # set DATABASE_URL, INTERNAL_TOKEN, S3_*
./run.sh config/prod.env setup
./run.sh config/prod.env start
```

> [!WARNING]
> Sign-in is still a placeholder: prod shows a "Sign in with SSO" button that does nothing yet, and the API trusts a user-id header. Put a real `AuthProvider` in place before exposing prod to untrusted users.

## Seeding

`seed` loads whatever the config enables:

| Key | Loads |
|---|---|
| `SEED_TEMPLATES_FROM` | fonts and about 260 templates from a [jacebrowning/memegen](https://github.com/jacebrowning/memegen) checkout. Safe to re-run. |
| `SEED_SAMPLE=true` | the dev sample site: twelve users (`dana`, `eli`, …) with about 20 memes, votes, comments, and favorites. Needs the templates. *(dev only)* |
| `SEED_STICKERS_FROM` | every PNG (≤ 512×512) in that folder becomes a built-in sticker *(dev only)* |
| `SEED_STARTER=true` | a few work-appropriate example memes posted by `memegen` |

To start over: `./run.sh config/dev.env reset`.

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
./run.sh config/dev.env test              # unit + integration (wipes memegen_test)
./run.sh config/dev.env e2e               # Playwright (wipes memegen_e2e; own ports, doesn't touch dev)
./run.sh config/dev.env e2e nav.spec.ts   # one spec; Playwright args pass through
bun run test:e2e:ui                       # Playwright UI mode
bun run typecheck
```

The e2e suite runs in branded Google Chrome, because MP4 export needs its H.264/AAC support. `E2E_CHANNEL=chromium` uses Playwright's Chromium instead, but then the video spec fails. `ffprobe` must be on `PATH`.

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
cp ../../demo/jacebrowning-memegen/fonts/TitilliumWeb-Black.ttf .
cp "../../demo/jacebrowning-memegen/fonts/SIL Open Font License.txt" OFL.txt
cd ../..
```

## Fonts and licensing

The seed imports Impact (licensed for this project) and the SIL OFL fonts Titillium Web, Noto Sans, Noto Sans Hebrew, and Kalam. It skips the proprietary Segoe UI, Tahoma, and HG Mincho. Users can upload their own fonts in the editor.
