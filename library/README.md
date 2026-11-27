# Meme library

This directory owns the corpus of known templates: canonical images/GIFs, searchable tags, ratings, default text and placement, duplicate identities, preview, and seed import.

## Files

| File | Responsibility |
|---|---|
| `MANIFEST.json` | 1,452 canonical templates, provenance/media URLs, tags, ratings, default captions/layouts, and panel crop recipes |
| `REGISTRY_POLICY.json` | 263 retired identities, terminal canonical redirects, and rated search aliases |
| `index.html` | Standalone searchable gallery with risk and tag filters |
| `preview.ts` | Browser-only default-caption composition using the editor's shared renderer |
| `manifest.ts` | Manifest validation and conversion to native editor layers or panel sets |
| `fonts.ts` | Browser-safe identities for six checkout fonts and four caption roles |
| `registry.ts` | Risk selection, alias tags, duplicate visibility, and reseed reconciliation |
| `download.ts` | Non-destructive download of the pinned checkout/font prerequisites |
| `seed.ts` | Single import command: arguments/config, migration, SQL lifetime, pre/final reconciliation |
| `import-checkout.ts` | Local font/media import, catalog root defaults, and checkout variations |
| `import-manifest.ts` | Manifest media download, byte-deduplication, and resumable import |
| `import-panels.ts` | Browser lifecycle and atomic native panel-pack import |
| `panel-images.ts`, `render-panels-page.ts` | Shared browser cropping and native panel-cover export |
| `duplicates.ts` | Read-only CLIP indexing and near-duplicate audit of seeded templates |
| `serve.ts` | Development-only loopback gallery server |

The 210 existing media-bearing checkout templates are represented by 197 `jb/` canonicals and 13 aliases to online canonicals. `oldschool`, source keywords, and existing seed tags are retained on canonical entries or their rated aliases. The media-less `_test` fixture is excluded. Retired checkout and online identities resolve directly to canonical entries; CLIP similarity alone never authorizes retirement.

## Browse without seeding

Run from the repository root:

```sh
./run.sh config/dev.env library serve
```

Open **http://127.0.0.1:8088/**. Use `--port 8090` to choose another port. The server exposes the gallery, the two JSON files, an in-memory browser preview bundle, and four fixed font routes, with caching disabled; it does not expose config files or mutate a database. `Ctrl-C` stops it.

The default Work view includes ratings 1–3; choose an exact rating or All ratings to review the rest. Remote images load lazily without saving assets and can be disabled for metadata-only browsing. **Rating tag** matches an exact reason; **Template tag** offers suggestions from the entire loaded manifest and matches exact membership ignoring case and surrounding whitespace. These combine with score, layout, and text filters. Reload preserves valid selected tags and clears missing ones. HTTP manifest requests bypass cache; reload the page or choose Reload MANIFEST.json after edits.

Each card has an unchecked **Show placeholder text** checkbox. Check it to render the default words directly on that image with the editor's fonts, outline, casing, rotation, and placement; comment layouts add their native white top band. GIF previews animate with their caption timing. Panel recipes crop the source sheet and compose its native editable panel layout. Unchecking restores the original image. Captions remain searchable; panel cards expose crop coordinates and captions in expandable recipe details. Choose the **panels** layout filter to inspect those recipes. The checkbox is disabled when remote image previews are off.

Media caption rendering needs installed dependencies and the fonts from `library download`; missing fonts show an error instead of silently substituting another font. Native panel captions use the panel renderer's typography without those font files. `library serve` bundles the existing browser renderer at startup without writing generated files. Restart it after changing preview code; manifest edits only require a page reload.

Alternatively, open `library/index.html` directly and select the neighboring `MANIFEST.json` for metadata and original-image browsing; rendered captions require the local server. Choose **All ratings** and the **oldschool** template tag to browse all 210 seed formats, independent of the work-safe cutoff.

