# AGENTS.md

How to run, seed, and test: **[README.md](README.md)**. Design, contracts, and the reasons behind them: **[ARCH.md](ARCH.md)**. Read both before changing behavior.

## Layout

- `packages/shared`: types, zod schemas, upload limits, animation and text layout. This is the single source of truth for contracts between web, render, and services.
- `packages/render`: browser-only decode/composite/encode (mediabunny, gifuct-js, gifenc). Never import it from servers.
- `packages/server-kit`: Postgres client, migrations, `AuthProvider`, HTTP error helpers.
- `services/storage`: asset upload/serve, `StorageProvider` registry, server-side probing and caps.
- `services/api`: users, templates, memes, votes, gallery, stats.
- `apps/web`: React SPA (editor + gallery). Build UI only from `@memegen/ui` components; app CSS (`apps/web/src/styles.css`) is layout-only and uses design tokens, never hard-coded colors.
- `packages/ui`: skinnable components, design tokens, and skins (`default`, `apple`, `material`, `google`, `spectrum`). See its README.
- `e2e`: Playwright specs, fixtures, and isolated-DB setup (`setup-db.ts` refuses non-`e2e` databases).
- `db/migrations`: append-only SQL files (`NNN_name.sql`). Never edit an applied migration; add a new one.

## Rules

- **Tooling:** Bun is the package manager and script runner (`bun install`, `bun add`, `bun run …`). Don't use npm/yarn or commit other lockfiles. Workspace deps use `"workspace:*"`.
- **Server TS:** servers run on Node with native type stripping. Use erasable syntax only: no `enum`, `namespace`, or constructor parameter properties. Use explicit `.ts` import specifiers and `import type` for type-only imports.
- **Rendering stays client-side:** servers store, validate, and index; they never decode or encode frames. The editor preview and the export must both use `layoutText`/`drawText` from `packages/shared` so they stay identical.
- **Caps:** upload caps live in `packages/shared/src/limits.ts` (defaults) and `packages/server-kit/src/config.ts` (env overrides). The storage service must enforce them on every write.
- **Contracts:** API shape changes update `packages/shared` types/schemas, the contract tables in ARCH.md, and every caller in `apps/web`.
- **Secret stat:** `negativeHScore` is internal-only. Never return it from `/api/*`.
- **Auth:** routes get the user only through the `AuthProvider` (`c.get("user")` in the API). Never read `X-User-Id` directly.
- **Docs:** record new design decisions in ARCH.md as you make them.

## Verification

- Run everything through `./run.sh config/dev.env <command>` (see README "run.sh and configs"). Never point commands at `config/prod.env`, and never add test or mock behavior that bypasses `MODE=prod` guards.
- `bun run typecheck` and `./run.sh config/dev.env test`. Tests run serially and recreate the `memegen_test` schema.
- UI or render changes: `./run.sh config/dev.env e2e` (Playwright, every skin; see README "Tests"). Specs live in `e2e/`, with fixtures in `e2e/fixtures/`.
  - Use the e2e helpers `openFeed`/`loadAll`. They wait on the URL and on `meme-feed[aria-busy="false"]`.
  - `demo/` and `e2e/fixtures/` are gitignored local assets. Never commit media or fonts. Recreate fixtures with the README commands.
  - Select elements by `data-testid` only.
  - Wait on state (`data-ready` on `stage-canvas`, `data-complete` on `timeline`, `expect.poll` for refetched lists), never on timeouts.
  - New UI must ship with test ids for anything a spec drives.
- For new UI flows, add or extend an e2e spec rather than relying on manual clicking.
