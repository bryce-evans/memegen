# memegen architecture

High-level system design: modules, how they connect, and the decisions that shape them. Setup and commands: [README.md](README.md). Rules for changing the repo: [AGENTS.md](AGENTS.md). Exact types live in `packages/shared`; this doc names them but does not repeat them.

## System overview

memegen is a React SPA backed by two small Node services, an optional search sidecar, and Postgres. The browser does all media work (decode, composite, encode). The servers store, validate, and index.

```mermaid
flowchart LR
  subgraph Browser
    web[apps/web] --> ui[packages/ui]
    web --> render[packages/render]
    web --> shared[packages/shared]
    render --> shared
  end
  web -- /storage --> storage[services/storage :4001]
  web -- /api --> api[services/api :4000]
  api -- provider HTTP --> ai{{AI providers: openai / gemini / anthropic}}
  storage --> pg[(Postgres)]
  api -- internal HTTP --> search[services/search :4002, optional]
  search --> pg
  search -- asset bytes --> storage
  api --> pg
  storage --> prov{{StorageProvider: local / s3}}
```

## Modules

| module | runs in | responsibility | depends on |
|---|---|---|---|
| `packages/shared` | browser + Node | Types, zod schemas, upload limits, pure layout/animation/panel logic, AI spec | — |
| `packages/render` | browser only | Decode → composite → encode for images, GIFs, video | shared |
| `packages/ui` | browser | Skinnable components and design tokens | — |
| `packages/server-kit` | Node | Config, Postgres, migrations, `AuthProvider`, HTTP helpers, asset rows, test helpers | shared |
| `services/storage` | Node | Asset upload/serve, content sniffing, probing, caps, storage providers | server-kit, shared |
| `services/api` | Node | Users, templates, memes, votes, comments, tags, stickers, stats, AI proxy | server-kit, shared |
| `services/search` | Node | Optional sidecar: CLIP embeddings of template images in a FAISS index (natural-language search, duplicate checks) | server-kit, shared |
| `apps/web` | browser | SPA: editor, template browser, gallery, profiles | ui, render, shared |
| `db/migrations` | Postgres | Append-only schema, applied in filename order | — |
| `scripts/` | Node/Bun | `run.sh` supervisor, seeds, snapshots, prod web server | all |
| `e2e/` | Playwright | Browser specs against isolated DB and ports | — |

Dependency rules:

- `packages/shared` is the single source of truth for contracts. Request bodies are `z.input` of its schemas, responses are `z.output`, so API, web, and e2e cannot drift.
- Servers never import `packages/render`. API runtime code never imports `services/storage` (tests may, as a dev dependency); shared asset-row access lives in `server-kit`.
- Nothing imports `services/search`: the API reaches it over HTTP (`services/api/src/search.ts`), and it reads asset bytes over storage's HTTP API.
- Web `pages/` import from `components/`, never from each other.

## Key decisions

### Rendering is client-side

