#!/usr/bin/env bash
#
# Production cutover runbook for the EC2 -> Fly.io migration.
#
# Walks an operator through the steps in order, prompting for confirmation
# at each gate. Safe to abort at any point before step 4 (the EC2 stop).
# After step 4 you are committed to either completing the cutover or
# explicitly rolling back per the rollback plan.
#
# Pre-requisites (verify before starting):
#   - flyctl logged in as the owner of `basny-bap` (`flyctl auth whoami`)
#   - SSH alias `BAP` works (Tailscale up; `ssh BAP echo ok`)
#   - Webmaster has dropped `bap.basny.org` TTL to 60s at least 1 hour ago
#   - You have an open browser tab to the Fly dashboard:
#         https://fly.io/apps/basny-bap/monitoring
#   - This script is run from the repo root.
#
# Usage:
#   bash scripts/cutover.sh
#
# Tip: keep a second terminal open running `flyctl logs --app basny-bap`.

set -euo pipefail

PROD_APP="basny-bap"
STAGING_APP="basny-bap-staging"
PROD_HOST="bap.basny.org"
FLY_REGION="ewr"
PROD_VOL_NAME="basny_data"
EC2_SSH="BAP"
EC2_DB="/mnt/basny-data/app/database/database.db"
EC2_CONFIG="/mnt/basny-data/app/config/config.production.json"
EC2_COMPOSE_DIR="/opt/basny"

# ---------- helpers --------------------------------------------------------

C_RESET='\033[0m'; C_BOLD='\033[1m'; C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_CYAN='\033[36m'

step() { printf "\n${C_BOLD}${C_CYAN}=== %s ===${C_RESET}\n" "$*"; }
ok()   { printf "${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}!${C_RESET} %s\n" "$*"; }
fail() { printf "${C_RED}✗${C_RESET} %s\n" "$*" >&2; exit 1; }

confirm() {
  local prompt="${1:-continue?}"
  read -rp "$(printf "${C_YELLOW}%s${C_RESET} [y/N] " "$prompt")" ans
  case "$ans" in y|Y|yes|YES) ;; *) fail "aborted by operator" ;; esac
}

# ---------- pre-flight -----------------------------------------------------

step "Pre-flight"
flyctl auth whoami >/dev/null || fail "flyctl not authenticated"
ok "flyctl authed: $(flyctl auth whoami 2>/dev/null)"

ssh -o ConnectTimeout=10 -o BatchMode=yes "$EC2_SSH" 'echo ok' >/dev/null \
  || fail "SSH to $EC2_SSH failed; check Tailscale"
ok "ssh $EC2_SSH reachable"

flyctl status --app "$PROD_APP" >/dev/null || fail "$PROD_APP not visible to flyctl"
ok "$PROD_APP visible in Fly"

current_ttl=$(dig +short "$PROD_HOST" CNAME @1.1.1.1 || true)
warn "Current $PROD_HOST CNAME (informational): ${current_ttl:-<no CNAME, A/AAAA in use>}"
warn "Confirm webmaster lowered TTL to 60s at least 1h ago."
confirm "Pre-flight checks pass. Proceed to STEP 1?"

# ---------- step 1: set the real prod CONFIG_JSON --------------------------

step "STEP 1: Push real prod CONFIG_JSON to $PROD_APP (currently has stale staging-overrides version)"

CONFIG_TMP=$(mktemp /tmp/prod-config.XXXXXX.json)
trap 'shred -u "$CONFIG_TMP" 2>/dev/null || rm -f "$CONFIG_TMP"' EXIT

ssh "$EC2_SSH" "sudo -n cat $EC2_CONFIG" > "$CONFIG_TMP"
size=$(wc -c < "$CONFIG_TMP")
[ "$size" -gt 500 ] || fail "fetched config is suspiciously small ($size bytes)"
ok "fetched prod config ($size bytes)"

# sanity-check shape without printing secrets
jq -e '
  .server.domain == "'"$PROD_HOST"'"
  and .webauthn.rpID == "'"$PROD_HOST"'"
  and (.storage.s3AccessKeyId | length > 0)
