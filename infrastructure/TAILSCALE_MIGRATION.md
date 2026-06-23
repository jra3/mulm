# Tailscale SSH Access — Superseded

> **This document is obsolete.** It described migrating SSH access to the AWS EC2
> production box onto Tailscale. Production has since moved to **Fly.io**, and
> there is **no public SSH box** to reach.

## What replaced it

Shell access to production is now via Fly's own access model — no Tailscale, no
SSH keys, no security-group rules:

```bash
# Open a shell on the running production machine
flyctl ssh console --app basny-bap

# Run a one-off command without an interactive shell
flyctl ssh console --app basny-bap -C "sqlite3 /mnt/app-data/database/database.db"
```

`flyctl ssh console` tunnels over Fly's WireGuard-based private network and
authenticates with your `flyctl` login (`flyctl auth login`). That's the only
access path you need.

There is no separate emergency-access mechanism to configure: any machine with a
valid `flyctl` login on the org can reach the app.

## What's still useful

Nothing in the old EC2/Tailscale/SSM procedure carries over. If you previously
relied on `ssh BAP`, replace it with `flyctl ssh console --app basny-bap`.

## References

- [`docs/INFRASTRUCTURE.md`](../docs/INFRASTRUCTURE.md) — "Access" and "Common
  Ops" sections
- [`docs/DEPLOY.md`](../docs/DEPLOY.md) — deploy/verify runbook
- [Fly `flyctl ssh console`](https://fly.io/docs/flyctl/ssh-console/)