- Servers never decode or encode frames. `packages/render` handles stills (canvas → PNG/JPEG), GIFs (`gifuct-js` → `gifenc`), and MP4/MOV (`mediabunny`/WebCodecs → H.264, audio passed through).
- Preview equals output: the editor stage, loop preview, and every export use the same `layoutText`/`drawText` (shared) and `composeFrame` (render). The stage's handles and transparency checkerboard are DOM/CSS over the canvas, so its Preview box (beside a template's title) just drops them to show the finished meme.
- Layout is stored in fractions of the media, so it is resolution-independent; text is rasterized at the size shown or exported.
- Trade-off: export speed depends on the client. A server renderer could reuse the same TS without changing the data model.
- One exception, not rendering: the search sidecar decodes template images (a GIF's first frame) to embed them. It never encodes or serves media.

### Template search is an optional sidecar

- `services/search` runs only with `SEARCH_ENABLED=true`. It loads CLIP (`Xenova/clip-vit-base-patch32` via transformers.js / ONNX Runtime, downloaded into `SEARCH_DATA_DIR` on first start) and keeps every image/GIF template's unit-length embedding in a FAISS inner-product index (cosine similarity). Videos are found by name and tags only.
- Postgres stays the source of truth: every request first syncs the index with `templates`, embedding only images it hasn't seen and adding or removing only the templates that changed (no rebuild per change). Embeddings are keyed by the asset's sha256 and cached on disk, so restarts, snapshot loads, and re-uploads cost nothing. No migration or trigger is involved.
- The index (`services/search/src/vector-index.ts`) is exact brute force up to `EXACT_LIMIT` (50k) vectors, about 2 ms a query at that size, and an HNSW graph past it. Exact stays the default because HNSW misses some true top-20 text matches even on a few hundred templates (text queries sit off the image distribution the graph is built from); image-to-image (duplicate) lookups keep full recall. Neither FAISS index deletes by key, so removals are tombstones that searches skip; the index is rebuilt from live vectors once tombstones pass a quarter of them, and when it crosses `EXACT_LIMIT`. faiss-node can't set HNSW's `efSearch`, so recall is tuned by fetching at least 64 candidates.
- Text search: the query is embedded as the mean of several captions ("a photo of a dog", …), each image's similarity to a neutral caption is subtracted (busy, text-heavy images otherwise top every query), and matches are scored by z-score across the library. The subtraction is folded into the query (`query − baseline`), and the library's mean and spread come from running first and second moments of the vectors (O(d²) per query, exact), so only the top matches are scored. A query returns nothing unless its best match reaches `TEXT_MIN_TOP_Z`, then every match from `TEXT_MIN_Z`. Thresholds are starting points in `services/search/src/catalog.ts`.
- `GET /api/templates?q=` ranks tag matches, then name matches, then image matches, each template once; an image match on a variation finds its top-level template, and visibility and filters apply to all three.
- Duplicates: `GET /api/templates/duplicates` lists templates with the same bytes (always), then image matches at cosine ≥ `DUPLICATE_MIN_SIMILARITY` (0.92: re-encodes and resizes score above, different pictures of one subject below). The Template Editor shows them before a new template is saved.
- Search is an extra: when the sidecar is off, slow, or failing, the API logs it and falls back to tags and names (text queries time out after 3 s).
- The transport is plain JSON over HTTP behind `X-Internal-Token`, like `/internal/*`; no web proxy forwards to it.

### Storage is pluggable and immutable

- `StorageProvider` (`put`/`get`/`delete`) with a registry; built-ins `local` and `s3`. Each asset row records its provider and key, so providers coexist.
- Asset content is immutable and served with Range support and immutable caching.
- Content type is sniffed from magic bytes, never trusted from the client.
- Upload caps (size, dimensions, frames per kind) default in `packages/shared/src/limits.ts`, take env overrides in `server-kit/src/config.ts`, are pre-checked by the client, and enforced by storage on every write, including rendered outputs. Probing is pure JS (no server ffmpeg).

### Derived data lives in the database

Triggers keep derived state consistent across every write path (API, seeds, snapshot restore): template `kind`, default owners, vote tallies, usage logs (`template_uses`, `sticker_uses`), and hierarchy/reply-depth limits. Views handle tag inheritance. Consequence: snapshots are `pg_dump`s, not row replays.

### Access rules are defined once

- Visibility rules (listed, visible, openable) live in `services/api/src/rows.ts`, with the JS form `isListed` in shared.
- Auth goes only through `AuthProvider` (`server-kit/src/auth.ts`), installed per service via `installAuth`; routes read `c.get("user")`. The current `HeaderAuthProvider` (`X-User-Id`) is a placeholder and **not secure**; a real provider replaces it without touching routes.
- Internal-only data (e.g. `negativeHScore`) is served under `/internal/*` behind `X-Internal-Token`, which no web proxy forwards.

### AI is a stateless proxy

- The API forwards requests to the user's chosen provider with the user's own key (`X-AI-Key`) and stores nothing. Kept results re-enter as ordinary uploads, so caps, sniffing, and the template flow are unchanged.
- Providers are adapters in `services/api/src/ai/` behind `AiProvider` (text edits) and `AiImageProvider` (image edits), selected via a registry.
- Text edits use a versioned spec (`AI_EDIT_SPEC` in `packages/shared/src/ai.ts`): the model returns a list of actions (`UPDATE_IMAGE`, `ADD_TEXT`), which the server normalizes and the browser applies.
- Provider errors map to 422/429/502, never 401 (which the client treats as its own session ending).
- Provider keys and settings stay in the browser (`localStorage`).

### UI is skinnable

- All web UI is built from `@memegen/ui`; app CSS is layout-only and reads tokens.
- A skin is token overrides plus optional component replacements and layout hints. Only one arrangement renders at a time, so test ids stay unique. See `packages/ui/README.md`.
- Dark mode is a per-skin variant (`Skin.dark`), not a second token set: the app keeps the choice per user in `localStorage` and turns it on through `SkinProvider`, which sets `data-theme="dark"` on `<html>` for skins that have one. Today only `painted` does; skins without a variant ignore it, and the profile's Settings tab hides its control.
- Card layout is the other Settings choice, kept the same way (`cardLayout.ts`): meme feed cards show their title, author, age, and actions over the image on hover (default, on a scrim) or, below the image (Google-style), the title with the votes at the right of its line and any badges under it (no author, age, favorite star, or comment count). `MemeGrid` sets `data-card-layout` on the grid; the justified-row math is unchanged because only the image sizes the card's width. In both, the whole card opens the meme (clicks on its own controls and links excepted) and hovering it shows a rounded `--ui-color-card-hover` highlight.
- Template gallery cards show the title with usage count and flame on its right, without attribution or a Use button. The whole card selects the template and gets the same rounded hover highlight as meme cards; title and media remain keyboard-accessible links. Own-profile cards retain Edit and private badges; the editor's template details retain attribution.
- Backspace, Delete, and Escape go back a page (`backHotkeys.ts`, one document listener in `Root`). They yield to text fields, open `<dialog>`s and dropdowns, and any modifier (⌘⌫ removes an editor layer), and do nothing on the visit's first entry (React Router's `history.state.idx` is 0), so they never leave the site. A screen can register a confirmation with `useBackGuard`; the editor's `SavePanel` does while the meme is new or the user's own unpublished draft. It uses `window.confirm`, like the app's other confirmations, and guards only the hotkeys, not the browser's Back button.
- Post detail uses one content column capped at 940px of usable width (sheet padding is additional), with reduced top padding and a compact title: metadata and title alongside sharing/download actions, media, votes alongside the template-create link, comments, then owner-only controls. Media fills the available width and uses `object-fit: contain` within a 680px height cap, preserving the whole image even for tall aspect ratios. This fixed cap replaces viewport-relative sizing; shorter viewports may scroll. The two action rows wrap on narrow screens; the owner panel never renders for other viewers. The painted header is 56px tall with a 120px brand slot aligned to the shell's left column. The wordmark uses `scale(1.75)` from its left center, without translation, with 0.1em vertical padding to fit the available height. Search stays vertically centered with about 8px clearance on each side; the bar has 3px vertical padding and balanced desktop side columns that reserve room for the logo.
- Post typography uses shared UI role tokens: `--ui-font-size-post-meta` is 8pt for author/date and tag chips; `--ui-font-size-post-title` is the skin's XL size plus 2pt. Post tag pills use `--ui-color-text-muted` for lower-contrast gray labels. Feed card typography is unchanged.
- Above 760px the shell uses equal left/right rails around a viewport-centered content column capped at 940px plus sheet padding. Rails reserve at least 180px for navigation. Above 960px editor pages instead reserve at least 448px for the right controls rail and 180px for the left rail, using CSS subgrid to place the workspace and controls. Rails balance on wide viewports; otherwise the workspace shifts left so the Text, Image, Sticker, and Top section controls fit on one row without squeezing the workspace unnecessarily. Editor controls stack below the workspace at 960px and below, where toolbar controls may wrap to fit; navigation retains its mobile arrangement at 760px and below.
- The desktop navigation sidebar itself is capped at 220px, independently of the flexible left rail. Extra rail space stays empty so a wide viewport does not stretch navigation or shift the centered content.
- Popular, Recent, search results, and tag galleries span the center and unused right rail above 760px, keeping the left navigation and center's starting position unchanged. Post detail retains its centered width cap; editor workspace/control placement is unchanged.
- Painted desktop navigation uses the same leading inset (`--ui-space-5`) as Create's plus icon for menu icons and section headings. Header wordmark padding divides that inset by its 1.75 scale so the visible lettering, rather than only its transformed box, aligns with the navigation.

