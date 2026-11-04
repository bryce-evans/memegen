# Meme library

This directory owns the corpus of known templates: canonical images/GIFs, searchable tags, ratings, default text and placement, duplicate identities, preview, and seed import.

## Files

| File | Responsibility |
|---|---|
| `MANIFEST.json` | 1,464 canonical templates, provenance/media URLs, tags, ratings, and default captions/layouts |
| `REGISTRY_POLICY.json` | 243 retired identities, terminal canonical redirects, and rated search aliases |
| `index.html` | Standalone searchable gallery with risk and tag filters |
| `preview.ts` | Browser-only default-caption composition using the editor's shared renderer |
| `manifest.ts` | Manifest validation and conversion to native editor layers |
| `registry.ts` | Risk selection, alias tags, duplicate visibility, and reseed reconciliation |
| `download.ts` | Non-destructive download of the pinned checkout/font prerequisites |
| `seed-checkout.ts` | Local font/media import, catalog root defaults, and checkout variations |
| `seed.ts` | Manifest media download and resumable asset/template import |
| `serve.ts` | Development-only loopback gallery server |

The 210 existing media-bearing checkout templates are represented by 201 `jb/` canonicals and nine aliases to online canonicals. `oldschool`, source keywords, and existing seed tags are retained on canonical entries or their rated aliases. The media-less `_test` fixture is excluded. Eight additional online duplicates resolve to checkout canonicals; distinct drawings, reactions, and panel counts remain separate.

## Browse without seeding

Run from the repository root:

```sh
./run.sh config/dev.env library serve
```

Open **http://127.0.0.1:8088/**. Use `--port 8090` to choose another port. The server exposes the gallery, the two JSON files, an in-memory browser preview bundle, and four fixed font routes, with caching disabled; it does not expose config files or mutate a database. `Ctrl-C` stops it.

Each card has an unchecked **Show placeholder text** checkbox. Check it to render the default words directly on that image with the editor's fonts, outline, casing, rotation, and placement; comment layouts add their native white top band. GIF previews animate with their caption timing. Unchecking restores the original image. Captions remain searchable but are not listed beneath cards. The checkbox is disabled when remote image previews are off.

Caption rendering needs installed dependencies and the fonts from `library download`; missing fonts show an error instead of silently substituting another font. `library serve` bundles the existing browser renderer at startup without writing generated files. Restart it after changing preview code; manifest edits only require a page reload.

Alternatively, open `library/index.html` directly and select the neighboring `MANIFEST.json` for metadata and original-image browsing; rendered captions require the local server. Choose **All ratings** and the **oldschool** template tag to browse all 210 seed formats, independent of the work-safe cutoff.

## Download and initialize

Prerequisites: Bun, Node.js 24.2+, Git, and a running PostgreSQL instance configured in `config/dev.env`. See the root [README](../README.md#requirements).

```sh
./run.sh config/dev.env setup
./run.sh config/dev.env library download
bunx playwright install chromium
./run.sh config/dev.env seed
```

`download` uses `SEED_TEMPLATES_FROM` as its destination (`demo/jacebrowning-memegen` in development). It fetches upstream revision `a8b34146192d9a8fccc9f0d57b73aa947cbdd72d`, matching the checkout media URLs in the manifest. It validates all six imported fonts and the template tree before installing a staged download. A complete existing checkout is reused without modification or a claim that its revision matches. An incomplete existing destination is refused, not overwritten. `--to PATH` selects a download destination without changing your config; set `SEED_TEMPLATES_FROM` to that path before seeding from it.

`seed` imports fonts and local canonical templates/variations first, downloads missing manifest media, then runs any configured sample/starter seeds. Chromium is used by sample/starter rendering, not by catalog import. Media and fonts stay in the gitignored checkout/storage; they are not committed in this directory. Source links record provenance, not redistribution permission; review licensing for your deployment.

`SEED_MAX_RISK=3` is the default work view. Set it to an integer from 1 to 5 to change the ceiling. An empty `SEED_TEMPLATE_MANIFEST` disables only manifest import; `SEED_TEMPLATES_FROM` independently enables local checkout import. The full manifest remains the source of builtin metadata and risk decisions.

## Reseed safely

```sh
./run.sh config/dev.env seed
```

Reruns preserve existing template IDs, assets, default layers, variants, and saved memes. They add catalog tags and update builtin visibility: retired duplicates and over-ceiling templates become private, not deleted. Higher-risk alias metadata cannot annotate a lower-risk canonical. Successful imports survive download failures; a failed run exits unsuccessfully, and the next run resumes completed entries without downloading them again.

`seed --limit N` bounds each importer's template loop. Reconciliation still runs across existing managed templates, even with `--limit 0`; it is not a dry run. Sample/starter steps also follow their normal configured behavior.

## Maintain the corpus

- Edit canonical metadata/defaults in `MANIFEST.json`, not in a second checkout score table. Keep stable `online/` and `jb/` slugs.
- Keep at least four distinct normalized search tags; target six to eight or more useful tags. Preserve existing tags and aliases. Include known subjects, source works/characters, cartoon style, and political context where applicable.
- Keep `risk` and nonempty `rating_tags` explicit. Search tags and rating reasons are separate; editorial scores can override broad category guidelines.
- Caption centers/sizes are fractions of image dimensions and boxes must fit inside the image. Fonts are `impact`, `sans`, `thin`, or `comic`; optional `start`/`end` are fractions of GIF duration. Import converts these to native seconds after probing the asset. Existing database layouts are never overwritten by a catalog edit.
- For a duplicate, retain one canonical manifest entry, move the retired metadata into policy `aliases`, and add its `duplicates` redirect. Every target must exist in the manifest, and redirects must be terminal. Preserve useful retired names/tags on the canonical when their risk permits it.
- Review actual images before merging. Different reactions and panel arrangements are not duplicates merely because their titles match.

Verify from the repository root:

```sh
bun run typecheck
./run.sh config/dev.env test
./run.sh config/dev.env e2e
```
