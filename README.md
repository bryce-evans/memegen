# memegen

A self-hosted meme generator with a public gallery. Pick a template (or bring your own image, GIF, or video), place and animate text, then save, post, and vote.

## Features

- **Templates**: the checked-in [library](library/README.md) contains 1,464 canonical formats in one [manifest](library/MANIFEST.json), including the existing checkout seed templates, with 1–5 content-risk scores, search tags, and default captions. Work settings include ratings 1–3 and exclude 4–5. Defaults include outlined Impact macros, added sans-serif comment bands, movie subtitles, and positioned character/panel labels. Search by tag, name, or what's in the picture ("dog" finds doge), filter by kind, see what's hot, and check each template's usage chart. Uploading an image that's already a template (the same file, or a copy of the picture) lists the existing ones before you save.
  Template cards open directly when selected, with usage count and flame beside the title and a rounded hover highlight.
- **Editor**: text boxes that wrap and shrink to fit (drag their corners to resize, the handle above to rotate; ⌘⌫ in a box's text removes it), custom fonts, image layers (upload or paste a screenshot), and a shared sticker library.
- **Animation**: for GIFs and videos, a frame-by-frame timeline with per-layer visibility windows, keyframes, and a live loop preview. Exports are GIF or MP4, and MP4s keep their audio.
- **Caption memes**: a top-section toggle adds a white band with its own text above the media.
- **Multi-panel templates**: expanding brain and similar formats, built from an image pack. Memes can add, remove, and reorder panels.
- **Quick Creator**: at the top of Create, a template (a random one to start) drawn with its text, and one Describe field (each text box's text shown as its placeholder). Your Agent Provider rewrites the template's text boxes (text and font) and adds, rewrites, or removes the top section; your Image Generator makes any described change to the image (the result becomes a new template). Publish posts the result straight away; Full editor (or clicking the image) opens it in the editor to finish by hand (no agent needed). Box positions and timing never change. The Agent Provider is OpenAI, Google Gemini, or Anthropic Claude; the Image Generator is OpenAI or Google Gemini. Each uses your own API key and an optional model (set up under your profile's API Keys tab). Below it, an Upload card adds a template, multi-panel template, or sticker.
- **Gallery**: Popular (day, week, month, year, or all time) and Recent feeds, voting, threaded comments, favorites, search (posts, templates, or users), and tag pages. Feed cards open their meme when clicked anywhere and show its info over it on hover or, set under your profile's Settings tab, its title and votes below it (Google-style).
- **Keyboard**: Backspace, Delete, or Escape goes back a page (outside text fields). Leaving the editor this way with an unpublished meme asks first.
- **Profiles and leaderboard**: a Profile tab with h-score, high score, and tiered stats (bronze to diamond: tile outlines and stars); the user's memes and templates; and, on your own profile, API Keys (Agent Provider and Image Generator) plus private Favorites and Recent activity tabs. Leaderboard tier stars are enlarged and vertically centered beside their numbers.
- **Skins**: seven interchangeable looks from `packages/ui` (dev only. Prod is locked to `default`). `painted` has a dark mode, set per user under your profile's Settings tab and kept in your browser.
- **Header and columns**: the painted skin uses a 56px header with about 8px of clearance above and below search. Its 120px brand slot is aligned to the left column; reduced wordmark padding allows a 1.75× logo to fill the bar without clipping. Main content is centered in the viewport; navigation occupies up to 220px in the left rail and editor controls occupy the right rail, stacking on narrow screens.
  On desktop, the visible wordmark, Create's plus icon, and navigation icons share the same left inset.
  Desktop galleries (Popular, Recent, search results, and tags) extend through the unused right rail to show more images; individual posts stay compact and centered.
  The desktop editor reserves a wider controls rail so Text, Image, Sticker, and Top section fit on one line; controls still stack below the workspace on narrow screens.
- **Snapshots**: back up or restore the whole site (database and media) as one zip.
- **Meme titles**: enter a title before saving or publishing in the editor or Quick Creator. Titles start empty; template names are never used as defaults.
- **Post view**: a single column with author, posting date, and compact tag pills above the title, and Share/Download to the right. The media follows, then voting with “Make one with this template” to the right, comments, and the owner's “Only visible to you” controls at the bottom. Action rows wrap on narrow screens. Overflowing tags end in an ellipsis. Upvote, score, and downvote share one pill, with circular highlights when hovering over either thumb. Change tags through the owner's Edit button. Comment and reply composers start at one line and size to their text, with a handle for manual vertical resizing. Focusing the input reveals Cancel and submit buttons inside the border; Cancel clears the draft and restores the collapsed one-line composer.

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
- `INTRO`: the sign-in page's intro, baked into the web build. `basic` (default) shows the card alone; `party` explodes memes, confetti, and streamers out from behind it; `nyan` flies nyan cat in a straight line from the bottom right, behind the card, and out of its top-left corner, leaving its rainbow behind.
- `OPENAI_IMAGE_MODEL` (default `gpt-image-2`), `GEMINI_IMAGE_MODEL` (default `gemini-nano-banana-2.1`): default models for the Image Generator. `OPENAI_TEXT_MODEL` (default `gpt-5-mini`), `GEMINI_TEXT_MODEL` (default `gemini-2.5-flash`), `ANTHROPIC_TEXT_MODEL` (default `claude-haiku-5-5`): default models for the Agent Provider. Users may name their own models instead. Users bring their own API keys, so the server needs none. `OPENAI_BASE_URL`/`GEMINI_BASE_URL`/`ANTHROPIC_BASE_URL` point at a proxy or gateway.
- `SEARCH_ENABLED`: `true` runs the template search sidecar on `SEARCH_PORT` (default 4002): CLIP image embeddings in a FAISS index, so template search also matches what's in the picture and new uploads are checked for duplicates. `false` searches tags and names only, and only byte-identical duplicates are caught. The first start downloads the model (about 600 MB) into `SEARCH_DATA_DIR` (default `.data/search`), which also caches the embeddings. `SEARCH_MODEL` picks another transformers.js CLIP export; `SEARCH_URL` points the API at a sidecar on another host.

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
| `SEED_TEMPLATES_FROM` | fonts and local templates/variations from a [jacebrowning/memegen](https://github.com/jacebrowning/memegen) checkout. `library download` prepares this directory. Root metadata/defaults come from the unified manifest; unknown and retired folders are skipped. |
| `SEED_TEMPLATE_MANIFEST` | rated still/GIF templates and text placements from `library/MANIFEST.json` by default; set to an empty value to disable the manifest importer, or another rated manifest path to replace its selection. The checkout importer remains independently configurable. Media are stored locally, not hotlinked in the app. |
| `SEED_MAX_RISK` | integer 1–5, default **3**. Imports only entries at or below the ceiling; reseeding hides previously imported built-ins above it. Use 3 for work settings (ratings 4–5 excluded), 1 for the most conservative selection, or 5 to include every rating. |
| `SEED_SAMPLE=true` | the dev sample site: twelve users (`dana`, `eli`, …) with about 20 memes, votes, comments, and favorites. Needs the templates. *(dev only)* |
| `SEED_STICKERS_FROM` | every PNG (≤ 512×512) in that folder becomes a built-in sticker *(dev only)* |
| `SEED_STARTER=true` | a few work-appropriate example memes posted by `memegen` |

To start over: `./run.sh config/dev.env reset`.

The unified manifest records each template's stable `online/` or `jb/` slug, title, full-size HTTPS media URL, source page, search tags, required integer `risk` (1–5), required `rating_tags` explaining the classification, layout, and default text boxes. Reason tags are nonempty, unique lowercase keywords such as `language`, `sex`, `nudity`, `gore`, `politics`, `smoking`, `drugs`, `innuendo`, and `weapon`; they are separate from search tags. Box centers and sizes are fractions of image dimensions, with optional font, color, outline, alignment, and rotation overrides. `impact` uses outlined Impact; `comment` adds a white band with sans-serif text; `subtitle` uses pale cream-yellow sans-serif with a thin black outline and dialogue sized to each panel; `labels` uses individually positioned white sans-serif boxes. Per-box fonts include Impact, Noto Sans (`sans`), Titillium Web SemiBold (`thin`), and Kalam (`comic`). Optional `start`/`end` are fractions of GIF duration, converted to native caption windows at import.

Generic caption placeholders are replaced with short, clean example jokes tailored to the reaction, embedded quote, or panel sequence. Positioned labels name the participants in the joke. Clean captions do not automatically lower a rating; imagery, embedded language, titles, and source context still matter.

Preserve these curated captions when updating ratings, sources, or catalog membership; metadata refreshes should not restore generic setup/punchline text or numbered labels.

Every catalog template has at least four distinct searchable tags, targeting six to eight or more where useful. Tags describe subjects, reactions, known movies/shows/characters, cartoon imagery, and political context independently of rating reasons. Greedy Pipe Man is the canonical copy of the BAYSAL cartoon; “fat man drinking from pipe” and “Guy Who Have Lot A Water” remain searchable aliases.

For a read-only preview without seeding, run `./run.sh config/dev.env library serve` and open http://127.0.0.1:8088/. Each card's **Show placeholder text** checkbox renders default captions directly on its image using the editor's fonts, styling, placement, and comment bands; uncheck it to restore the original. Captions remain searchable but are not listed below cards. Fonts come from `library download`. The default Work view includes ratings 1–3; select an exact rating or All ratings to review the rest. Remote previews load lazily without saving assets; disable them to browse metadata only. Opening [`library/index.html`](library/index.html) directly also supports local-manifest and original-image browsing, but rendered captions require the server. No app/database startup is needed. See [library commands and corpus maintenance](library/README.md).

Use **Rating tag** to inspect an exact reason such as `language`, `violence`, or `smoking`. **Template tag** offers searchable suggestions from the loaded manifest and matches an exact tag, ignoring case and surrounding spaces. Both tag filters combine with the existing score, layout, and text filters. Clear the template-tag field or select All rating tags to remove that restriction. Reloading keeps valid tag selections; opening a manifest without the selected tags clears them.

HTTP manifest requests bypass the browser cache: refresh the page or click Reload MANIFEST.json to read the current JSON from the server. No gallery rebuild or database reseed is needed.

Rating guidelines: **1** very safe / child-appropriate; **2** general audience, mild language or innuendo; **3** politics, smoking, drugs, or other mature themes; **4** bad language, strong suggestiveness, or realistic violence; **5** very inappropriate, explicit sex, nudity, or gore. Work settings admit 1–3 as potentially appropriate, not a guarantee for every workplace. Specific editorial decisions override broad guidelines: Ben affleck smoking is 2 (`smoking`), Dat Boi is 3 (`language`), and Cat Sniper Scope is 4 (`violence`). Cartoon style alone does not excuse explicit content, nor does a weapon automatically imply violence.

Uncensored F-word content requires a rating of at least 4 with `language`, and is excluded from work settings. Editorial exceptions permit Jackie Chan WTF and Picard Wtf at 2, FFFFUUUU Rage Guy at 3, and the renamed `I F**** Love X` at 2. The renamed template's display tag and Picard's explicit phrase tag are masked too; stable identifiers and provenance URLs remain unchanged. Other censored spellings and abbreviations retain the conservative rule. Metadata is regression-checked; embedded image text requires image review.

Reviewed score overrides do not erase descriptive reason tags: Doctor Manhattan It Is 1985 and Dead Baby Voldemort / What Happened To Him are rated 3 while retaining their `nudity` and `gore` reasons respectively. Work view follows the numeric score, not a blanket ban on particular reason tags.

Barbie vs Oppenheimer, Bernie Sanders In a Chair, and Bernie I Am Once Again Asking For Your Support are rated 2. Cigar Cougar is rated 4 with both `smoking` and `disturbing`.

Illusion of free choice is rated 1 with `cartoon`, not `politics`. I See Dead People is rated 2, retaining `death` and `horror`. Here it comes is rated 2 with `general-audience`, not `violence`. Greedy Pipe Man and its aliases (including Guy Who Have Lot A Water) are rated 2, retaining their descriptive political context.

Feels Good, Insanity Wolf, I'm Going to Build My Own Theme Park, What's in the box!?, What the Hell is This?, and Vince McMahon Reaction are rated 2. Oh, I'm Sorry, I Thought This Was America; death knocking at the door; Rage Guy (FFFUUU); Say That Again I Dare You; and Hawk Tuah Girl are rated 3. 5 black guys and blonde is rated 5. These score overrides preserve existing reason tags, captions, and source metadata.

Ratings are an editorial review of metadata and selected source images, not an exhaustive visual certification. `review-needed` marks unresolved context. Ordinary identity or affection alone is not a risk reason. Bench Press Fail, Blonde Woman Looking at the Camera, and 2 gay black mens kissing are removed from the catalog. Gallery changes take effect on reload; removing catalog entries does not delete previously imported database records or media.

`library/REGISTRY_POLICY.json` records terminal canonical targets and rated aliases for 243 retired duplicate slugs; there is no separate checkout rating list. All 210 media-bearing checkout roots are represented: 201 canonical entries and nine aliases to existing canonical images. The media-less `_test` fixture is excluded. Existing `oldschool` tags, source keywords, and persisted seed tags are preserved on canonical entries or their rated aliases. Eight additional online duplicates were consolidated into checkout canonicals. Genuinely different drawings, reactions, and panel arrangements remain separate.

The first import needs network access and the Impact/Noto Sans font assets; checkout captions also use Titillium Web SemiBold and Kalam. `library download` supplies the checkout and all six fonts used by the local importer. Successful imports are retained if another image fails; the command reports failures and exits unsuccessfully, and rerunning resumes without downloading completed entries. Rerun `./run.sh config/dev.env seed` to apply catalog tags and the risk ceiling to an existing development database; a reset is not needed. Both importers reconcile managed built-ins before and after importing, even with `--limit 0`: over-ceiling and retired duplicate cards become private, while allowed canonical cards become public. Higher-risk aliases never annotate a lower-risk canonical. Existing template IDs, image bytes, saved layouts, memes, and user-owned templates are retained, and saved memes remain editable. This curates the built-in template browser; it does not moderate or remove existing posts.

Image URLs were checked when the manifest was assembled, but external hosts can remove them. Checkout media URLs are pinned to the same upstream Git revision as the downloader; the registry is not a live scrape during startup. To add a format, review the image, source context, aliases, and default captions; add it to `library/MANIFEST.json` with its risk score, reason tags, and verified text geometry, update duplicate mappings where relevant, then run `seed`. Adjust `SEED_MAX_RISK` in the chosen config and reseed to change the imported selection; custom manifests must supply ratings and obey the same ceiling. Public availability is not a license: source links record provenance, not redistribution permission. Review rights for your deployment; snapshots include imported image bytes.

Discovery sources include [Imgflip's popular catalog](https://imgflip.com/memetemplates?sort=top-all-time), [Know Your Meme's templates](https://knowyourmeme.com/photos/templates), [Meming Wiki's blank-image catalog](https://en.meming.world/wiki/Category:Images), [MagicMeme's still-template catalog](https://magicmeme.com/meme-templates), and [MemesGuy's current](https://memesguy.com/year/2026) and [historical timelines](https://memesguy.com/year/2025). The rated registry and reviewed duplicate mappings curate the previous 1,500-entry online selection together with checkout formats. Prior-year MemesGuy archives span 1996–2025; culture-only listings and examples without a reusable template image were excluded.

Source-backed year and character/actor tags improve discovery of older formats. “Why Would I Deceive You” also matches `Elizabeth Holmes`, `Theranos`, and the common misspelling `decieve`. Recent selections include Surprised/Shocked Katie Britt, Odysseus Screaming (Matt Damon yelling), Jimothy, Sleepy Jerry, and Punch the Monkey, searchable with `recent memes` and `2026 memes`. The catalog remains a checked-in selection, not an automatically refreshing feed. Counts refer to manifest entries; seeding reuses byte-identical built-ins rather than adding duplicate gallery cards.

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

The unit tests and the e2e suite run the search sidecar's real CLIP model, so their first run downloads it into `.data/search` (shared with `dev`).

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
