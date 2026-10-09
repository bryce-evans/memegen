# AGENTS.md

Rules for changing this repo. Setup and commands: [README.md](README.md). Design, data model, and API contracts: [ARCH.md](ARCH.md). Read ARCH.md before changing behavior.

## Layout

- `packages/shared`: types, zod schemas, limits, animation and text layout. The single source of truth for contracts between web, render, and services.
- `packages/render`: browser-only decode/composite/encode. Never import it from servers.
- `packages/server-kit`: config, Postgres, migrations, `AuthProvider`, HTTP helpers.
- `packages/ui`: skinnable components, tokens, and skins (see its README).
- `services/storage`: asset upload/serve, providers, probing, caps.
- `services/api`: everything else (users, templates, memes, votes, comments, tags, stickers, stats).
- `apps/web`: React SPA.
- `db/migrations`: append-only `NNN_name.sql`.
- `e2e`: Playwright specs and fixtures.

## Rules

- **Tooling:** Bun only (`bun install`, `bun add`, `bun run …`). No npm/yarn or other lockfiles. Workspace deps use `"workspace:*"`.
- **Server TS:** Node runs `.ts` via type stripping. Erasable syntax only: no `enum`, `namespace`, or constructor parameter properties. Use explicit `.ts` import specifiers and `import type` for type-only imports.
- **Rendering is client-side:** servers never decode or encode frames. Preview and export must both use `layoutText`/`drawText` from `packages/shared`.
- **UI:** build only from `@memegen/ui` components. `apps/web/src/styles.css` is layout-only and uses design tokens, never hard-coded colors.
- **Caps:** defaults in `packages/shared/src/limits.ts`, env overrides in `packages/server-kit/src/config.ts`. Storage enforces them on every write.
- **Migrations:** never edit an applied migration. Add a new one (snapshots depend on this).
- **Contracts:** an API shape change updates the `packages/shared` types and schemas, the contract tables in ARCH.md, and every caller in `apps/web`.
- **Secret stat:** `negativeHScore` is internal-only. Never return it from `/api/*`.
- **Auth:** routes get the user only through `AuthProvider` (`c.get("user")`). Never read `X-User-Id` directly.
- **Assets:** `demo/` and `e2e/fixtures/` are gitignored. Never commit media or fonts.
- **Docs:** record new design decisions in ARCH.md. Update README.md only for user-visible features or setup changes.

## Verification

- Run everything through `./run.sh config/dev.env <command>`. Never point commands at `config/prod.env`, and never add test or mock behavior that bypasses `MODE=prod` guards.
- Always: `bun run typecheck` and `./run.sh config/dev.env test` (serial; recreates `memegen_test`).
- UI or render changes: `./run.sh config/dev.env e2e`. Missing fixtures: recreate them with the commands in README "Tests".
- New UI flows get an e2e spec, or extend an existing one. New UI ships with `data-testid`s for anything a spec drives.

### e2e conventions

- Select elements by `data-testid` only.
- Wait on state, never timeouts: `data-ready` on `stage-canvas`, `data-complete` on `timeline`, `expect.poll` for refetched lists.
- Use `openFeed`/`loadAll` for feeds. They wait on the URL and on `meme-feed[aria-busy="false"]`.
- Set up data through `apiPost`/`apiTemplate`/`apiMeme` in `e2e/helpers.ts`, and reuse shared helpers (e.g. `tagSlug`) instead of copying contracts.
