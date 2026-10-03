# memegen

Online meme generator: pick a template (or upload an image, GIF, or video), place and animate text, then save, post, and vote in a public gallery.

Design and decisions live in [ARCH.md](ARCH.md).

| Part | Where | URL in dev |
|---|---|---|
| Gallery: Popular, Recent, voting, comments | `apps/web` | http://localhost:5173/ (Popular), http://localhost:5173/recent |
| Leaderboard | `apps/web` | http://localhost:5173/leaderboard |
| Profiles (stats, badges, templates contributed; your favorites and recent activity) | `apps/web` | http://localhost:5173/u/mock-alice |
| Editor + template browser (find/add templates, hot templates, usage charts) | `apps/web` | http://localhost:5173/create |
| Tag pages (templates + memes for a tag) | `apps/web` | http://localhost:5173/t/oldschool |
| API (memes, templates, votes, users) | `services/api` | http://localhost:4000 |
| Storage (asset upload/serve) | `services/storage` | http://localhost:4001 |

The editor and gallery are routes of one Vite app. Meme rendering (text overlay, GIF/MP4 encoding) runs in the browser, so there is no separate render server.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3: installs packages, runs scripts, builds
- Node.js ≥ 23.6: runs the servers (`.ts` executed directly via type stripping)
- PostgreSQL 14+
- A Chromium-based browser, Safari 17+, or Firefox 130+ (WebCodecs) to export video memes. Images and GIFs work everywhere.

## Quick start

Everything goes through `run.sh` and a config file:

```sh
git clone --depth 1 https://github.com/jacebrowning/memegen demo/jacebrowning-memegen   # optional: fonts + ~260 templates
./run.sh config/dev.env setup    # bun install, create databases if missing, migrate
./run.sh config/dev.env seed     # mock users/memes/votes + the template import
./run.sh config/dev.env dev      # storage :4001 + API :4000 + web :5173, reloading on change
```

Then open:

- **Popular / Recent**: http://localhost:5173/ ranks by score over today, week, month, year, or all time; http://localhost:5173/recent lists the newest posts. Open a meme to vote and join its discussion (comments with replies).
- **Leaderboard**: http://localhost:5173/leaderboard ranks authors by h-score, high score, or memes posted. Profiles show tiered badges (🥉🥈🥇🏆💎) and how many templates the user contributed. Star (☆) other people's memes to save them; your own profile has Favorites and Recent activity (everything you liked or disliked, newest first) next to your memes.
- **Create**: http://localhost:5173/create. Every meme starts from a template: find one (the list loads more as you scroll), or add your own media as a new template: upload it, place its default text boxes in the Template Editor, name and tag it, and confirm. Opening a template shows its tags, usage, and variations under the image. Templates show who added them; built-in ones are added by the reserved `memegen` account.
- **Tags**: search tags in the side column, or open `/t/<tag>`. Templates keep their base tags (`oldschool`/`movie`, or team tags such as `google-memes`) and anyone signed in can add more; memes inherit their template's tags. New tags (including team tags) are created in the editor while authoring a meme.
- **Skins**: switch between Default, Apple, Matte, Google, Studio, and Spectrum in the header, or add `?skin=<id>` to a URL. The browser tab icon follows the skin.

Sign in with any username except the reserved `memegen` in the header. There are no passwords yet: the dev login only sets a user id header, which is not secure (see ARCH.md, "Auth").

## run.sh and configs

```
./run.sh <config> <command>
```

| Command | What it does |
|---|---|
| `setup` | `bun install`, create the database(s) if missing, run migrations |
| `migrate` | apply pending migrations |
| `seed` | load mock data if `SEED_MOCK=true`; import templates if `SEED_TEMPLATES_FROM` is set |
| `dev` | storage + API + Vite dev server with reload *(dev only)* |
| `build` | production build of the web app (`apps/web/dist`) |
| `start` | build, migrate, then run storage + API + `scripts/serve-web.ts`, which serves `dist` and proxies `/api` and `/storage`. If any process exits, all stop. |
| `test` / `e2e` | unit/integration tests / Playwright browser tests *(dev only)*; extra args pass through |
| `config` | print the resolved config with secrets masked |

Configs are plain `KEY=value` files:

- **`config/dev.env`** (committed): local Postgres, local file storage, mock data on, all test commands allowed.
- **`config/prod.env`** (gitignored; copy from `config/prod.env.example`): real user data. `MODE=prod` enables guards. `run.sh` refuses mock seeding, `dev`, `test`, and `e2e`, and requires a strong `INTERNAL_TOKEN` and a real `DATABASE_URL`.

```sh
cp config/prod.env.example config/prod.env   # then edit: DATABASE_URL, INTERNAL_TOKEN, S3_*
./run.sh config/prod.env setup
./run.sh config/prod.env start               # web on WEB_PORT (8080 in the template)
```

Auth is still the dev placeholder, so put a real `AuthProvider` in place before exposing prod to untrusted users.

Individual `bun run …` scripts (`dev`, `db:migrate`, `seed`, `seed:mock`) still work and fall back to `config/dev.env`.