### Migrations are the schema version

Migrations are append-only and never edited once applied. Snapshots record their applied migrations; loading restores the snapshot schema, then migrates forward.

## Data model

```mermaid
erDiagram
  users ||--o{ assets : owns
  users ||--o{ templates : owns
  templates ||--o{ templates : "variations (one level)"
  templates ||--o{ template_pack_assets : "multi-panel pack"
  templates ||--o{ memes : "made from"
  users ||--o{ memes : owns
  memes ||--o{ votes : ""
  memes ||--o{ favorites : ""
  memes ||--o{ comments : "replies one level"
  tags }o--o{ templates : template_tags
  tags }o--o{ memes : meme_tags
  stickers }o--|| assets : ""
```

- **Asset**: stored bytes (`image | gif | video | font`). All media, fonts, outputs, and stickers are assets.
- **Template**: base media plus default layers. `kind` is `single`, `gif` (GIF or video), or `multi` (an image pack laid out as panels). New media enters the system only as a template. Built-ins belong to the reserved `memegen` user.
- **Meme**: always made from a template; stores its own layers (or panels), source, and rendered output asset, so it can be re-edited. New memes and title edits need a non-blank title (`createMemeSchema`/`updateMemeSchema`); the editor and Quick Creator start it empty and require the user to enter it before saving or publishing, never deriving it from the template name. Memes saved before that may still be untitled and show as "Untitled". Saved = row exists; posted = `posted_at` set; listed = posted and public.
- **Layer**: discriminated union `text | image` sharing placement, opacity, a visibility window, and keyframes. Animation rules are pure functions in `packages/shared/src/animation.ts`.
- **Tag**: `topic | team`; memes inherit their template's tags, variations roll up to the parent.
- **Votes/stats**: one ±1 vote per user per meme; user stats and leaderboard share one SQL definition; badges are computed client-side from public stats. Each badge is one stat's tier (`BadgeDef.stat`, `.tier`, via `badgeFor`): a star in the tier's color (`--ui-color-tier-*`) follows that stat's figure everywhere (leaderboard, user search, profile), and profile stat tiles take the tier's color as their outline. The leaderboard's stat column headings are its sort buttons; `LEADERBOARD_SORTS` is in column order.

