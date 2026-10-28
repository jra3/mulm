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
HOST=https://bap.basny.org   # or https://basny-bap-staging.fly.dev
curl -sf "$HOST/health" >/dev/null   # staging: wake it first, ssh won't
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

## Species

Ports the species MCP tools (`src/mcp/species-server-core.ts`) onto the same catalogue, enrichment and IUCN operations. Code: `src/routes/api/admin/species.ts`. Every path below is under `/api/admin/species`.

Conventions for this section:

- Bodies are JSON. Unknown fields are ignored. A body or query that fails validation is `400 bad_request` with every issue in `message`.
- `404 not_found` when the Species, Name or recommendation doesn't exist. `409 conflict` when the catalogue refuses: a duplicate Name or Canonical name, editing or removing a Canonical name as a plain Name, deleting a Species something references.
- Deletes answer `204` with no body. Creates answer `201`.
- Query booleans are `true` or `false`.
- `{species}` in a response is the Species detail: `group_id`, `program_class`, `species_type`, `canonical_genus`, `canonical_species_name`, `base_points`, `is_cares_species` (0/1), the `iucn_*` fields, `external_references`, `image_links`, `images`, and `names: { common: [Name], scientific: [Name] }`, where a Name is `{ name_id, species_id, kind, name, canonical }`.

Setup for the examples:

```bash
BAP=https://bap.basny.org/api/admin
AUTH="Authorization: Bearer $(cat ~/.config/basny/admin-token)"
```

### Species

| Method | Path | Body or query | Returns |
|---|---|---|---|
| GET | `/` | `q`, `species_type`, `program_class`, `has_base_points`, `is_cares_species`, `iucn_category` (a category, `with_data` or `missing`), `sort` (`name`, `points`, `class`), `limit` (100), `offset` (0), `count_only` | `200 { total_count, species: [{ group_id, program_class, canonical_genus, canonical_species_name, species_type, base_points, is_cares_species, name_count }] }`; with `count_only=true`, `{ total_count }` |
| GET | `/:id` | | `200 {species}` |
| POST | `/` | `program_class`, `canonical_genus`, `canonical_species_name`, `species_type` (`Fish`, `Plant`, `Invert`, `Coral`); optional `base_points` (5, 10, 15, 20 or null), `is_cares_species` | `201 {species}` with `Location` |
| PATCH | `/:id` | at least one of `program_class`, `base_points` (5, 10, 15, 20 or null), `is_cares_species` | `200 {species}` |
| PATCH | `/:id/canonical-name` | `canonical_genus`, `canonical_species_name` or both | `200 {species}`; the old Canonical name stays as a scientific Name |
| DELETE | `/:id` | | `204`; `409` while a Submission, collection entry or CARES record references it (merge instead) |

```bash
curl -s -H "$AUTH" "$BAP/species?q=betta&limit=5"
curl -s -H "$AUTH" "$BAP/species/123"
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "$BAP/species" \
  -d '{"program_class":"Cichlids","canonical_genus":"Apistogramma","canonical_species_name":"cacatuoides","species_type":"Fish","base_points":15}'
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PATCH "$BAP/species/123" -d '{"is_cares_species":true}'
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PATCH "$BAP/species/123/canonical-name" -d '{"canonical_genus":"Nannacara"}'
curl -s -H "$AUTH" -X DELETE "$BAP/species/123" -w '%{http_code}\n'
```

### Point classes in bulk

`POST /point-class` with `base_points` (5, 10, 15 or 20), optional `preview`, and either `group_ids` or `species_type`/`program_class` filters (not both). Returns `200 { preview, updated_count, species: [{ group_id, canonical_name, old_points, new_points }] }`. With `preview: true` nothing is written.

```bash
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "$BAP/species/point-class" \
  -d '{"program_class":"Livebearers","base_points":5,"preview":true}'
```

### External data

`PUT /:id/external-data` with `external_references` (URLs), `image_links` (URLs) or both. Each list given **replaces** that list outright, in the order given; `[]` clears it. A list left out is untouched. Every call stamps the Species' last external sync. Returns `200 { group_id, external_references, image_links, last_external_sync }`.

```bash
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PUT "$BAP/species/123/external-data" \
  -d '{"external_references":["https://www.fishbase.se/summary/4768"],"image_links":[]}'
```

### Merging