' "$CONFIG_TMP" >/dev/null || fail "config shape check failed (domain/rpID/s3 key)"
ok "config shape OK (domain/rpID match $PROD_HOST, R2 key present)"

flyctl secrets set CONFIG_JSON="$(cat "$CONFIG_TMP")" --app "$PROD_APP" --stage >/dev/null
ok "CONFIG_JSON staged on $PROD_APP (will apply at next deploy)"

# Note: we leave $CONFIG_TMP for the trap to shred on exit.

# ---------- step 2: ensure prod volume is empty so first boot triggers restore ----

step "STEP 2: Ensure $PROD_APP volume is empty so first boot does a fresh Litestream restore"

# The basny-bap volume was created during testing and has a stale empty
# database.db on it. start.sh skips `litestream restore` if the file exists,
# so we destroy + recreate the volume to guarantee a clean restore.
existing_vols=$(flyctl volumes list --app "$PROD_APP" --json 2>/dev/null \
  | jq -r '.[] | select(.name == "'"$PROD_VOL_NAME"'") | .id')

if [ -n "$existing_vols" ]; then
  warn "Existing $PROD_VOL_NAME volume(s) found: $existing_vols"
  warn "Will destroy these so the next deploy creates a fresh one."
  confirm "Destroy existing $PROD_VOL_NAME volume(s)?"
  for v in $existing_vols; do
    flyctl volumes destroy "$v" --app "$PROD_APP" --yes >/dev/null
    ok "destroyed $v"
  done
fi

flyctl volumes create "$PROD_VOL_NAME" --region "$FLY_REGION" --size 1 \
  --app "$PROD_APP" --yes >/dev/null
new_vol=$(flyctl volumes list --app "$PROD_APP" --json | jq -r '.[0].id')
ok "fresh volume created: $new_vol"

confirm "Volume ready. Ready to begin USER-VISIBLE DOWNTIME at STEP 3?"

# ---------- step 3: stop writes on EC2 -------------------------------------

step "STEP 3: Stop EC2 app container (begins user-visible downtime)"

cutover_start=$(date +%s)
ssh "$EC2_SSH" "cd $EC2_COMPOSE_DIR && sudo docker compose -f docker-compose.prod.yml stop app"
ok "EC2 app stopped"

# ---------- step 4: wait for Litestream to flush ---------------------------

step "STEP 4: Wait 30s for EC2 Litestream to flush the final WAL to R2"
for i in $(seq 30 -1 1); do printf "\rflushing... %2d s remaining" "$i"; sleep 1; done
echo
ok "flush window elapsed"

# Snapshot the EC2 row counts for cross-check after Fly deploy.
ec2_counts=$(ssh "$EC2_SSH" "sudo sqlite3 $EC2_DB \
  \"SELECT COUNT(*) FROM members; SELECT COUNT(*) FROM submissions; SELECT COUNT(*) FROM species_name_group; SELECT COUNT(*) FROM sessions;\"")
echo "$ec2_counts" | awk 'BEGIN{n=split("members submissions species_name_group sessions", t)} {print t[NR]"="$1}' \
  | tee /tmp/ec2-counts-$$.txt
ok "EC2 row counts captured"

# ---------- step 5: deploy production --------------------------------------

step "STEP 5: Deploy $PROD_APP — first boot will Litestream-restore from R2"

flyctl deploy --app "$PROD_APP"
ok "deploy complete"

# Wait for machine to be healthy
for i in $(seq 1 30); do
  state=$(flyctl machines list --app "$PROD_APP" --json | jq -r '.[0].state // ""')
  checks=$(flyctl machines list --app "$PROD_APP" --json | jq -r '.[0].checks[0].status // "unknown"')
  if [ "$state" = "started" ] && [ "$checks" = "passing" ]; then
    ok "machine started and health check passing"
    break
  fi
  printf "\rwaiting for machine: state=%s checks=%s" "$state" "$checks"
  sleep 2
done
echo

# ---------- step 6: verify row counts match --------------------------------

step "STEP 6: Compare Fly row counts to captured EC2 counts"

fly_counts=$(flyctl ssh console --app "$PROD_APP" -C "sqlite3 /mnt/app-data/database/database.db \
  \"SELECT COUNT(*) FROM members; SELECT COUNT(*) FROM submissions; SELECT COUNT(*) FROM species_name_group; SELECT COUNT(*) FROM sessions;\"")

