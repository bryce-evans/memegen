#!/usr/bin/env bash
# memegen runner: every command takes a config file of KEY=value lines.
#
#   ./run.sh <config> <command>
#
#   setup    install deps, create the database if missing, run migrations
#   migrate  apply pending migrations
#   seed     import templates from SEED_TEMPLATES_FROM, then the SEED_SAMPLE dataset and SEED_STICKERS_FROM stickers
#   reset    wipe the database and local storage, then seed (dev only)
#   dev      storage + api + Vite dev server with reload (dev only)
#   build    production build of the web app
#   start    build, then run storage + api + web server (apps/web/dist)
#   test     unit/integration tests (dev only)
#   e2e      Playwright browser tests (dev only)
#   config   print the resolved config (secrets masked)
#
# Examples:
#   ./run.sh config/dev.env setup && ./run.sh config/dev.env seed && ./run.sh config/dev.env dev
#   ./run.sh config/prod.env start
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

usage() {
  # The header comment block (line 2 up to the first non-comment line).
  sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p;}' "$0"
  exit "${1:-1}"
}
die() {
  echo "run.sh: $*" >&2
  exit 1
}

[[ $# -ge 2 ]] || usage
CONFIG="$1"
COMMAND="$2"
shift 2
[[ -f "$CONFIG" ]] || die "config file not found: $CONFIG"

# Export every KEY=value from the config. Values are taken literally (no shell expansion).
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || die "bad line in $CONFIG: $line"
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
  export "$key=$value"
done <"$CONFIG"

MODE="${MODE:-dev}"
[[ "$MODE" == dev || "$MODE" == prod ]] || die "MODE must be dev or prod (got '$MODE')"
[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is required in $CONFIG"
export MEMEGEN_CONFIG="$CONFIG"

dev_only() {
  [[ "$MODE" == dev ]] || die "'$COMMAND' is disabled in prod mode ($CONFIG)"
}

check_prod() {
  [[ "$MODE" == prod ]] || return 0
  [[ -n "${INTERNAL_TOKEN:-}" && "$INTERNAL_TOKEN" != dev-internal-token ]] ||
    die "prod requires a strong INTERNAL_TOKEN (e.g. openssl rand -hex 32)"
  [[ "${SEED_SAMPLE:-false}" != true ]] || die "SEED_SAMPLE=true is not allowed in prod"
  [[ -z "${SEED_STICKERS_FROM:-}" ]] || die "SEED_STICKERS_FROM (dev test stickers) is not allowed in prod"
  [[ "$DATABASE_URL" != *CHANGE_ME* ]] || die "set a real DATABASE_URL in $CONFIG"
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1 ($2)"
}

check_tools() {
  need node "https://nodejs.org, >= 24.2"
  need bun "https://bun.sh"
  local major minor
  IFS=. read -r major minor _ <<<"$(node -p 'process.versions.node')"
  ((major > 24 || (major == 24 && minor >= 2))) || die "node >= 24.2 required (have $(node -v))"
}

# Create the database named in a URL if it doesn't exist (needs createdb/psql locally).
ensure_db() {
  local url="$1"
  if psql "$url" -Atc 'select 1' >/dev/null 2>&1; then return 0; fi
  need psql "PostgreSQL client"
  need createdb "PostgreSQL client"
  local name="${url##*/}"
  name="${name%%\?*}"
  local server="${url%/*}/postgres"
  echo "creating database $name"
  createdb --maintenance-db="$server" "$name" || die "could not create database $name; is Postgres running?"
}

migrate() {
  node packages/server-kit/src/migrate.ts
}

# Templates first: the sample memes are made from them.
seed() {
  migrate
  local seeded=false
  if [[ -n "${SEED_TEMPLATES_FROM:-}" ]]; then
    [[ -d "$SEED_TEMPLATES_FROM" ]] ||
      die "SEED_TEMPLATES_FROM=$SEED_TEMPLATES_FROM not found (git clone --depth 1 https://github.com/jacebrowning/memegen $SEED_TEMPLATES_FROM)"
    node scripts/seed.ts --from "$SEED_TEMPLATES_FROM" "$@"
    seeded=true
  fi
  if [[ "${SEED_SAMPLE:-false}" == true ]]; then
    node scripts/sample/seed.ts
    seeded=true
  fi
  # Local test stickers (gitignored like demo/), so a missing folder is skipped rather than fatal.
  if [[ -n "${SEED_STICKERS_FROM:-}" ]]; then
    if [[ -d "$SEED_STICKERS_FROM" ]]; then
      node scripts/seed-stickers.ts --from "$SEED_STICKERS_FROM"
      seeded=true
    else
      echo "SEED_STICKERS_FROM=$SEED_STICKERS_FROM not found; no stickers seeded"
    fi
  fi
  [[ "$seeded" == true ]] || echo "nothing to seed (set SEED_TEMPLATES_FROM or SEED_SAMPLE=true in $CONFIG)"
}

check_prod

case "$COMMAND" in
  setup)
    check_tools
    bun install
    ensure_db "$DATABASE_URL"
    if [[ "$MODE" == dev ]]; then
      [[ -z "${TEST_DATABASE_URL:-}" ]] || ensure_db "$TEST_DATABASE_URL"
      [[ -z "${E2E_DATABASE_URL:-}" ]] || ensure_db "$E2E_DATABASE_URL"
    fi
    [[ "${STORAGE_PROVIDER:-local}" != local ]] || mkdir -p "${LOCAL_STORAGE_DIR:-.data/storage}"
    migrate
    echo "setup complete ($MODE)"
    ;;
  migrate)
    migrate
    ;;
  seed)
    seed "$@"
    ;;
  reset)
    dev_only
    [[ "${STORAGE_PROVIDER:-local}" == local ]] || die "reset only wipes local storage (STORAGE_PROVIDER=${STORAGE_PROVIDER})"
    PGOPTIONS='-c client_min_messages=warning' psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
      -c 'drop schema if exists public cascade' -c 'create schema public'
    rm -rf "${LOCAL_STORAGE_DIR:-.data/storage}"
    mkdir -p "${LOCAL_STORAGE_DIR:-.data/storage}"
    seed "$@"
    ;;
  dev)
    dev_only
    exec node scripts/run.ts --watch
    ;;
  build)
    bun run build
    ;;
  start)
    bun run build
    exec node scripts/run.ts --prod
    ;;
  test)
    dev_only
    exec bun run test "$@"
    ;;
  e2e)
    dev_only
    exec bun run test:e2e "$@"
    ;;
  config)
    echo "# resolved from $CONFIG"
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)= ]] || continue
      key="${BASH_REMATCH[1]}"
      value="${!key-}"
      if [[ "$key" =~ (TOKEN|SECRET|PASSWORD|KEY) && -n "$value" ]]; then value="****"; fi
      [[ "$key" != DATABASE_URL || "$value" != *:*@* ]] || value="$(sed -E 's#(://[^:]+:)[^@]+@#\1****@#' <<<"$value")"
      echo "$key=$value"
    done <"$CONFIG"
    ;;
  -h | --help | help)
    usage 0
    ;;
  *)
    die "unknown command '$COMMAND' (see ./run.sh --help)"
    ;;
esac