`POST /:id/merge` with `defunct_group_id` and optional `preview`. `:id` is the Species kept. The defunct Species' Names move (deduplicated), its Canonical name is kept as a scientific Name, and its Submissions, collection entries, CARES records, images and links move to the kept Species; then it is deleted. Returns `200` with what moves: `canonical_name`, `defunct_name`, `common_names_to_move`, `scientific_names_to_move`, `*_already_held`, `submissions_to_update`, `approved_submissions_to_update`, `references_to_move`, `canonical_becomes_cares`, `members_keeping_both`. Merging a Species into itself is `400`.

```bash
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "$BAP/species/123/merge" \
  -d '{"defunct_group_id":456,"preview":true}'
```

### Names

Name ids are unique within a kind, so a Name's path carries its kind: `common` or `scientific`.

| Method | Path | Body or query | Returns |
|---|---|---|---|
| POST | `/:id/names` | `kind`, `name` | `201 { kind, name_id, group_id, name }`; `409` if the Species has it |
| GET | `/names` | `text` (exact, any case), optional `kind`, `limit` | `200 { text, count, names: [Name + canonical_name, program_class] }` |
| PATCH | `/names/:kind/:nameId` | `name` | `200 { kind, name_id, name }`; keeps its id, so Submissions still reference it; `409` on a Canonical name |
| DELETE | `/names/:kind/:nameId` | | `204`; `409` on a Canonical name |
| POST | `/names/bulk-remove` | `kind`, exactly one of `text` or `name_ids`, optional `preview` | `200 { preview, kind, count }` (preview adds `names` or `name_ids`); all or nothing, `409` if any is a Canonical name |

```bash
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "$BAP/species/123/names" -d '{"kind":"common","name":"Cockatoo cichlid"}'
curl -s -H "$AUTH" "$BAP/species/names?text=cockatoo%20cichlid"
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PATCH "$BAP/species/names/common/987" -d '{"name":"Cockatoo dwarf cichlid"}'
curl -s -H "$AUTH" -X DELETE "$BAP/species/names/common/987" -w '%{http_code}\n'
```

### IUCN Red List status

| Method | Path | Body or query | Returns |
|---|---|---|---|
| GET | `/iucn/stats` | | `200 { total_syncs, successful_syncs, not_found_count, error_count, last_sync_date }` |
| GET | `/iucn/missing` | | `200 { total_count, species }`: Species with no IUCN data |
| GET | `/iucn/stale` | `days_old` (365) | `200 { total_count, days_old, species }` |
| GET | `/iucn/sync-log` | `group_id`, `limit` (100) | `200 { total_count, entries }`, newest first |
| POST | `/iucn/sync` | exactly one of `group_ids`, `missing: true`, `days_old`; `limit` (10), `preview` | `200 { preview: false, total_count, success_count, not_found_count, error_count, results: [{ group_id, scientific_name, status, category, error }] }`; with `preview: true`, `{ preview, total_count, species: [{ group_id, canonical_name }] }` |

`POST /iucn/sync` calls the IUCN API once per Species, so keep `limit` small. It is `503 unavailable` if the IUCN integration is off in config, and `404` if a `group_ids` entry doesn't exist.

```bash
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "$BAP/species/iucn/sync" -d '{"missing":true,"limit":5,"preview":true}'
```

### Canonical name recommendations

IUCN sometimes knows a Species by another name; those suggestions wait here for review.

| Method | Path | Body or query | Returns |
|---|---|---|---|
| GET | `/canonical-recommendations` | `group_id`, `status` (`pending`, `accepted`, `rejected`), `limit` | `200 { total_count, recommendations: [{ id, group_id, current_name, suggested_name, iucn_taxon_id, iucn_url, reason, status, created_at, reviewed_at, reviewed_by }] }` |
| POST | `/canonical-recommendations/:id/accept` | | `200 { recommendation_id, status: "accepted", reviewed_by }`; renames the Species, keeping the old Canonical name as a scientific Name |
| POST | `/canonical-recommendations/:id/reject` | | `200 { recommendation_id, status: "rejected", reviewed_by }` |

`reviewed_by` is the token's admin. Accepting or rejecting one that is not pending is `404`; accepting a name another Species holds is `409`.

```bash
curl -s -H "$AUTH" "$BAP/species/canonical-recommendations?status=pending"
curl -s -H "$AUTH" -X POST "$BAP/species/canonical-recommendations/7/accept"
```
