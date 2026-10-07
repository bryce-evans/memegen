# memegen

Online meme generator: pick a template (or upload an image, GIF, or video), place and animate text, then save, post, and vote in a public gallery.

Design and decisions live in [ARCH.md](ARCH.md).

| Part | Where | URL in dev |
|---|---|---|
| Gallery: Popular, Recent, voting, comments | `apps/web` | http://localhost:5173/ (Popular), http://localhost:5173/recent |
| Leaderboard | `apps/web` | http://localhost:5173/leaderboard |
| Profiles (stats, badges, templates contributed; your favorites and recent activity) | `apps/web` | http://localhost:5173/u/dana |
| Editor + template browser (find/add templates, hot templates, usage charts) | `apps/web` | http://localhost:5173/create |
| Tag pages (templates + memes for a tag) | `apps/web` | http://localhost:5173/t/oldschool |
| API (memes, templates, votes, users) | `services/api` | http://localhost:4000 |
| Storage (asset upload/serve) | `services/storage` | http://localhost:4001 |

The editor and gallery are routes of one Vite app. Meme rendering (text overlay, GIF/MP4 encoding) runs in the browser, so there is no separate render server.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3: installs packages, runs scripts, builds
- Node.js ≥ 24.2: runs the servers (`.ts` executed directly via type stripping)
- PostgreSQL 14+
- A Chromium-based browser, Safari 17+, or Firefox 130+ (WebCodecs) to export video memes. Images and GIFs work everywhere.

## Quick start

Everything goes through `run.sh` and a config file:

```sh
git clone --depth 1 https://github.com/jacebrowning/memegen demo/jacebrowning-memegen   # fonts + ~260 templates (the sample memes need them)
bunx playwright install chromium   # headless browser the seed renders sample memes in
./run.sh config/dev.env setup    # bun install, create databases if missing, migrate
./run.sh config/dev.env seed     # template import, then sample users/memes/votes/comments
./run.sh config/dev.env dev      # storage :4001 + API :4000 + web :5173, reloading on change
```

Then open:

- **Popular / Recent**: http://localhost:5173/ ranks by score over today, week, month, year, or all time; http://localhost:5173/recent lists the newest posts. Open a meme to vote and join its discussion (comments with replies).
- **Leaderboard**: http://localhost:5173/leaderboard ranks authors by h-score, high score, or memes posted. Profiles show tiered badges (🥉🥈🥇🏆💎), how many templates the user contributed, and a Templates tab listing them. Star (☆) other people's memes to save them; your own profile has Favorites and Recent activity (everything you liked or disliked, newest first) next to your memes, and Edit on each of your templates to rename it and change its default text boxes.
- **Create**: http://localhost:5173/create. Every meme starts from a template: find one (the list loads more as you scroll), or add your own media as a new template: upload it, place its default text boxes in the Template Editor, name and tag it, and confirm. **Multi-panel template** builds the other kind (expanding brain, panik kalm mememan): upload a pack of images, then set the default setup: layout (vertical or horizontal), grid on or off, text size, and the panels, each one a pack image plus its caption. Memes made from it can change all of that and add, remove, and reorder panels, picking any pack image for each one; the images are used as they are, never cropped or resized. Opening a template shows its tags, usage, and variations under the image. Templates show who added them; built-in ones are added by the reserved `memegen` account.
- **Image layers**: in the image/GIF/video editor, "Add image" in the Layers panel (or pasting an image, e.g. a screenshot, anywhere in the editor) uploads a PNG, JPEG, or WebP and drops it on the meme as a layer you can drag, resize, rotate, fade, reorder, and animate like text.
- **Stickers**: "+ Sticker" in the New template card on Create adds a PNG of at most 512×512 to the shared sticker library; "Add sticker" in the editor's Layers panel picks one and drops it on the meme as an image layer.
- **Tags**: browse popular and team tags in the side column, or open `/t/<tag>`. Templates keep their base tags (`oldschool`/`movie`, or team tags such as `google-memes`) and anyone signed in can add more; memes inherit their template's tags. New tags (including team tags) are created in the editor while authoring a meme.