## Interfaces

All JSON unless noted. Errors: `{ error: string, details?: string[] }`. Shapes are the types in `packages/shared`.

### storage (`:4001`, web proxy `/storage`)

| route | purpose |
|---|---|
| `GET /health` | liveness |
| `GET /limits` | `UploadLimits` |
| `GET /providers` | default and available providers |
| `POST /assets` | multipart upload → `Asset`; 413/422 with cap violations |
| `GET /assets`, `GET /assets/:id` | list (by `kind`) / fetch `Asset` |
| `GET /assets/:id/content` | bytes, Range supported |
| `DELETE /assets/:id` | owner or internal token; 409 if referenced |

### api (`:4000`, web proxy `/api`)

| area | routes |
|---|---|
| health | `GET /health` |
| session/me | `POST /api/session`, `GET /api/me`, `GET /api/me/activity`, `GET /api/me/favorites` |
| users | `GET /api/users`, `GET /api/users/:username`, `GET /api/users/:username/memes`, `GET /api/users/:username/templates`, `GET /api/leaderboard` |
| templates | `GET/POST /api/templates` (`q` searches tags, names, then images), `GET /api/templates/count`, `GET /api/templates/hot`, `GET /api/templates/duplicates`, `GET/PATCH/DELETE /api/templates/:id`, `GET /api/templates/:id/usage`, `POST /api/templates/:id/tags` |
| memes | `POST /api/memes`, `GET/PATCH/DELETE /api/memes/:id`, `POST /api/memes/:id/post`, `PUT /api/memes/:id/vote`, `PUT /api/memes/:id/favorite` |
| comments | `GET/POST /api/memes/:id/comments`, `DELETE /api/comments/:id` |
| gallery | `GET /api/gallery` (period, sort, tag, search) |
| tags | `GET/POST /api/tags`, `GET /api/tags/:slug` |
| stickers | `GET/POST /api/stickers` |
| AI | `POST /api/ai/edit` (spec actions), `POST /api/ai/images` (image bytes); multipart, `X-AI-Key`, nothing stored |
| internal | `GET /internal/users/:username/stats` (`X-Internal-Token`) |

API layout: `app.ts` wires auth and errors; each `routes/*.ts` exports a `register(app, …)`; shared guards in `access.ts`; row mapping and visibility in `rows.ts`.