echo "EC2:"; cat /tmp/ec2-counts-$$.txt
echo "Fly:"
echo "$fly_counts" | awk 'BEGIN{n=split("members submissions species_name_group sessions", t)} {print t[NR]"="$1}'

# Strict numeric compare
ec2_norm=$(grep -oE '[0-9]+' /tmp/ec2-counts-$$.txt | tr '\n' ' ')
fly_norm=$(echo "$fly_counts" | grep -oE '[0-9]+' | tr '\n' ' ')
if [ "$ec2_norm" = "$fly_norm" ]; then
  ok "row counts MATCH"
else
  fail "row counts DIVERGE — investigate before continuing"
fi
rm -f /tmp/ec2-counts-$$.txt

confirm "Counts match. Proceed to DNS cutover?"

# ---------- step 7: register the production hostname with Fly --------------

step "STEP 7: Tell Fly to issue a Let's Encrypt cert for $PROD_HOST"

flyctl certs add "$PROD_HOST" --app "$PROD_APP" || warn "(cert may already exist)"
flyctl certs show "$PROD_HOST" --app "$PROD_APP" | sed 's/^/  /'

# ---------- step 8: webmaster DNS flip -------------------------------------

step "STEP 8: WEBMASTER changes the DNS record"
cat <<EOF

  Tell the webmaster to set this record at the registrar:

    ${C_BOLD}$PROD_HOST.   CNAME   basny-bap.fly.dev.${C_RESET}

  TTL: 60s (until cooling-off period ends).

  Once they confirm the change has been saved, press y to continue.

EOF
confirm "Webmaster has saved the DNS change?"

# ---------- step 9: wait for DNS + cert issuance ---------------------------

step "STEP 9: Wait for DNS to resolve to Fly + Let's Encrypt cert to issue"

# Wait up to 5 minutes for the CNAME to point at Fly
for i in $(seq 1 60); do
  resolved=$(dig +short "$PROD_HOST" @1.1.1.1 | tail -1)
  case "$resolved" in
    *fly.dev*|"")
      printf "\rwaiting for CNAME propagation... (%s)" "${resolved:-no answer yet}"
      sleep 5
      ;;
    *)
      # Resolved to an IP. Check if it's a Fly IP.
      if [[ "$resolved" =~ ^66\. ]] || [[ "$resolved" =~ ^2a09: ]] || [[ "$resolved" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo
        ok "DNS resolves to: $resolved"
        break
      fi
      printf "\rresolving to %s, waiting..." "$resolved"
      sleep 5
      ;;
  esac
done
echo

# Wait up to 3 minutes for cert
for i in $(seq 1 36); do
  if flyctl certs show "$PROD_HOST" --app "$PROD_APP" 2>/dev/null | grep -q "Issued"; then
    ok "cert issued"
    break
  fi
  printf "\rwaiting for cert issuance... (%d s)" $((i*5))
  sleep 5
done
echo

# ---------- step 10: smoke tests on production hostname --------------------

step "STEP 10: Smoke test on $PROD_HOST"

curl -fsS -I "https://$PROD_HOST/health" | head -1
ok "/health responding on production hostname"

cutover_end=$(date +%s)
duration=$((cutover_end - cutover_start))
ok "downtime window approx: ${duration}s"

cat <<EOF

${C_GREEN}${C_BOLD}Cutover complete.${C_RESET}

Manual checks to do now in a browser:
  1. Open https://$PROD_HOST and verify the home page renders.
  2. Log in with a passkey (rpID=$PROD_HOST → existing passkeys should work).
  3. Submit a small test record. Verify it persists.
  4. Spot-check: open a submission detail page that has an image to confirm
     R2 image fetch still works.

Leave EC2 STOPPED but NOT terminated for at least 24-48 hours as
rollback insurance. To roll back: flip DNS back to the old EC2 IP and
restart the EC2 app container. (See docs/FLY_MIGRATION.md § Rollback Plan.)

Watch for issues:
  flyctl logs --app $PROD_APP

When you are confident (~7 days), run Phase 5 from the playbook to
decommission AWS.
EOF
