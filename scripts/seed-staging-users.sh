#!/usr/bin/env bash
#
# Seed known test accounts into the STAGING database.
#
# Staging restores a read-only copy of prod data on boot and never replicates
# back (STAGING=1 in fly.staging.toml). Prod has no test logins, and every
# prod->staging refresh wipes the DB -- so re-run this after each refresh to
# recreate the accounts. Idempotent: safe to run repeatedly.
#
#   Refresh staging data (see docs/DEPLOY.md "Refreshing Staging Data"):
#     MACHINE=$(flyctl machines list --app basny-bap-staging --json | jq -r '.[0].id')
#     flyctl ssh console --app basny-bap-staging \
#       -C "rm -f /mnt/app-data/database/database.db /mnt/app-data/database/database.db-shm /mnt/app-data/database/database.db-wal"
#     flyctl machine restart "$MACHINE" --app basny-bap-staging
#   Then: ./scripts/seed-staging-users.sh
#
# Accounts created (same creds the E2E suite uses -- see e2e/helpers/testData.ts):
#   admin     baptest+admin@porcnick.com / AdminPassword123!
#   non-admin baptest+e2e@porcnick.com   / TestPassword123!
#
# Password hashing MUST match src/auth.ts makePasswordEntry():
#   scrypt N=16384 r=8 p=1, keyLen=32, salt=16 random bytes, salt+hash base64.
set -euo pipefail

APP="basny-bap-staging"
DB_PATH="/mnt/app-data/database/database.db"

ADMIN_EMAIL="baptest+admin@porcnick.com";  ADMIN_NAME="Staging Test Admin";  ADMIN_PW="AdminPassword123!"
USER_EMAIL="baptest+e2e@porcnick.com";     USER_NAME="Staging Test User";    USER_PW="TestPassword123!"

# Generate a "salt_b64 hash_b64" pair for a password, matching src/auth.ts exactly.
gen_entry() {
  node -e '
    const { randomBytes, scryptSync } = require("node:crypto");
    const salt = randomBytes(16);
    const hash = scryptSync(process.argv[1], salt, 32, { N: 16384, r: 8, p: 1 });
    // Trailing newline required: `read` returns non-zero on an unterminated line,
    // which `set -e` would treat as fatal.
    console.log(salt.toString("base64") + " " + hash.toString("base64"));
  ' "$1"
}

read -r ADMIN_SALT ADMIN_HASH < <(gen_entry "$ADMIN_PW")
read -r USER_SALT  USER_HASH  < <(gen_entry "$USER_PW")

# Idempotent upsert. contact_email is UNIQUE; password_account.member_id is PK.
SQL=$(cat <<SQL
PRAGMA foreign_keys = ON;
BEGIN;
INSERT INTO members (contact_email, display_name, is_admin) VALUES ('${ADMIN_EMAIL}', '${ADMIN_NAME}', 1)
  ON CONFLICT(contact_email) DO UPDATE SET display_name = excluded.display_name, is_admin = excluded.is_admin;
INSERT INTO members (contact_email, display_name, is_admin) VALUES ('${USER_EMAIL}', '${USER_NAME}', 0)
  ON CONFLICT(contact_email) DO UPDATE SET display_name = excluded.display_name, is_admin = excluded.is_admin;
INSERT INTO password_account (member_id, N, r, p, salt, hash)
  VALUES ((SELECT id FROM members WHERE contact_email = '${ADMIN_EMAIL}'), 16384, 8, 1, '${ADMIN_SALT}', '${ADMIN_HASH}')
  ON CONFLICT(member_id) DO UPDATE SET N=excluded.N, r=excluded.r, p=excluded.p, salt=excluded.salt, hash=excluded.hash;
INSERT INTO password_account (member_id, N, r, p, salt, hash)
  VALUES ((SELECT id FROM members WHERE contact_email = '${USER_EMAIL}'), 16384, 8, 1, '${USER_SALT}', '${USER_HASH}')
  ON CONFLICT(member_id) DO UPDATE SET N=excluded.N, r=excluded.r, p=excluded.p, salt=excluded.salt, hash=excluded.hash;
COMMIT;
SELECT id, contact_email, is_admin FROM members WHERE contact_email IN ('${ADMIN_EMAIL}', '${USER_EMAIL}');
SQL
)

# Remote script: refuse unless this is genuinely a STAGING machine, then apply
# the SQL. Base64 the whole thing so nothing needs shell-escaping over ssh.
REMOTE=$(cat <<REMOTE
if [ "\$STAGING" != "1" ]; then
  echo "REFUSING: \$FLY_APP_NAME is not a STAGING machine (STAGING != 1)" >&2
  exit 3
fi
printf %s '$(printf '%s' "$SQL" | base64 -w0)' | base64 -d | sqlite3 '${DB_PATH}'
REMOTE
)

echo "Seeding test users into ${APP} (${DB_PATH})..."

# flyctl ssh needs a running VM. Staging is scale-to-zero and HTTP-only auto-start
# (fly-proxy wakes it on a request, but ssh does not), so start it explicitly.
MACHINE=$(flyctl machines list --app "$APP" --json | jq -r '.[0].id')
echo "Ensuring machine ${MACHINE} is started..."
flyctl machine start "$MACHINE" --app "$APP" >/dev/null 2>&1 || true

flyctl ssh console --app "$APP" -C "/bin/sh -c 'echo $(printf '%s' "$REMOTE" | base64 -w0) | base64 -d | /bin/sh'"
echo
echo "Done. Log in at https://${APP}.fly.dev with:"
echo "  admin     ${ADMIN_EMAIL} / ${ADMIN_PW}"
echo "  non-admin ${USER_EMAIL} / ${USER_PW}"
