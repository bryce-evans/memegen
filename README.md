# memegen

**Make memes. Share them. Host it yourself.**

A self-hosted editor and community for image, GIF, and video memes. Start with a familiar template or make something entirely your own.

[![Doge discovers memegen](docs/videos/memegen-intro.png)](https://media.githubusercontent.com/media/bryce-evans/memegen/main/docs/videos/memegen-intro.mp4)

[Download the 42-second demo](https://media.githubusercontent.com/media/bryce-evans/memegen/main/docs/videos/memegen-intro.mp4)

## Make it yours

- **Templates or your own media.** Search the template library, upload an image or video, or start with a blank canvas.
- **A full visual editor.** Add text, images, and stickers. Move, resize, and rotate layers; customize fonts, colors, and outlines.
- **Optional AI assistance.** Describe an idea in Quick Creator, then refine the result in the editor. Bring your own provider key—ordinary editing needs none.

## Beyond a single image

- **GIFs and video.** Use a frame-by-frame timeline, visibility windows, and keyframes to animate layers. Export GIF or MP4; MP4 exports preserve audio.
- **Reusable panels.** Repeat, reorder, and arrange multi-panel templates. Split a source sheet into separate images instead of being locked into its original layout.

## Your community, your instance

- **Share and discover.** Publish to public feeds, vote, comment, and save favorites. Use unlisted links for posts you want outside discovery—not for confidential storage.
- **Keep control.** Rendering happens in the browser. Host media locally or in S3, moderate posts and templates, and back up the database and media together.

## Development setup

**Requirements:** Bun **1.3+**, Node.js **24.2+**, Git, and a running PostgreSQL **14+** server. Install PostgreSQL's client tools (`psql`, `createdb`, `pg_dump`, `pg_restore`) on your machine, even if the database runs in Docker.

### 1. Pull the repository

```sh
git clone https://github.com/bryce-evans/memegen.git
cd memegen
```

The clone includes the [manifest of 1,400+ templates](library/MANIFEST.json), not their media files. The download and seed steps below fetch those assets.

### 2. Configure and initialize the database

Edit [`config/dev.env`](config/dev.env) with your local PostgreSQL connection details. Keep the application and three test databases separate; the defaults use `memegen`, `memegen_test`, `memegen_e2e`, and `memegen_snapshot_test`.

```sh
./run.sh config/dev.env setup
```

This installs dependencies with Bun, creates missing databases, and applies migrations. The database role needs permission to create databases.

### 3. Download templates and seed content

```sh
./run.sh config/dev.env library download
bunx playwright install chromium
./run.sh config/dev.env seed
```

`library download` fetches pinned template originals and fonts. `seed` downloads remaining manifest media, imports templates, and creates sample community content. Chromium builds panel templates and renders sample memes.

The default content filter imports catalog entries rated **1–3**, not the entire catalog. Initial downloads take time; optional semantic search also downloads a roughly **600 MB** model. Set `SEARCH_ENABLED=false` to use name/tag search without that download.

### 4. Run the development server

```sh
./run.sh config/dev.env dev
```

Open **http://localhost:5173**. The runner starts the web app, API, storage, and optional search service with reload. Keep it running in your terminal; **Ctrl+C** stops it. Later sessions need only Postgres and this command.

Development uses passwordless username login and must not be exposed publicly. No AI provider key is required.

**[Full setup, Docker/macOS instructions, and troubleshooting](DEV_SETUP.md)** · [Production deployment](docs/OPERATIONS.md#deployment-setup)

---

[Architecture](ARCH.md) · [Operations](docs/OPERATIONS.md) · [Template library](library/README.md)
