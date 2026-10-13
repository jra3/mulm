# Portal app construction and startup

`src/app.ts` exports `createApp({ env, config })`. It returns the real Express
middleware/router/view stack; it does not initialize SQLite/R2, listen, start
MCP, or schedule jobs. `env` defaults to a snapshot of `process.env` and controls
HTTP policy: production proxy trust/HSTS, session cookie names and attributes,
Origin allowlists, rate-limit test bypasses, and development routes. `config`
optionally supplies the composition's domain and bug-report email. Provider
credentials, notifications, and repository configuration remain process-wide;
this is not a service dependency container. Set `NODE_ENV=test` in test processes
so notification code also disables real email.

`src/index.ts` is the executable (`npm run dev`, or `npm start` after building).
It invokes `bootstrap()` from `src/bootstrap.ts`, then installs SIGTERM/SIGINT
handlers. Bootstrap awaits memoized database initialization/migrations before
initializing R2 and starting MCP and the Portal HTTP listener. Initialization or
bind failure rejects startup and unwinds resources already acquired. Jobs start
only with `NODE_ENV=production` and `STAGING` other than `1`.

For a programmatic server, `await bootstrap({ port: 0, host: "127.0.0.1" })`
returns `{ app, server, stop }`. Await `stop()` in a `finally` block. It is
idempotent, cancels both first-run job timeouts and recurring intervals, waits
for running scheduled work, closes listeners, destroys the R2 client, and closes
the configured database handles. Database initialization/shutdown is terminal
within a process; use a new process to restart. Cleanup failures are reported
without skipping the remaining resources. Tests may replace bootstrap's narrow
`effects` services (`database`, `storage`, `mcp`, `jobs`), each with `start` and
`stop`, to exercise startup failures without external services.

Full-app Supertest tests install a disposable SQLite connection with
`overrideConnection(db)` **before** calling `ensureReady()`, then use
`createApp({ env: { NODE_ENV: "test" } })`. The fixture owns its connection and
must close it after requests finish; bootstrap never closes fixture overrides.
Repositories still share one global connection. Separate apps cannot use
independent databases concurrently in one process. Browser tests using a server
process should configure that process's disposable file before bootstrap and
close the server before deleting the file. See `app-composition.test.ts`,
`bootstrap.test.ts`, and `scheduled-teardown.test.ts` for executable examples.