### search (`:4002`, optional, API only)

| route | purpose |
|---|---|
| `GET /health` | liveness and indexed template count |
| `POST /search` | `{ q, limit }` → `SearchHits` (z-scores), `X-Internal-Token` |
| `POST /similar` | `{ assetId, limit }` → `SearchHits` (cosine), `X-Internal-Token` |

## Runtime and config

- Node ≥ 24.2 runs server `.ts` via type stripping; Hono for HTTP; `postgres` (porsager) for SQL. Bun installs and runs scripts; Vite builds the web app.
- `run.sh <config> <command>` is the single entry point; configs are literal `KEY=value` files.
- `scripts/run.ts` supervises migrate → storage → API → (search, when `SEARCH_ENABLED=true`) → web. The process list (`scripts/services.ts`) is shared with Playwright.
- In prod, `scripts/serve-web.ts` serves the SPA and proxies `/api` and `/storage` (never `/internal`).
- `MODE` is baked into the web build; anything other than `dev` builds as prod. `MODE=prod` refuses destructive and dev-only commands and requires real secrets.
- `INTRO` (`basic` | `party` | `nyan`, default `basic`) is baked into the web build the same way and picks the sign-in page's intro; `vite.config.ts` fails the build on any other value. In dev, the sign-in page's dev tools preview the others (kept in `localStorage`, ignored in prod, like skins). Nyan cat is two images, the cat alone and one repeatable wave of rainbow: the rainbow is fixed in place and revealed behind the cat as it flies, so it can run any length and never slides.

## Data sets and snapshots

