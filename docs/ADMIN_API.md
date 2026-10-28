# Admin API

A JSON API under `/api/admin` for scripts that act as an admin (#595). It authenticates with an **admin API token** only, sent as `Authorization: Bearer <token>`. The session cookie never works here, so CSRF and Origin checks don't apply.

- A token acts as the admin it was minted for, with no scopes. Every request re-checks that the member is still an admin; a demoted admin's tokens get `403`.
- Tokens look like `basny_` plus 43 base64url characters. The table (`admin_api_tokens`) stores only the SHA-256; the token is shown once, at mint.
- No expiry unless you pass `--expires-days`. Revoked tokens stay listed.
- 120 requests per minute per IP. Errors are JSON: `{ "error": "unauthorized", "message": "…" }` with `400`, `401`, `403`, `404`, `429` or `500`.
- Code: `src/db/adminTokens.ts` (tokens), `src/middleware/adminApiAuth.ts` (bearer check), `src/routes/api/admin.ts` (endpoints), `src/cli/admin-token.ts` (CLI).

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/admin/whoami` | `{ member: { id, display_name }, token: { id, name, created_at, expires_at } }` |

## Minting a token

The `admin-token` CLI runs inside the app's container, where it is compiled to `/app/src/cli/admin-token.js`. Run it as the `nodejs` user so the database files stay the app's:

```bash
APP=basny-bap   # or basny-bap-staging
curl -sf https://bap.basny.org/health >/dev/null   # staging: wake it first, ssh won't
flyctl ssh console --app $APP -C "su nodejs -s /bin/sh -c 'cd /app && node src/cli/admin-token.js mint --member you@example.com --name laptop'"
```

`--member` takes a member id or email; the member must be an admin. Add `--expires-days 90` for a token that expires. The token is the `basny_…` line; nothing else ever shows it again. Store it locally with mode 600:

```bash
mkdir -p ~/.config/basny
install -m 600 /dev/null ~/.config/basny/admin-token
pbpaste > ~/.config/basny/admin-token   # or paste it in with an editor
```

To save it straight from the ssh output instead:

```bash
flyctl ssh console --app $APP -C "su nodejs -s /bin/sh -c 'cd /app && node src/cli/admin-token.js mint --member you@example.com --name laptop'" \
  | tr -d '\r' | grep -o 'basny_[A-Za-z0-9_-]*' > ~/.config/basny/admin-token
chmod 600 ~/.config/basny/admin-token
```

## Using it

```bash
curl -s -H "Authorization: Bearer $(cat ~/.config/basny/admin-token)" \
  https://bap.basny.org/api/admin/whoami
```

## Listing and revoking

```bash
flyctl ssh console --app $APP -C "su nodejs -s /bin/sh -c 'cd /app && node src/cli/admin-token.js list'"
flyctl ssh console --app $APP -C "su nodejs -s /bin/sh -c 'cd /app && node src/cli/admin-token.js revoke 3'"
```

`list` shows each token's id, name, owner, created, last used, expiry and state, never the token. Revoking takes effect on the next request. To rotate, mint a new token, switch to it, then revoke the old one.

Locally, against the database in `src/config.json`: `npm run admin-token -- list` (same arguments).

## Staging

Staging restores prod's database, which carries prod's token hashes. `start.sh` deletes every token from the restored copy before swapping it in, so prod tokens never work on staging. Mint staging tokens for `baptest+admin@porcnick.com`; the next refresh from prod deletes them.
