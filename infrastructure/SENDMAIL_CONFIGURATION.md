# Email Configuration (Fly.io)

How the BAP app sends email in production. Production runs on Fly.io; see
[`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md) for topology.

> **The EC2-era `ssmtp`/sendmail relay is gone.** There is no `/etc/ssmtp/`,
> no system `sendmail` binary, and no cron-driven mail on a long-lived host.
> The application sends mail directly over SMTP using credentials from its
> config.

## Where the SMTP settings live

All runtime config is delivered as a single Fly secret named **`CONFIG_JSON`**.
On every boot, `start.sh` materializes it to `/app/src/config.json`. SMTP
settings live in the **`email`** block of that config.

To view or change email settings you edit your local `config.production.json`
and push it as the secret — you do **not** edit a file on a server.

```bash
# Update the whole config (including the email block); triggers a rolling restart
flyctl secrets set CONFIG_JSON="$(cat config.production.json)" --app basny-bap
```

The `email` block holds the SMTP host/port, credentials, and the from/admin
addresses the app uses for outbound mail. (The exact field names are whatever the
app's config schema expects; treat `config.production.json` as the source of
truth.)

## Staging

On `basny-bap-staging`, the `CONFIG_JSON` override sets `email.disableEmails =
true`, so staging never sends real mail. See the configuration table in
`docs/INFRASTRUCTURE.md`.

## Verifying email

There's no host shell mail command to test. Verify through the application:

```bash
# Confirm the app is up and serving
curl -sf https://bap.basny.org/health

# Watch logs while exercising a flow that sends mail (e.g. a notification)
flyctl logs --app basny-bap
```

If mail fails, the app logs the SMTP error — check `flyctl logs`. Common causes
are the same as anywhere: wrong credentials, wrong host/port, or the relay
rejecting the from-address. Fix the `email` block in `config.production.json` and
re-push the `CONFIG_JSON` secret.

## Rotating SMTP credentials

1. Update the `email` block in your local `config.production.json`.
2. Re-push the secret:
   ```bash
   flyctl secrets set CONFIG_JSON="$(cat config.production.json)" --app basny-bap
   ```
   Setting the secret triggers a rolling restart automatically.
3. Verify via `flyctl logs --app basny-bap` while exercising an email flow.

## References

- [`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md) — `CONFIG_JSON`,
  configuration table, staging overrides
- [`docs/DEPLOY.md`](../docs/DEPLOY.md) — "Secrets / Config Changes"
- [`DATABASE_MONITORING.md`](./DATABASE_MONITORING.md) — health checks
