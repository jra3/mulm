#!/usr/bin/env bash
#
# One entry point to the Fly staging app (basny-bap-staging).
#
#   ./scripts/staging.sh deploy                 deploy the current checkout (clean tree only)
#   ./scripts/staging.sh refresh                replace staging's DB with prod's replica, then seed
#   ./scripts/staging.sh seed                   rotate the test logins' passwords
#   ./scripts/staging.sh login <admin|member>   print the path of a logged-in cookie jar
#
# Staging is public and holds a copy of prod data, so its test logins get random
# passwords, rotated on every seed and kept only in $CREDS_FILE (mode 600). The
# seed itself is src/staging/seed.ts, run inside the container; it refuses to run
# unless STAGING=1, and touches only the two baptest+ accounts.
set -euo pipefail
# Credentials and cookie jars are secrets: nothing this script writes is group/world readable.
umask 077

APP="basny-bap-staging"
URL="https://${APP}.fly.dev"
DB_DIR="/mnt/app-data/database"
CREDS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/mulm/staging-test-users.env"
JAR_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mulm"

die() { echo "staging.sh: $*" >&2; exit 1; }

usage() {
  sed -n '5,8p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

machine_id() {
  flyctl machines list --app "$APP" --json | jq -r '.[0].id'
}

wait_healthy() {
  echo "Waiting for ${URL}/health..." >&2
  for _ in $(seq 60); do
    if curl -sf -m 10 -o /dev/null "${URL}/health"; then
      return 0
    fi
    sleep 5
  done
  die "staging did not become healthy within 5 minutes"
}

# flyctl ssh does not wake a scale-to-zero machine (only HTTP via fly-proxy does).
ensure_started() {
  flyctl machine start "$1" --app "$APP" >/dev/null 2>&1 || true
  wait_healthy
}

# Run a shell script on the machine. Base64 so nothing needs escaping through
# flyctl's argument splitting. Every script first checks it is on staging.
remote_sh() {
  local machine=$1 script=$2 b64
  b64=$(printf '%s\n%s' '[ "$STAGING" = 1 ] || { echo "REFUSING: STAGING is not 1" >&2; exit 3; }' "$script" | base64 -w0)
  flyctl ssh console --app "$APP" --machine "$machine" -C "sh -c 'echo $b64 | base64 -d | sh'"
}

cmd_deploy() {
  cd "$(git rev-parse --show-toplevel)"
  if [ -n "$(git status --porcelain)" ]; then
    git status --short >&2
    die "refusing to deploy a dirty tree; commit or stash first"
  fi
  echo "Deploying $(git log -1 --format='%h %s') to ${APP}"
  flyctl deploy --config fly.staging.toml --app "$APP"
  echo "Deployed $(git rev-parse HEAD) to ${URL}"
}

cmd_refresh() {
  local machine
  machine=$(machine_id)
  ensure_started "$machine"
  echo "Deleting staging's database on ${machine}..."
  remote_sh "$machine" "rm -f ${DB_DIR}/database.db ${DB_DIR}/database.db-shm ${DB_DIR}/database.db-wal"
  echo "Restarting ${machine}; start.sh restores from prod's replica..."
  flyctl machine restart "$machine" --app "$APP"
  wait_healthy
  cmd_seed
}

cmd_seed() {
  local machine out json
  machine=$(machine_id)
  ensure_started "$machine"
  echo "Seeding test logins on ${machine}..." >&2
  # Run as the app's user so SQLite never leaves root-owned -wal/-shm files.
  if ! out=$(remote_sh "$machine" "su nodejs -s /bin/sh -c 'cd /app && node src/staging/seed.js'" | tr -d '\r'); then
    printf '%s\n' "$out" >&2
    die "seed failed on ${machine}"
  fi
  # The credentials are the only stdout line starting with "{".
  json=$(printf '%s\n' "$out" | grep '^{' | tail -n1) || true
  if ! printf '%s' "$json" | jq -e '.admin.password and .member.password' >/dev/null 2>&1; then
    printf '%s\n' "$out" >&2
    die "seed did not print credentials"
  fi

  mkdir -p "$(dirname "$CREDS_FILE")"
  printf '%s' "$json" | jq -r --arg url "$URL" '
    "# Written by scripts/staging.sh seed; rotated on every run. Do not commit.",
    "STAGING_URL=\($url)",
    "STAGING_ADMIN_EMAIL=\(.admin.email)",
    "STAGING_ADMIN_PASSWORD=\(.admin.password)",
    "STAGING_USER_EMAIL=\(.member.email)",
    "STAGING_USER_PASSWORD=\(.member.password)"' > "$CREDS_FILE"
  chmod 600 "$CREDS_FILE"
  # The seed ended every session these accounts had.
  rm -f "$JAR_DIR"/staging-*.cookies
  echo "Credentials for ${URL} written to ${CREDS_FILE}" >&2
}

cmd_login() {
  local role=${1:-} email password jar headers body status
  [ -f "$CREDS_FILE" ] || die "no ${CREDS_FILE}; run: $0 seed"
  # shellcheck disable=SC1090
  source "$CREDS_FILE"
  case "$role" in
    admin) email=$STAGING_ADMIN_EMAIL; password=$STAGING_ADMIN_PASSWORD ;;
    member) email=$STAGING_USER_EMAIL; password=$STAGING_USER_PASSWORD ;;
    *) usage ;;
  esac

  mkdir -p "$JAR_DIR"
  jar="${JAR_DIR}/staging-${role}.cookies"

  # Login rate-limits after a few attempts, so reuse a jar while it still works.
  if [ -f "$jar" ] &&
    [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "${URL}/account")" = 200 ]; then
    echo "$jar"
    return 0
  fi

  headers=$(mktemp)
  body=$(mktemp)
  # Form body via env and stdin, so the password never appears in a command line.
  status=$(EMAIL=$email PASSWORD=$password \
    jq -rn '"email=\(env.EMAIL | @uri)&password=\(env.PASSWORD | @uri)"' |
    curl -s -D "$headers" -o "$body" -w '%{http_code}' -c "$jar" \
      -H "Origin: ${URL}" --data-binary @- "${URL}/auth/login")
  if [ "$status" != 200 ] || ! grep -qi '^hx-redirect:' "$headers"; then
    echo "$(head -c 300 "$body")" >&2
    rm -f "$jar" "$headers" "$body"
    die "login as ${email} failed (HTTP ${status}); passwords rotate on every seed, so try: $0 seed"
  fi
  rm -f "$headers" "$body"
  echo "$jar"
}

case "${1:-}" in
  deploy) cmd_deploy ;;
  refresh) cmd_refresh ;;
  seed) cmd_seed ;;
  login) shift; cmd_login "$@" ;;
  *) usage ;;
esac
