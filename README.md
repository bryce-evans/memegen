# memegen

Online meme generator: pick a template (or upload an image, GIF, or video), place and animate text, then save, post, and vote in a public gallery.

Design and decisions live in [ARCH.md](ARCH.md).

| Part | Where | URL in dev |
|---|---|---|
| Gallery (browse, vote, profiles) | `apps/web` | http://localhost:5173/ |
| Editor | `apps/web` | http://localhost:5173/create |
| Templates (+ hot templates, usage charts) | `apps/web` | http://localhost:5173/templates |
| Tag pages (templates + memes for a tag) | `apps/web` | http://localhost:5173/t/oldschool |
| API (memes, templates, votes, users) | `services/api` | http://localhost:4000 |
| Storage (asset upload/serve) | `services/storage` | http://localhost:4001 |

The editor and gallery are routes of one Vite app. Meme rendering (text overlay, GIF/MP4 encoding) runs in the browser, so there is no separate render server.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3: installs packages, runs scripts, builds
- Node.js ≥ 23.6: runs the servers (`.ts` executed directly via type stripping)
- PostgreSQL 14+
- A Chromium-based browser, Safari 17+, or Firefox 130+ (WebCodecs) to export video memes. Images and GIFs work everywhere.

## Setup

```sh
bun install
cp .env.example .env            # defaults work for a local Postgres on :5432
```

### 1. Start the database

Homebrew:

```sh
brew services start postgresql@16
createdb memegen
createdb memegen_test           # only needed for `bun run test`
```

Or Docker:

```sh
docker run -d --name memegen-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
docker exec memegen-pg createdb -U postgres memegen
docker exec memegen-pg createdb -U postgres memegen_test
# then set DATABASE_URL=postgres://postgres@localhost:5432/memegen in .env
```

Apply migrations (`bun run dev` also does this on start):

```sh
bun run db:migrate
```

### 2. Seed fonts and templates (optional, recommended)

Imports Impact plus the OFL fonts, and about 260 templates and variations, from a [jacebrowning/memegen](https://github.com/jacebrowning/memegen) checkout:

```sh
git clone --depth 1 https://github.com/jacebrowning/memegen demo/jacebrowning-memegen
bun run seed -- --from demo/jacebrowning-memegen          # add --limit 20 for a quick subset
```

The seed is safe to re-run: it dedupes files by hash and templates by slug.

## Running

Everything at once (migrations, storage, API, web with prefixed logs; servers reload on change):

```sh
bun run dev
```

Or each piece in its own terminal:

```sh
bun run --cwd services/storage start    # backend: storage service  :4001
bun run --cwd services/api start        # backend: API service      :4000
bun run --cwd apps/web dev              # frontend: editor + gallery :5173
```

Then open:

- **Gallery**: http://localhost:5173/. Sort by Best or New over today, week, month, year, or all time.
- **Editor**: http://localhost:5173/create. Upload media, or choose a template at http://localhost:5173/templates and click "Use".
- **Tags**: search tags in the side column, or open `/t/<tag>`. Templates are tagged `oldschool`/`movie` or with team tags (e.g. `google-memes`), and memes inherit their template's tags.

Sign in with any username in the header. There are no passwords yet: the dev login only sets a user id header, which is not secure (see ARCH.md, "Auth").

## Tests

```sh
bun run test         # unit/integration: shared logic, storage caps, API rules (memegen_test DB, wiped)
bun run test:e2e     # Playwright browser flows (memegen_e2e DB, wiped)
bun run test:e2e:ui  # same, in Playwright's UI mode
bun run typecheck    # servers/packages/e2e + web app
bun run build        # production build of the web app → apps/web/dist
```

End-to-end setup (once):

```sh
createdb memegen_e2e
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

The e2e suite starts its own storage (:4101), API (:4100), and Vite (:5174) against `memegen_e2e` and `.data/e2e-storage`, so it doesn't touch a running `bun run dev`. It drives branded **Google Chrome** (`channel: "chrome"`), because MP4 export needs Chrome's H.264/AAC WebCodecs. Set `E2E_CHANNEL=chromium` to use Playwright's Chromium; the video spec will then fail. The specs cover:

- still images, GIFs, and videos in the editor: every-frame timeline, keyframes, visibility windows, and exported frame counts/audio checked with `ffprobe`
- gallery visibility, voting and sorting, and profile stats
- templates and variations, tags and tag search, hot templates
- upload caps and custom fonts

`ffprobe` (from ffmpeg) must be on `PATH` for the e2e media checks. The app itself does not need ffmpeg.

## Configuration

All settings are environment variables; see [.env.example](.env.example).

- `STORAGE_PROVIDER`: `local` (default, files in `.data/storage`) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, …).
- Upload caps: every file must be ≤ 20 MB. Longest edge: images 4096 px, GIFs 1024 px, videos 1920 px. Frames: GIFs 500, videos 1800. Override with `MAX_*` variables.
- `INTERNAL_TOKEN`: guards `/internal/*` on the API (e.g. a user's secret negative h-score).

## Fonts and licensing

The seed imports Impact (licensed for this project) and the SIL OFL fonts Titillium Web, Noto Sans, Noto Sans Hebrew, and Kalam. It skips the proprietary Segoe UI, Tahoma, and HG Mincho. Users can upload their own fonts from the editor.