- One zip format (`scripts/snapshot.ts`) serves prod backups, the dev sample, and starter content: a manifest, a `pg_dump`, and asset bytes.
- Saves are read-only and consistent (one `repeatable read` transaction). Loads target a clean system, verify everything first, then restore and migrate.
- Datasets are committed as code, not dumps: mock (e2e), sample (dev), starter (shipped). Their memes are rendered at seed time by `@memegen/render` in headless Chromium.
- `library/` owns the built-in corpus: `MANIFEST.json`, `REGISTRY_POLICY.json`, schema/layer conversion, registry reconciliation, seed importers, prerequisite downloader, and gallery. One manifest holds canonical `online/` and `jb/` roots with required integer `risk` (1–5), nonempty `rating_tags`, HTTPS media URLs, provenance, search tags, normalized geometry, and default captions. Rating reason tags are 1–12 unique lowercase kebab-case strings, each 1–40 characters. Policy contains terminal duplicate targets and rated aliases, not a second checkout score table. Every duplicate must target an existing builtin canonical and retired slugs cannot remain in the catalog. Unknown checkout folders fail closed.
- Editorial guidelines: 1 very safe/child-appropriate, 2 mild themes, 3 politics/smoking/drugs, 4 bad language/strong themes, 5 explicit sex/nudity/gore or very inappropriate content. Specific template decisions override category defaults; reason tags describe content rather than enforcing an automatic score. Work settings include 1–3 and exclude 4–5. Review considers original images, embedded language, titles/aliases, captions and source context; unresolved context uses `review-needed`, not an assertion of explicit imagery. Removing a catalog entry does not delete existing records/media.
- Uncensored F-word content has a minimum risk of 4 and a `language` reason. Explicit exceptions allow Jackie Chan WTF and Picard Wtf at 2, FFFFUUUU Rage Guy at 3, and the display-masked I F**** Love X at 2. Display tags are masked where needed; stable IDs and source URLs are preserved. The metadata regression check permits the two reviewed WTF abbreviations but still rejects uncensored profanity at low scores. Other reason tags, including nudity/gore on explicitly reviewed rating-3 templates, remain descriptive rather than overriding the numeric work cutoff. Remote embedded text remains an editorial image-review responsibility.
- Manifest layouts compile to ordinary shared text layers, including the native top-section layer; no editor/API contract or alternate rendering path is introduced. Source text boxes preserve per-box font/color/alignment/rotation overrides, including `thin` (Titillium Web SemiBold) and `comic` (Kalam). Fractional `start`/`end` bounds become seconds after GIF duration is known; still captions remain unbounded. Imported boxes extending beyond image bounds are minimally repositioned to meet the manifest invariant. Existing database defaults are never rewritten. Assets dedupe by hash against builtin roots; aliases become searchable tags, not duplicate cards. Stable slugs/identity tags let reruns skip completed imports before fetching. Failed imports exit unsuccessfully while successful imports remain resumable.
- Movie subtitle defaults use pale cream-yellow (`#f5f2a6`) Noto Sans with a thin black outline and original casing. Catalog dialogue sizes are approximately 7% of each panel's height, stored as image-relative font sizes rather than inferred at render time. Explicit white captions and Impact headings retain their source styling.
- `seed` runs `library/seed-checkout.ts` for local fonts/templates/variations, then `library/seed.ts` for the unified manifest, then sample/starter content. New checkout roots use manifest metadata and defaults; variants retain checkout config behavior. `SEED_TEMPLATE_MANIFEST` replaces or disables the manifest import independently of the checkout import. `jb/` canonicals are available through either importer. `SEED_MAX_RISK` strictly accepts 1–5 and defaults to 3; custom manifests cannot lower reviewed canonical or retired-alias risks. Both importers reconcile roots and children before/after imports, independent of `--limit`: over-ceiling and retired duplicates become private; allowed canonicals become public and receive catalog tags. Higher-risk aliases cannot annotate lower-risk canonicals; cleanup only affects seed-owned associations. Existing IDs/assets/defaults/variants/saved memes remain intact. Sample/starter rendering prefers an existing original root and resolves missing retired roots to their canonical.
- The catalog consolidates the 210 media-bearing checkout roots with the online sources, preserving `oldschool`, source keywords, and persisted seed tags on canonicals or rated aliases. The media-less `_test` fixture is excluded. `library/download.ts` stages a Git checkout pinned to the same upstream revision as catalog media URLs, verifies fonts/templates, then installs it without replacing existing data; an existing complete checkout is reused without claiming its revision matches. Media/fonts stay outside the repository in the configured checkout/storage. Catalog assembly compares aliases and source images; distinct drawings, reactions, and panel counts remain separate. This is editorial deduplication, not another runtime search dependency.
- Search-tag curation covers every catalog entry with at least four distinct normalized tags, targeting six to eight or more useful descriptors. Subjects, reactions, cartoon style, known source works/characters, and political context belong in searchable `tags`, independently of `rating_tags`; source context is not inferred solely from rating reasons. The manifest regression check enforces minimum coverage and normalized uniqueness. Retired pipe-man variants resolve to Greedy Pipe Man (`online/6fesx7`); both old names remain searchable and policy reconciliation hides their former roots without deleting saved content.
- `library/index.html` is a read-only inspector outside the SPA. Local JSON selection and original-image browsing work under `file://`; HTTP hosting fetches neighboring `MANIFEST.json` with `cache: "no-store"`. `library serve` exposes only the gallery, manifest, policy, an in-memory browser bundle, and four fixed font routes from the configured checkout. Each card has an unchecked placeholder toggle instead of a caption list. `library/preview.ts` uses `manifestLayers`, `composedSize`, and `composeFrame` (shared `layoutText`/`drawText`) after loading the actual fonts; comment bands, casing, outlines, rotations, and placements match native rendering. Stills draw from the loaded image without a CORS fetch or readback; GIFs decode and animate in the browser with native caption windows. Unchecking or removing a card cancels pending work and releases its canvas/frames. Missing fonts/media leave the original available with an explicit error, never a fallback-font preview. The server only bundles code and serves bytes; it does not decode or render media.
- Gallery tag facets come from the entire loaded manifest, independent of current matches. A rating-tag dropdown and searchable template-tag datalist apply exact membership filters in conjunction with score/layout/text search; template-tag matching ignores case and surrounding whitespace. Reloads retain valid selected tags and clear missing ones, rebuilding suggestions from the new manifest. Tag filtering does not change the existing score control or Work-view default.

## Testing

- `node --test`: shared logic and service behavior via `app.request()` against a fresh `memegen_test`.
- Playwright: real servers on separate ports against a fresh `memegen_e2e`, in branded Chrome (needed for H.264 in WebCodecs). AI calls hit a local stub (`startAiStub`). The search sidecar runs for real, with the model and embedding cache shared with dev.
- Search: API tests inject a `TemplateSearch` to pin ranking, visibility, and duplicate merging; sidecar tests run the real CLIP model against the test database.
