# Backend Architecture

The Portal is the BAS single-society awards application. Read [the domain glossary](../CONTEXT.md) for vocabulary and rule ownership; the focused READMEs below describe the implementation.

## Application composition and startup

[`app.ts`](app.ts) exports `createApp({ env?, config? })`, which builds the Express middleware stack and registers routes without opening a database, listening, initializing R2, or starting background jobs. Its configuration override covers composition settings only; repositories and external providers still use the process-wide configuration.

[`bootstrap.ts`](bootstrap.ts) owns startup and teardown: it awaits database readiness, initializes storage and MCP, listens, and starts scheduled jobs in live production. [`index.ts`](index.ts) installs the compiled module alias, calls bootstrap and handles shutdown signals. Tests exercising HTTP routes use `createApp` with a test-owned database; importing the entry point starts the process.

Database users must `await ensureReady()` from `@/db/conn` before repository operations. Tests install their disposable connection first. See [connection lifecycle and transactions](db/README.md).

## Module ownership

- [`species/`](species/README.md) owns the Species catalogue; import its public interface from `@/species`.
- [`lifecycle/`](lifecycle/README.md) owns Submission state transitions, permissions and consequences; import from `@/lifecycle`.
- [`db/`](db/README.md) contains repositories and SQLite connection/query helpers.
- [`routes/`](routes/README.md) contains HTTP handlers and routers; [`forms/`](forms/) contains Zod schemas and form helpers.
- [`sessions.ts`](sessions.ts) owns session cookies, session loading and request viewer typing.
- [`programs.ts`](programs.ts), [`levelManager.ts`](levelManager.ts), [`specialtyAwards.ts`](specialtyAwards.ts) and [`specialtyAwardManager.ts`](specialtyAwardManager.ts) own point-class ladders, levels and Specialty awards.
- [`notifications.ts`](notifications.ts) coordinates notification emails; [`services/emailService.ts`](services/emailService.ts) handles delivery. [`services/media.ts`](services/media.ts) handles submission media.
- [`integrations/`](integrations/README.md), [`scheduled/`](scheduled/README.md) and [`mcp/`](mcp/README.md) document external providers, jobs and MCP tools.
- [`views/`](views/README.md) describes Pug templates and HTMX conventions.

Use static ES imports. Validate form data with the actual Zod schema before passing it into a domain operation; do not assert a request body into a trusted type. For example, [`routes/submission.ts`](routes/submission.ts) uses `bapForm`/`bapDraftForm` from `forms/submission.ts` and calls the lifecycle interface. It does not implement an independent approval workflow.

## Sessions and authentication

Import `MulmRequest` from `@/sessions`. `sessionMiddleware` loads an unexpired SQLite session and populates the optional `req.viewer`, whose fields are `id`, `display_name`, `contact_email`, and optional `is_admin`, `fish_level`, `plant_level`, `coral_level`. The session's CSRF token is exposed as `req.csrfToken` and `res.locals.csrfToken`.

Member-only handlers check `req.viewer` explicitly and use `viewer.id`; see `viewAccountSettings` in [`routes/account.ts`](routes/account.ts). [`routes/adminRouter.ts`](routes/adminRouter.ts) installs `requireAdmin` from `routes/admin.ts` once for its routes (401 without a viewer, 403 for a non-admin). Do not repeat that admin-role check inside its handlers. Domain operations still enforce ownership and legal transitions.

Authentication implementations are:

- Password hashing: `makePasswordEntry(password)` and `checkPassword(entry, password)` in [`auth.ts`](auth.ts), using scrypt.
- Google OAuth: [`oauth.ts`](oauth.ts).
- Sign in with Apple: [`auth/apple.ts`](auth/apple.ts).
- HTTP authentication handlers: [`routes/auth.ts`](routes/auth.ts).

The middleware order and OAuth callback exceptions live in `app.ts`. See [routing](routes/README.md) for CSRF and request conventions.

## Tests

Use `createTestDatabase({ foreignKeys: "on" | "off", migrations: "latest" | number | false })` from `src/__tests__/helpers/database.ts`. It owns a disposable in-memory SQLite connection, installs it for repositories by default, and returns `{ db, cleanup, migrate }`. Always call `cleanup()` in teardown. Choose the migration cutoff and foreign-key behavior explicitly; named fixture builders create Members, committee members and Species separately.

Tests sharing the process-wide connection override run serially within a process. A database can be scoped to a test or suite; it is not automatically replaced for every test. See [test databases and fixtures](__tests__/helpers/README.md) for setup examples, historical schemas and lifecycle fixtures. See [E2E testing](../e2e/README.md) for Playwright setup.

```bash
npm test              # Node test runner, NODE_ENV=test
npm run typecheck     # Application, tests, MCP and sample configuration
npm run lint
npm run test:e2e      # Playwright
```

## Configuration

[`config.d.json.ts`](config.d.json.ts) exports the authoritative nested `Config` interface and the default JSON value type. Both `@/config.json` and relative `./config.json` / `../config.json` imports resolve this declaration. The required groups are `database`, `server`, `email` and `storage`; OAuth providers, external-data integrations and MCP remain optional. Consumers retain their existing defaults.

Use [`config.sample.json`](config.sample.json) as the starting point for a new local `src/config.json` (git-ignored). It contains placeholder credentials and disables email. Do not overwrite an existing local configuration or commit credentials. [`__tests__/config.typecheck.ts`](__tests__/config.typecheck.ts) checks the sample's inferred JSON shape and consistent import types during `npm run typecheck`; it does not load live configuration or add runtime validation. `tsconfig.json` explicitly includes the runtime JSON so compilation still copies it to `dist/src/config.json` alongside its consumers.

Production receives `CONFIG_JSON` as a Fly secret; [`start.sh`](../start.sh) writes `/app/src/config.json` on boot. The deployed database path is `/mnt/app-data/database/database.db`. See [infrastructure documentation](../infrastructure/README.md) for deployment details.

For logging, import `logger` from `@/utils/logger`; it suppresses output when `NODE_ENV=test`. Date display helpers live in `utils/dateFormat.ts`.
