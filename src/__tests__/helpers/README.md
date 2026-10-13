# Test databases and fixtures

Use `createTestDatabase` from `./helpers/database` for disposable SQLite databases.
It returns the same `{ db, cleanup, migrate }` context for every suite. Both
`foreignKeys` and `migrations` are required; creating a database never creates
Member fixtures. Migrations may seed catalogue/schema data as they do in production.

```typescript
import { beforeEach, afterEach, test } from "node:test";
import { createTestDatabase, type TestDatabase } from "./helpers/database";
import { createTestMember } from "./helpers/fixtures";

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
});
afterEach(async () => {
  await database.cleanup();
});
test("a member", async () => {
  const member = await createTestMember({ displayName: "Jane" });
  // Exercise the application with member.id.
});
```

## Constraint modes and lifecycle

Use `foreignKeys: "on"` when enforcing referential integrity is part of the test.
Use `"off"` explicitly for production-like constraint behavior or intentional
impossible-state regressions. Existing suites retain their previous modes.
Builders never change PRAGMAs. Do not make constraint changes incidentally by
choosing a different fixture helper.

The factory installs the global database connection after successful migration.
Database suites must run **serially within a process**: separate contexts do not
make the global override safe for concurrent tests. `npm test` keeps the existing
runner settings. `installConnection: false` creates a standalone historical/raw
database without changing the application's current connection.

Always call `cleanup()` in teardown or `finally`. It is idempotent after a
successful close, closes connections after failed setup, and reports unexpected
close errors (for example, outstanding prepared statements). It does not silently
hide resource leaks. Importing the factory or fixtures does not open or migrate
the configured on-disk database; database initialization is explicitly lazy.

## Named fixture builders

`fixtures.ts` holds Member, committee and Species builders, separate from database
ownership:

- `createTestMember(options?)` creates one regular Member with a unique email.
- `createTestMembers(count?)` creates the requested number of Members.
- `createTestCommitteeMember(db, options?)` creates one Member with `is_admin = 1`.
- `createTestActors(db, { adminCount?: 1 | 2, memberCount? })` explicitly creates a
  regular Member and committee member, optionally extra actors. Combine its result
  with a database context when a suite wants `TestContext`.
- `createTestSpeciesName(db, ...)` and `ensureGuppySpecies(db)` create only Species
  and Names, never Members.

For valid Submission states use `submissionInState` from `lifecycleFixtures.ts`,
with the existing `assertSubmissionInvariantsHold` from `assertInvariants.ts`.
Lifecycle tests still exercise real transitions. `createRawSubmissionFixture`
explicitly writes raw rows for reporting fixtures, historical states and
impossible-state regressions; it deliberately does not enforce lifecycle rules.
The form-based `createSubmissionFixture` and `approveSubmissionFixture` remain
available for existing fixture flows. Keep intentional raw SQL visible in tests
when the real schema or lifecycle cannot represent the scenario.

```typescript
const database = await createTestDatabase({ foreignKeys: "off", migrations: "latest" });
const ctx = { ...database, ...await createTestActors(database.db, { adminCount: 2 }) };
// ctx.db, ctx.member, ctx.admin, ctx.otherAdmin, ctx.cleanup()
```

## Historical migrations and raw schemas

The factory owns migration execution and temporary cutoff directories, including
cleanup when a migration fails. Cutoffs are inclusive; moving backwards runs the
same migrator's down steps.

```typescript
const historical = await createTestDatabase({ foreignKeys: "on", migrations: 56 });
try {
  // Intentional historical SQL goes here, before the canonical-name migration.
  await historical.migrate(57);
  await historical.migrate(); // latest
  await historical.migrate(56); // roll back to the old shape
} finally {
  await historical.cleanup();
}
```

Use `migrations: false` only when a test intentionally builds a minimal/raw schema,
such as transaction primitives or invalid legacy data that current migrations
forbid. Ordinary database creation and teardown belong in the factory.