### Database

`setup` creates missing databases with `createdb`, so Postgres just needs to be running. Homebrew:

```sh
brew services start postgresql@16
```

Or Docker (then point the `*_DATABASE_URL` values at `postgres://postgres@localhost:5432/...`):

```sh
docker run -d --name memegen-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
```

### Seeding

- **Templates and fonts** (`SEED_TEMPLATES_FROM`): imports Impact plus the OFL fonts and about 260 templates and variations from a [jacebrowning/memegen](https://github.com/jacebrowning/memegen) checkout. It dedupes by hash/slug, so re-runs are safe. Pass `--limit 20` through `seed` for a quick subset.
- **Mock data** (`SEED_MOCK=true`, dev only): a deterministic dataset defined in `scripts/mock/data.ts`, with all media generated in code. The e2e suite uses the same dataset, and re-running is a no-op. It contains:
  - authors `mock-alice`, `mock-bob`, `mock-carol`, `mock-dave`, plus voter accounts
  - templates, with one variation, tagged `oldschool`/`movie`
  - a dozen memes posted between 1 hour and 400 days ago, with votes, a private meme, and a draft

## Tests

```sh
./run.sh config/dev.env test                       # unit/integration: shared logic, storage caps, API rules (memegen_test DB, wiped)
./run.sh config/dev.env e2e                        # Playwright browser flows, every skin (memegen_e2e DB, wiped)
./run.sh config/dev.env e2e --project=google       # one skin; any Playwright args pass through
bun run test:e2e:ui                                # Playwright UI mode
bun run typecheck                                  # servers/packages/e2e + web app (incl. packages/ui)
```

End-to-end setup (once; `setup` already creates `memegen_e2e`):

```sh
bunx playwright install chromium   # Playwright's own browser bits
```

Fixtures live in `e2e/fixtures/`, which is gitignored like `demo/`, so a fresh clone must recreate them. You need ffmpeg and the demo checkout from the seed step:

```sh
mkdir -p e2e/fixtures && cd e2e/fixtures
ffmpeg -f lavfi -i testsrc=size=640x480 -frames:v 1 still.png
ffmpeg -f lavfi -i testsrc=size=160x120:rate=10:duration=1.2 \
  -filter_complex "split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 anim.gif
ffmpeg -f lavfi -i testsrc=size=320x240:rate=30:duration=1 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart clip.mp4
ffmpeg -f lavfi -i color=c=red:size=1100x60:rate=5:duration=0.4 too-wide.gif
cp ../../demo/jacebrowning-memegen/fonts/TitilliumWeb-Black.ttf .
cp "../../demo/jacebrowning-memegen/fonts/SIL Open Font License.txt" OFL.txt
cd ../..
```

The e2e suite starts its own storage (:4101), API (:4100), and Vite (:5174) against `memegen_e2e` and `.data/e2e-storage`, so it doesn't touch a running dev stack. It reseeds that database with the mock dataset on every run. Every spec runs once per UI skin (Playwright projects `default`, `apple`, `matte`, `google`, `studio`, `spectrum`). It drives branded **Google Chrome** (`channel: "chrome"`), because MP4 export needs Chrome's H.264/AAC WebCodecs. Set `E2E_CHANNEL=chromium` to use Playwright's Chromium; the video spec will then fail. The specs cover:

- the core workflow: pick a template on Create, add top and bottom text, download, save to profile, post, find it under Recent
- Popular (by period) and Recent feeds, voting (up +1; down removes the upvote and moves the negative downvote count, e.g. −2 → −3), checked against the mock dataset
- sidebar order, leaderboard, profile stats, badges and templates contributed, the owner-only Favorites and Recent activity tabs
- comments and replies on a meme
- still images, GIFs, and videos in the editor: every-frame timeline, keyframes, visibility windows, and exported frame counts/audio checked with `ffprobe`
- templates and variations, base and added tags, tag creation in the editor, tag search, hot templates, auto-loading template list
- upload caps and custom fonts
- skin selection: `?skin=`, the header switcher, persistence across reloads, a distinct look and favicon per skin

`ffprobe` (from ffmpeg) must be on `PATH` for the e2e media checks. The app itself does not need ffmpeg.

## Configuration

All settings are `KEY=value` entries in the config file you pass to `run.sh` (see `config/dev.env` and `config/prod.env.example` for every key).

- `STORAGE_PROVIDER`: `local` (default, files in `.data/storage`) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, …).
- Upload caps: every file must be ≤ 20 MB. Longest edge: images 4096 px, GIFs 1024 px, videos 1920 px. Frames: GIFs 500, videos 1800. Override with `MAX_*` variables.
- `INTERNAL_TOKEN`: guards `/internal/*` on the API (e.g. a user's secret negative h-score).

## Fonts and licensing

The seed imports Impact (licensed for this project) and the SIL OFL fonts Titillium Web, Noto Sans, Noto Sans Hebrew, and Kalam. It skips the proprietary Segoe UI, Tahoma, and HG Mincho. Users can upload their own fonts from the editor.
