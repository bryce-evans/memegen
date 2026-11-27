# Development setup

From a fresh clone to a local memegen server. These instructions use `config/dev.env`; do not expose this development server to the internet. For a shared or production instance, use the [deployment checklist](docs/OPERATIONS.md#deployment-setup).

## Requirements

Install these before starting:

- [Bun](https://bun.sh) **1.3+** and [Node.js](https://nodejs.org/) **24.2+**.
- [Git](https://git-scm.com/).
- **PostgreSQL 14+** and client tools: `psql`, `createdb`, `pg_dump`, and `pg_restore`. Client tools must be at least as new as the server and available on `PATH`.
- Internet access for dependencies, templates, browser binaries, and the optional search model.

For video export, use a Chromium-based browser, Safari 17+, or Firefox 130+ with WebCodecs. Images and GIFs work in any browser. Tests and intro-video production also need `ffmpeg` and `ffprobe`.

## 1. Clone the repository

```sh
git clone https://github.com/bryce-evans/memegen.git
cd memegen
```

Run the following commands from this directory. Git LFS is only needed to retrieve or publish the README's MP4, not to run the app; see [video storage](docs/OPERATIONS.md#published-readme-video).

## 2. Start PostgreSQL

Use an existing local PostgreSQL server, or choose one option below. The configured database role must be able to create databases; `setup` creates missing databases and applies migrations.

### macOS with Homebrew

```sh
brew install postgresql@16
export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
brew services start postgresql@16
pg_isready
```

Keep the PostgreSQL `bin` directory on your shell's `PATH` for future sessions. The default config connects to localhost as your OS user, which matches a typical Homebrew installation.

### Docker

Install the PostgreSQL client tools on your host as well, then run:

```sh
docker run -d --name memegen-pg \
  -p 127.0.0.1:5432:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v memegen-pg-data:/var/lib/postgresql/data \
  postgres:16
docker exec memegen-pg pg_isready -U postgres
```

Wait until PostgreSQL reports that it is accepting connections. This passwordless container is for trusted local development only. Restart it later with `docker start memegen-pg`.

## 3. Configure local connections

Open [`config/dev.env`](config/dev.env). For Docker, set these four values (for another local server, substitute its role, password, host, and port):

```dotenv
DATABASE_URL=postgres://postgres@localhost:5432/memegen
TEST_DATABASE_URL=postgres://postgres@localhost:5432/memegen_test
E2E_DATABASE_URL=postgres://postgres@localhost:5432/memegen_e2e
SNAPSHOT_TEST_DATABASE_URL=postgres://postgres@localhost:5432/memegen_snapshot_test
```

Keep the four database names distinct: test commands recreate their dedicated databases. Keep `MODE=dev` and `AUTH_MODE=dev`. Do not commit credentials or use production databases here.

Semantic template search is enabled by default and downloads a roughly **600 MB** model on first use. Set `SEARCH_ENABLED=false` to skip it; name/tag search still works. No AI provider keys are required to run the app.

## 4. Install and seed

```sh
./run.sh config/dev.env setup             # dependencies, databases, migrations
./run.sh config/dev.env library download  # pinned template originals and fonts
bunx playwright install chromium          # used to build panel templates and sample memes
./run.sh config/dev.env seed              # templates and sample community content
```

On Linux, Playwright may also require system libraries; use `bunx playwright install --with-deps chromium` if needed. Allow time for initial downloads and seeding.

The repository includes [`library/MANIFEST.json`](library/MANIFEST.json), a catalog of **1,400+ templates**; their media files are downloaded separately. `library download` retrieves the pinned upstream template originals and fonts. `seed` fetches remaining manifest media, imports templates allowed by the content filter, and creates sample community content. The default `SEED_MAX_RISK=3` imports ratings 1–3, not the entire catalog.

Re-running `seed` preserves existing imports and IDs. Source availability does not establish redistribution rights; see [library guidance](library/README.md). Local uploads are stored in `.data/storage`; downloaded template sources are under `demo/`.

## 5. Run the development server

```sh
./run.sh config/dev.env dev
```

Open **http://localhost:5173** and sign in with any username—development has no passwords. With the default sample seed, **bae** is an admin.

Bun manages workspace dependencies; the project runner launches the Node.js services and web development server together. Use the runner rather than starting each service separately.

The runner starts web (`5173`), API (`4000`), storage (`4001`), and optional search (`4002`). Keep the terminal running; press **Ctrl+C** to stop. For a subsequent session, start Postgres and run the same `dev` command—no reseed is needed.

## Common setup problems

| Symptom | Check |
|---|---|
| Database connection refused or role missing | Confirm Postgres is ready, the configured role exists, and all four URLs use the correct credentials. |
| `psql` / `createdb` not found | Install PostgreSQL client tools and add their `bin` directory to `PATH`. Docker alone does not install host tools. |
| Missing templates or fonts | Run `library download` before `seed`; keep the configured checkout path intact. |
| Seed cannot launch Chromium | Install Playwright Chromium and, on Linux, its required system libraries. |
| Port already in use | Stop the conflicting service or edit the corresponding port in `config/dev.env`. |

## Everyday commands

```sh
./run.sh config/dev.env dev        # start with hot reload
./run.sh config/dev.env migrate    # apply pending migrations after pulling changes
./run.sh config/dev.env typecheck  # import boundaries and TypeScript
./run.sh config/dev.env test       # serial tests; recreates memegen_test
```

After pulling dependency changes, run `setup` again. For reset, backups, configuration, and admin access, see the [operations reference](docs/OPERATIONS.md). **`reset` deletes the development database contents and local media** before reseeding.

## Tests

Run typecheck and unit/integration tests serially. Browser tests need **Google Chrome**, `ffmpeg`, `ffprobe`, and the fixtures below. Install Chrome with `bunx playwright install chrome` if it is missing.

```sh
./run.sh config/dev.env typecheck
./run.sh config/dev.env test
./run.sh config/dev.env e2e                       # library inspector + application
./run.sh config/dev.env e2e nav.spec.ts            # one spec
./run.sh config/dev.env e2e --project=library      # inspector only; no database or app stack
./run.sh config/dev.env e2e --project=chrome --ui  # interactive browser tests
```

The application suite uses branded Chrome for H.264/AAC export. `E2E_CHANNEL=chromium` selects Playwright Chromium instead, but its missing codec support causes the video spec to fail.

Tests use dedicated databases named `memegen_test`, `memegen_snapshot_test`, and `memegen_e2e`, and browser-test storage under `.data/e2e-storage`. These must never point at real application data. Production mode refuses test/reset commands.

The unit and full-application browser suites use the real CLIP search model, downloading it on their first run even if local app search is disabled. The library-only suite does not need PostgreSQL or CLIP.

### Create browser-test fixtures

Run once from the repository root, after step 4. These media and font files remain gitignored.

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
cp ../../demo/jacebrowning-memegen/fonts/Impact.ttf .
cp ../../demo/jacebrowning-memegen/fonts/NotoSans-Bold.ttf .
cp "../../demo/jacebrowning-memegen/fonts/SIL Open Font License.txt" OFL.txt
cd ../..
```
