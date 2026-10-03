#!/usr/bin/env bash
# memegen runner: every command takes a config file of KEY=value lines.
#
#   ./run.sh <config> <command>
#
#   setup    install deps, create the database if missing, run migrations
#   migrate  apply pending migrations
#   seed     load SEED_MOCK data and/or templates from SEED_TEMPLATES_FROM
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
  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
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
  [[ "${SEED_MOCK:-false}" != true ]] || die "SEED_MOCK=true is not allowed in prod"
  [[ "$DATABASE_URL" != *CHANGE_ME* ]] || die "set a real DATABASE_URL in $CONFIG"
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1 ($2)"
}

check_tools() {
  need node "https://nodejs.org, >= 23.6"
  need bun "https://bun.sh"
  local major minor
  IFS=. read -r major minor _ <<<"$(node -p 'process.versions.node')"
  ((major > 23 || (major == 23 && minor >= 6))) || die "node >= 23.6 required (have $(node -v))"
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

# Run commands as a group; stop all when any exits or on Ctrl-C. (bash 3.2-safe: no `wait -n`.)
GROUP_PIDS=""
stop_group() {
  [[ -z "$GROUP_PIDS" ]] || kill $GROUP_PIDS 2>/dev/null || true
}
run_group() {
  trap 'stop_group; exit 130' INT TERM
  trap stop_group EXIT
  for cmd in "$@"; do
    bash -c "exec $cmd" &
    GROUP_PIDS="$GROUP_PIDS $!"
  done
  while :; do
    for pid in $GROUP_PIDS; do
      if ! kill -0 "$pid" 2>/dev/null; then
        local status=0
        wait "$pid" || status=$?
        echo "run.sh: process $pid exited ($status); stopping the rest" >&2
        stop_group
        wait 2>/dev/null || true
        return "$status"
      fi
    done
    sleep 1
  done
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
    migrate
    seeded=false
    if [[ "${SEED_MOCK:-false}" == true ]]; then
      node scripts/mock/seed.ts
      seeded=true
    fi
    if [[ -n "${SEED_TEMPLATES_FROM:-}" ]]; then
      [[ -d "$SEED_TEMPLATES_FROM" ]] ||
        die "SEED_TEMPLATES_FROM=$SEED_TEMPLATES_FROM not found (git clone --depth 1 https://github.com/jacebrowning/memegen $SEED_TEMPLATES_FROM)"
      node scripts/seed.ts --from "$SEED_TEMPLATES_FROM" "$@"
      seeded=true
    fi
    [[ "$seeded" == true ]] || echo "nothing to seed (set SEED_MOCK=true or SEED_TEMPLATES_FROM in $CONFIG)"
    ;;
  dev)
    dev_only
    exec node scripts/dev.ts
    ;;
  build)
    bun run build
    ;;
  start)
    bun run build
    migrate
    run_group \
      "node services/storage/src/server.ts" \
      "node services/api/src/server.ts" \
      "node scripts/serve-web.ts"
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