Every page asks you to sign in first; you then land on the page you opened. The login is kept in a `memegen.user` cookie for a year, until you sign out.

The sign-in page depends on the config's `MODE`:

- **dev**: a username box and Sign in button; any username except the reserved `memegen` works. There are no passwords: the dev login only sets a user id header, which is not secure (see ARCH.md, "Auth"). A **Dev tools** panel in the bottom-left corner switches the `packages/ui` skin; the choice is kept in `localStorage` and applies to the whole app.
- **prod**: a placeholder **Sign in with SSO** button that only shows an alert (no identity provider yet), and the app is locked to the `default` skin.

## run.sh and configs

```
./run.sh <config> <command>
```

| Command | What it does |
|---|---|
| `setup` | `bun install`, create the database(s) if missing, run migrations |
| `migrate` | apply pending migrations |
| `seed` | import templates if `SEED_TEMPLATES_FROM` is set, then the sample dataset if `SEED_SAMPLE=true`, then dev test stickers from `SEED_STICKERS_FROM` |
| `reset` | drop the database schema and wipe local storage, then `seed` *(dev only)* |
| `dev` | migrate, then storage + API + Vite dev server with reload *(dev only)* |
| `build` | production build of the web app (`apps/web/dist`) |
| `start` | build, migrate, then run storage + API + `scripts/serve-web.ts`, which serves `dist` and proxies `/api` and `/storage` |
| `test` / `e2e` | unit/integration tests / Playwright browser tests *(dev only)*; extra args pass through |
| `config` | print the resolved config with secrets masked |

`dev` and `start` run `scripts/run.ts` (`--watch` / `--prod`), which prefixes each line of output with its process (`[api] …`). If any process exits, or on Ctrl-C, all stop.

Configs are plain `KEY=value` files:

- **`config/dev.env`** (committed): local Postgres, local file storage, sample data on, all test commands allowed.
- **`config/prod.env`** (gitignored; copy from `config/prod.env.example`): real user data. `MODE=prod` enables guards. `run.sh` refuses sample seeding, `dev`, `reset`, `test`, and `e2e`, and requires a strong `INTERNAL_TOKEN` and a real `DATABASE_URL`.

```sh
cp config/prod.env.example config/prod.env   # then edit: DATABASE_URL, INTERNAL_TOKEN, S3_*
./run.sh config/prod.env setup
./run.sh config/prod.env start               # web on WEB_PORT (8080 in the template)
```

Auth is still the dev placeholder, so put a real `AuthProvider` in place before exposing prod to untrusted users.

Individual `bun run …` scripts (`dev`, `db:migrate`, `seed`, `seed:sample`) still work and fall back to `config/dev.env`.

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

- **Templates and fonts** (`SEED_TEMPLATES_FROM`): imports Impact plus the OFL fonts and about 260 templates and variations from a [jacebrowning/memegen](https://github.com/jacebrowning/memegen) checkout. It dedupes by hash/slug, so re-runs are safe. Pass `--limit 20` through `seed` for a quick subset (the sample dataset then can't find its templates).
- **Sample data** (`SEED_SAMPLE=true`, dev only): the realistic dataset in `scripts/sample/data.ts`, so the dev app looks like a live site. It contains:
  - twelve users (`dana`, `eli`, … `otto`) who post, vote, comment, reply, and favorite
  - about 20 memes captioned on real templates (two animated GIFs), posted between 1 hour and 420 days ago, plus a private meme and a draft
  - `programming` and `office` tags on memes

  Only data is committed. During `seed`, each meme's image is rendered from its template by the same client renderer the editor uses (`@memegen/render`, in Playwright's headless Chromium) and stored like any upload. Seeding is offline and a no-op once `dana` exists. To start over (e.g. after changing the dataset): `./run.sh config/dev.env reset`.
- **Test stickers** (`SEED_STICKERS_FROM=demo/stickers`, dev only): every PNG (≤ 512×512) in that local, gitignored folder becomes a built-in sticker, named after its file (`deal-with-it.png` → "Deal With It"). Re-runs are safe; a missing folder is skipped.
- **Mock data** (e2e only): `scripts/mock/data.ts`, a small dataset with generated gradient media and hand-written expectations. The e2e setup loads it into `memegen_e2e`; it is never seeded into dev.