The offline gallery is an inspector, not an import validator: its lightweight metadata checks do not replace the strict manifest schema used by imports.

## Download and initialize

Prerequisites: Bun, Node.js 24.2+, Git, and a running PostgreSQL instance configured in `config/dev.env`. See [development setup](../DEV_SETUP.md#requirements).

```sh
./run.sh config/dev.env setup
./run.sh config/dev.env library download
bunx playwright install chromium
./run.sh config/dev.env seed
```

`download` uses `SEED_TEMPLATES_FROM` as its destination (`demo/jacebrowning-memegen` in development). It fetches upstream revision `a8b34146192d9a8fccc9f0d57b73aa947cbdd72d`, matching the checkout media URLs in the manifest. It validates all six imported fonts and the template tree before installing a staged download. A complete existing checkout is reused without modification or a claim that its revision matches. An incomplete existing destination is refused, not overwritten. `--to PATH` selects a download destination without changing your config; set `SEED_TEMPLATES_FROM` to that path before seeding from it.

`seed` imports fonts and local canonical templates/variations first, downloads missing manifest media, then runs any configured sample/starter seeds. Panel recipes require Playwright Chromium (`bunx playwright install chromium`): a lazy, reusable browser crops still-image sheets into PNG assets and renders the native JPEG cover. Sample/starter rendering also uses Chromium. Media and fonts stay in gitignored checkout/storage; they are not committed in this directory. Source links record provenance, not redistribution permission; review licensing for your deployment.

`SEED_MAX_RISK=3` is the default work view. Set it to an integer from 1 to 5 to change the ceiling. An empty `SEED_TEMPLATE_MANIFEST` disables only manifest import; `SEED_TEMPLATES_FROM` independently enables local checkout import. The full manifest remains the source of builtin metadata and risk decisions.

Custom manifests cannot lower reviewed canonical or retired-alias risks. Unknown checkout folders fail closed. Checkout roots use catalog defaults, while variations retain their upstream `config.yml` conversion. Canonical `jb/` entries can be imported through either source. Reconciliation affects managed roots and children, only removes seed-owned tag associations, and leaves user templates/tags intact; it does not moderate or remove existing posts. Sample/starter rendering prefers an existing original root and resolves missing retired roots to their canonical.

The runner invokes `library/seed.ts` once. With the environment already loaded, its direct interface is `bun library/seed.ts [--from PATH] [--manifest PATH] [--limit N]`; omitted paths use the corresponding seed environment variables (the manifest defaults to `library/MANIFEST.json`). Explicit empty paths disable that source. One SQL connection owns migration and reconciliation before and after both sources, including final reconciliation on import failure. Disabling both sources retains migration but skips reconciliation, leaving previously imported content unchanged. A disabled source alone does not unlist its under-ceiling existing entries.

## Reseed safely

```sh
./run.sh config/dev.env seed
```

Reruns preserve existing template IDs, assets, default layers, variants, and saved memes. They add catalog tags and update builtin visibility: retired duplicates and over-ceiling templates become unlisted, not deleted; direct links to records and media remain openable. Higher-risk alias metadata cannot annotate a lower-risk canonical. Successful imports survive download failures; a failed run exits unsuccessfully, and the next run resumes completed entries without downloading them again.

Panel-pack reseeds append missing `additionalImages` without replacing the cover, default panel sequence, existing membership/order, or saved memes. Each original is cached by its normalized download URL (excluding the fragment), recorded as a SHA-256 marker in its asset filename. Changing that URL adds an immutable choice; changing its display name or provenance page does not replace an already imported asset. Concurrent imports serialize publication, and interrupted imports reuse completed uploads.

`seed --limit N` bounds each source's template loop independently. With either source enabled, reconciliation still runs across existing managed templates, even with `--limit 0`; checkout fonts are still imported, so it is not a dry run. Sample/starter steps also follow their normal configured behavior.

### Review seeded near-duplicates

With storage running, run `./run.sh config/dev.env library duplicates`. This synchronizes the existing CLIP cache/index, checks every seeded image/GIF (including unlisted roots and variations), and writes `.data/search/seed-duplicates.json`. GIFs use their first frame; unsupported media and missing embeddings are reported explicitly. Missing embeddings fail the command.

The report retains pairs with cosine similarity ≥ 0.97, byte-equality, visibility, and same-family flags. Console output highlights public cross-family candidates; the JSON includes unlisted and same-family matches too. Scores are rounded to three decimals by the search service. A score of 1.000 is not proof of byte equality: blank backgrounds, crops, and different panel arrangements can match closely. Review images before changing the registry; this command never merges, unlists, or deletes anything.

The reviewed consolidation keeps the highest pixel-count image in each accepted duplicate group. Retired names/tags remain searchable aliases, with no redirect chains. Kermit and Mocking SpongeBob retain risk 2 when absorbing their checkout identities. The special `online/blank` canonical is a 2048×2048 pure-white JPEG with an empty editable black text box and no caption band; it replaces the old solid-black, transparent, and smaller white canvases. Its deterministic source uses identical white foreground/background colors, not an embedded placeholder label.

## Maintain the corpus

- Edit canonical metadata/defaults in `MANIFEST.json`, not in a second checkout score table. Keep stable `online/` and `jb/` slugs.
- Keep at least four distinct normalized search tags; target six to eight or more useful tags. Preserve existing tags and aliases. Include known subjects, source works/characters, cartoon style, and political context where applicable.
- Keep `risk` and nonempty `rating_tags` explicit. Search tags and rating reasons are separate; editorial scores can override broad category guidelines.
- Caption centers/sizes are fractions of image dimensions and boxes must fit inside the image. Fonts are `impact`, `sans`, `thin`, or `comic`; optional `start`/`end` are fractions of GIF duration. Import converts these to native seconds after probing the asset. Existing database layouts are never overwritten by a catalog edit.
- Reserve native multi-panel packs for formats where users customize panel count, repetition, order, and layout. A sheet containing multiple frames is not sufficient: fixed-format sequences such as Anakin/Padmé stay ordinary media templates with editable captions. Pack images are reusable choices, and the default sequence is only a starting point: three or eight Galaxy Brains, or four Drake rejections and one approval, are valid compositions.
- Native panel entries use `layout: "panels"` and a `panels` recipe containing `layout` (`vertical` or `horizontal`), `grid`, `mirror`, `fontSize`, and ordered `items`. Each item has editable `text` and `crop: { x, y, width, height }`: top-left origin and extent as fractions of the source sheet. Crops must fit inside the sheet and remain nonempty after pixel-edge rounding. Crop away old caption areas and divider gutters rather than treating the whole sheet as a panel.
- Optional `panels.additionalImages` lists standalone reusable choices as `{ name, url, source }`, with HTTPS original-image and provenance URLs. These do not add default panels or alter the sheet preview. The inspector lists their source links separately. Originals are browser-validated as still images and stored without re-encoding, using their actual detected format; default crops plus additional choices must fit the 24-image pack cap.
- A flat template and native panel recipe may share a source URL, but need distinct slugs. When one format supersedes another, retire its catalog identity while retaining its database row, assets, defaults, and existing memes. Never convert saved templates between flat and panel content in place. Repeated identical crops share stored assets while retaining separate editable panels. Template metadata and ordered pack membership are committed atomically; retries reuse uploaded bytes.
- Unsheathing the Sword (2 panel) remains a separate fixed-image template from the original single frame; its second frame reveals more blade, with one editable caption per frame.
- For a duplicate, retain one canonical manifest entry, move the retired metadata into policy `aliases`, and add its `duplicates` redirect. Every target must exist in the manifest, and redirects must be terminal. Preserve useful retired names/tags on the canonical when their risk permits it.
- Review actual images before merging. Different reactions and panel arrangements are not duplicates merely because their titles match.

## Ratings and editorial decisions

Ratings consider the original image, embedded language, title/aliases, captions, and source context:

| Score | Guideline |
|---|---|
| 1 | Very safe / child-appropriate |
| 2 | General audience, mild language or innuendo |
| 3 | Politics, smoking, drugs, or other mature themes |
| 4 | Bad language, strong suggestiveness, or realistic violence |
| 5 | Very inappropriate content, explicit sex, nudity, or gore |

Work settings admit 1–3 as potentially appropriate, not a guarantee for every workplace. Numeric editorial decisions override broad categories; descriptive reason tags do not automatically impose a score. Cartoon style alone does not excuse explicit content, nor does a weapon automatically imply violence. Ordinary identity or affection alone is not a risk reason. `review-needed` marks unresolved context, not an assertion of explicit imagery. Ratings are not exhaustive visual certification.

Uncensored F-word content requires at least 4 and `language`. Reviewed exceptions permit Jackie Chan WTF and Picard Wtf at 2, FFFFUUUU Rage Guy at 3, and the display-masked I F**** Love X at 2. Its display tag and Picard's explicit phrase tag are masked too; stable identifiers and provenance URLs remain unchanged. Other censored spellings and abbreviations retain the conservative rule. Metadata is regression-checked; remote embedded image text still requires visual review.

Preserve these reviewed decisions when maintaining metadata (reason tags, captions, and source metadata remain unless explicitly reviewed):

- Ben affleck smoking is 2 (`smoking`); Dat Boi is 3 (`language`); Cat Sniper Scope is 4 (`violence`).
- Doctor Manhattan It Is 1985 and Dead Baby Voldemort / What Happened To Him are 3 while retaining `nudity` and `gore` respectively.
- Barbie vs Oppenheimer, Bernie Sanders In a Chair, and Bernie I Am Once Again Asking For Your Support are 2. Cigar Cougar is 4 with `smoking` and `disturbing`.
- Illusion of free choice is 1 with `cartoon`, not `politics`. I See Dead People is 2 with `death` and `horror`. Here it comes is 2 with `general-audience`, not `violence`.
- Greedy Pipe Man (`online/6fesx7`) and its aliases are 2 with descriptive political context. It is the canonical BAYSAL cartoon; “fat man drinking from pipe” and “Guy Who Have Lot A Water” remain searchable aliases. Reconciliation unlists retired roots without deleting saved content.
- Feels Good, Insanity Wolf, I'm Going to Build My Own Theme Park, What's in the box!?, What the Hell is This?, and Vince McMahon Reaction are 2.
- Oh, I'm Sorry, I Thought This Was America; death knocking at the door; Rage Guy (FFFUUU); Say That Again I Dare You; and Hawk Tuah Girl are 3. 5 black guys and blonde is 5.
- Zendaya White Gown (False vs. Reality), `online/mm2156`, is 4 with `fashion` and `suggestive`: the revealing side view is inappropriate for work.
- Bench Press Fail, Blonde Woman Looking at the Camera, and 2 gay black mens kissing were removed from the catalog. Removal does not delete previously imported records or media.

## Layouts, fonts, and sources

Media layouts are `impact` (outlined captions), `comment` (one native white top-section caption), `subtitle`, and `labels`. They compile to ordinary shared editor layers, not a second renderer. Preserve per-box font, color, alignment, casing, rotation, and timing overrides. Geometry must fit inside the image; reposition source boxes minimally when curating out-of-bounds source geometry. GIF fractions become seconds after probing; still captions are unbounded.

The `panels` layout compiles to the existing native panel contract, not media text layers. Curated packs cover Meme Man's Panik/Kalm/Panik, Vince McMahon, Mr. Incredible normal/uncanny, Galaxy Brain, and Tuxedo Pooh. Their default panel counts do not constrain the user's composition; images can be reused or omitted. Imports validate still-image bytes and reject animation, enforce source/output caps, and store individual cropped assets plus a composed cover. Panel captions use the native panel renderer's typography; no catalog font download is required for these captions.

Galaxy Brain's sole listed canonical is `online/galaxybrainpanels`, with four independently cropped brain images. Its normalized crop recipe uses `panel-images.ts` / `cropPixels`, shared by gallery preview and seed import. Users can omit, repeat, reorder, or add panels rather than choosing a fixed three- or four-frame sheet. The retired `jb/gb`, `online/24rhyz`, and `online/2n589r` formats (and previous aliases) resolve directly to this pack for discovery; existing flat memes retain their original assets.

Mr. Incredible's `online/5mir21panels` pack contains 15 choices: its two original crops, Canny phases 1–7, and Uncanny phases 2–6 and 9. The original two-panel default remains unchanged. Image provenance is recorded per choice from the [Canny wiki](https://the-canny-incredible.fandom.com/wiki/Mr._Incredible_Becoming_Canny) and [Uncanny wiki](https://the-uncanny-incredible.fandom.com/wiki/Phase_4). The [Phase 9 skull variant](https://the-uncanny-incredible.fandom.com/wiki/Phase_9) credits a Shutterstock source; public wiki availability does not clear redistribution rights.

The built-in Drake Hotline Bling (Panels) entry is retired in favor of the existing Drake template. Reseeding unlists only the managed retired entry; user-created Drake packs and existing panel memes remain untouched.

The four catalog roles are `impact` → Impact, `sans` → Noto Sans Bold, `thin` → Titillium Web SemiBold, and `comic` → Kalam. The checkout also imports Titillium Web Black and Noto Sans Hebrew Bold for source aliases/variations. `fonts.ts` owns filenames, display identities, aliases, and catalog roles; preview-only synthetic asset IDs stay in `preview.ts`. Checkout's default thick caption alias is deliberately mapped to Impact.

Movie subtitles use pale cream-yellow (`#f5f2a6`) Noto Sans with a thin black outline and original casing. Catalog dialogue sizes are approximately 7% of each panel's height, stored image-relative rather than inferred during rendering. Explicit white captions and Impact headings retain source styling.

Every manifest entry requires HTTPS media/provenance URLs, integer risk 1–5, and 1–12 unique lowercase kebab-case rating reasons of 1–40 characters. Retired slugs cannot remain canonical entries. Source URLs were checked during assembly, but external hosts may remove images; this is not a live startup scrape. Review rights before deployment: public availability is not a redistribution license, and snapshots include imported image bytes.

Discovery sources include [Imgflip](https://imgflip.com/memetemplates?sort=top-all-time), [Know Your Meme](https://knowyourmeme.com/photos/templates), [Meming Wiki](https://en.meming.world/wiki/Category:Images), [MagicMeme](https://magicmeme.com/meme-templates), and [MemesGuy's current](https://memesguy.com/year/2026) and [historical timelines](https://memesguy.com/year/2025). Historical MemesGuy archives span 1996–2025; culture-only listings and examples without reusable template images were excluded.

Gallery media previews use `manifestLayers`, `composedSize`, and `composeFrame` with real fonts. Panel previews share `cropPanelImages` with ingestion and use `composePanels` with the native layout, grid, mirroring, and caption size. Stills draw from the loaded image without CORS fetch/readback; GIFs decode and animate in the browser. Removing a card or unchecking releases pending work/canvases/frames/cropped bitmaps. Missing media or fonts retain the original with an explicit error rather than substituting a font. The server serves bytes and bundles code; it never decodes or renders media.

## Verification

Verify from the repository root:

```sh
./run.sh config/dev.env typecheck
./run.sh config/dev.env test
./run.sh config/dev.env e2e
```

For gallery-only browser coverage without the application stack, database, AI stubs, or search, run `./run.sh config/dev.env e2e --project=library`. Its isolated configuration is `playwright.library.config.ts`.