## Tests

```sh
./run.sh config/dev.env test                       # unit/integration: shared logic, storage caps, API rules (memegen_test DB, wiped)
./run.sh config/dev.env e2e                        # Playwright browser flows (memegen_e2e DB, wiped)
./run.sh config/dev.env e2e nav.spec.ts            # one spec; any Playwright args pass through
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
ffmpeg -f lavfi -i testsrc=size=400x400 -frames:v 1 panel-a.jpg
ffmpeg -f lavfi -i color=c=blue:size=400x300 -frames:v 1 panel-b.jpg
ffmpeg -f lavfi -i color=c=magenta:size=120x80 -frames:v 1 sticker.png
cp ../../demo/jacebrowning-memegen/fonts/TitilliumWeb-Black.ttf .
cp "../../demo/jacebrowning-memegen/fonts/SIL Open Font License.txt" OFL.txt
cd ../..
```

The e2e suite starts its own storage (:4101), API (:4100), and Vite (:5174) against `memegen_e2e` and `.data/e2e-storage`, so it doesn't touch a running dev stack. It reseeds that database with the mock dataset on every run. It drives branded **Google Chrome** (`channel: "chrome"`, the single Playwright project), because MP4 export needs Chrome's H.264/AAC WebCodecs. Set `E2E_CHANNEL=chromium` to use Playwright's Chromium; the video spec will then fail. The specs cover:

- the sign-in gate: every URL shows the sign-in page first, then opens; the cookie login survives reloads until sign-out; a stored user the server no longer knows is signed out
- the core workflow: pick a template on Create, add top and bottom text, download, save to profile, post, find it under Recent
- Popular (by period) and Recent feeds, voting (up +1; down removes the upvote and moves the negative downvote count, e.g. −2 → −3), checked against the mock dataset
- sidebar order, leaderboard, profile stats, badges and templates contributed, the Templates tab (Edit for the author: rename and change default text), the owner-only Favorites and Recent activity tabs
- comments and replies on a meme
- still images, GIFs, and videos in the editor: every-frame timeline, keyframes, visibility windows, the looping animation preview, and exported frame counts/audio checked with `ffprobe`
- image layers: upload one and paste another (a synthetic clipboard paste), resize, GIFs refused, save, the pasted image's pixels in the exported file, and re-edit
- stickers: "+ Sticker" refuses a PNG over 512×512 and a JPEG, adds a small PNG, and Add sticker puts it on a meme (saved layer and exported pixels checked)
- multi-panel templates: build one from an image pack, add panels and swap their images, switch layout, save, and re-edit, with export sizes checked against the uncropped pack images
- templates and variations, base and added tags, tag creation in the editor, tag pages, hot templates, auto-loading template list
- upload caps and custom fonts

`ffprobe` (from ffmpeg) must be on `PATH` for the e2e media checks. The app itself does not need ffmpeg.

## Configuration

All settings are `KEY=value` entries in the config file you pass to `run.sh` (see `config/dev.env` and `config/prod.env.example` for every key).

- `WEB_PORT`, `API_PORT`, `STORAGE_PORT`: the web app proxies `/api` and `/storage` to `localhost` on those ports. Set `API_URL`/`STORAGE_URL` only when the services run on other hosts.
- `STORAGE_PROVIDER`: `local` (default, files in `.data/storage`) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, …).
- Upload caps: every file must be ≤ 20 MB. Longest edge: images 4096 px, GIFs 1024 px, videos 1920 px. Frames: GIFs 500, videos 1800. Override with `MAX_*` variables.
- `INTERNAL_TOKEN`: guards `/internal/*` on the API (e.g. a user's secret negative h-score).

## Fonts and licensing

The seed imports Impact (licensed for this project) and the SIL OFL fonts Titillium Web, Noto Sans, Noto Sans Hebrew, and Kalam. It skips the proprietary Segoe UI, Tahoma, and HG Mincho. Users can upload their own fonts from the editor.
