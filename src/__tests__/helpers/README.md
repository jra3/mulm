# Test Helper Utilities

Centralized testing utilities for Mulm BAP to reduce boilerplate and establish consistent testing patterns across the codebase.

## Features

- 🗄️ **Database Setup/Teardown** - Automatic in-memory database with migrations
- 🏭 **Fixture Factories** - Easy creation of test members, submissions, and species
- ✅ **Assertion Helpers** - Specialized assertions for submission states
- 🎯 **Mock Data** - Pre-configured mock approval data and species IDs
- 📝 **Type-Safe** - Full TypeScript support with interfaces

## Quick Start

```typescript
import { describe, test, beforeEach, afterEach } from "node:test";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  type TestContext,
} from "./helpers/testHelpers";

void describe("My Test Suite", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void test("my test", async () => {
    const submissionId = await createTestSubmission(ctx.db, {
      memberId: ctx.member.id,
      submitted: true,
    });
    // ... test logic
  });
});
```

## API Reference

### Database Management

#### `setupTestDatabase(options?)`

Sets up an in-memory test database with migrations and test users.

**Parameters:**
- `options.adminCount` - Number of admin users (1-3, default: 1)
- `options.memberCount` - Number of regular members (default: 1)
- `options.enableForeignKeys` - Enable FK constraints (default: false)

**Returns:** `TestContext`

**Example:**
```typescript
// Single admin and member (default)
const ctx = await setupTestDatabase();

// Two admins, one member
const ctx = await setupTestDatabase({ adminCount: 2 });

// With foreign key enforcement
const ctx = await setupTestDatabase({ enableForeignKeys: true });
```

#### `teardownTestDatabase(ctx)`

Closes the database connection and cleans up resources.

**Example:**
```typescript
await teardownTestDatabase(ctx);
```

### Fixture Factories

#### `createTestSubmission(db, options)`

Creates a test submission in any state of the workflow.

**Parameters:**
```typescript
interface CreateSubmissionOptions {
  // Required
  memberId: number;

  // State flags
  submitted?: boolean;
  witnessStatus?: "pending" | "confirmed" | "declined";
  approved?: boolean;
  denied?: boolean;
  changesRequested?: boolean;

  // Related user IDs
  witnessedBy?: number;
  approvedBy?: number;
  deniedBy?: number;
  changesRequestedBy?: number;

  // Points and bonuses
  points?: number;
  articlePoints?: number;
  firstTimeSpecies?: boolean;
  caresSpecies?: boolean;

  // Species details
  speciesType?: "Fish" | "Plant" | "Invert" | "Coral";
  speciesClass?: string;
  commonName?: string;
  latinName?: string;
  program?: "fish" | "plant" | "coral";

  // Submission details
  reproductionDate?: string;
  foods?: string; // JSON array
  spawnLocations?: string; // JSON array
}
```

**Examples:**

```typescript
// Draft submission
const draftId = await createTestSubmission(ctx.db, {
  memberId: ctx.member.id,
});

// Submitted, not witnessed
const submittedId = await createTestSubmission(ctx.db, {
  memberId: ctx.member.id,
  submitted: true,
});

// Witnessed and ready for approval
const witnessedId = await createTestSubmission(ctx.db, {
  memberId: ctx.member.id,
  submitted: true,
  witnessStatus: "confirmed",
  witnessedBy: ctx.admin.id,
});

// Fully approved
const approvedId = await createTestSubmission(ctx.db, {
  memberId: ctx.member.id,
  submitted: true,
  witnessStatus: "confirmed",
  witnessedBy: ctx.admin.id,
  approved: true,
  approvedBy: ctx.admin.id,
  points: 15,
  articlePoints: 5,
  firstTimeSpecies: true,
});

// Plant submission
const plantId = await createTestSubmission(ctx.db, {
  memberId: ctx.member.id,
  speciesType: "Plant",
  speciesClass: "Aquatic Plants",
  commonName: "Amazon Sword",
  latinName: "Echinodorus amazonicus",
  program: "plant",
});
```

#### `createTestMember(options?)`

Creates an additional test member.

**Parameters:**
```typescript
interface CreateMemberOptions {
  displayName?: string;
  email?: string;
  isAdmin?: boolean;
}
```

**Example:**
```typescript
const newMember = await createTestMember({
  displayName: "Jane Doe",
  email: "jane@test.com",
});
```

### Assertion Helpers

#### `assertSubmissionState(submission, expected)`

Asserts that a submission is in the expected state.

**Parameters:**
```typescript
interface ExpectedState {
  submitted?: boolean;
  witnessed?: boolean;
  approved?: boolean;
  denied?: boolean;
}
```

**Example:**
```typescript
const submission = await getSubmissionById(submissionId);

assertSubmissionState(submission, {
  submitted: true,
  witnessed: true,
  approved: false,
});
```

### Mock Data

#### `mockApprovalData`

Pre-configured approval data for testing.

```typescript
const mockApprovalData = {
  id: 0,
  group_id: 1,
  points: 10,
  article_points: 0,
  first_time_species: false,
  cares_species: false,
  flowered: false,
  sexual_reproduction: false,
};
```

**Usage:**
```typescript
await approveSubmission(adminId, submissionId, mockSpeciesIds, {
  ...mockApprovalData,
  points: 20,
  first_time_species: true,
});
```

#### `mockSpeciesIds`

Pre-configured species name IDs for testing.

```typescript
const mockSpeciesIds = {
  common_name_id: 1,
  scientific_name_id: 1,
};
```

### Utility Functions

#### `generateTestEmail(prefix?)`

Generates a unique timestamp-based email.

**Example:**
```typescript
const email = generateTestEmail("member");
// Returns: "member-1234567890@test.com"
```

## Type Definitions

### `TestContext`

The main context object returned by `setupTestDatabase()`.

```typescript
interface TestContext {
  db: Database;           // SQLite database instance
  member: TestMember;     // Regular test member
  admin: TestMember;      // Admin user
  otherAdmin?: TestMember; // Second admin (if adminCount >= 2)
}
```

### `TestMember`

Represents a test user.

```typescript
interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}
```

## Best Practices

### 1. Always Use Setup/Teardown

```typescript
let ctx: TestContext;

beforeEach(async () => {
  ctx = await setupTestDatabase();
});

afterEach(async () => {
  await teardownTestDatabase(ctx);
});
```

### 2. Use Descriptive Submission States

```typescript
// ❌ Bad - unclear state
const id = await createTestSubmission(ctx.db, {
  memberId: ctx.member.id,
  submitted: true,
  witnessStatus: "confirmed",
  approved: true,
  approvedBy: ctx.admin.id,
});

// ✅ Good - clear intent
const approvedSubmissionId = await createTestSubmission(ctx.db, {
  memberId: ctx.member.id,
  submitted: true,
  witnessStatus: "confirmed",
  witnessedBy: ctx.admin.id,
  approved: true,
  approvedBy: ctx.admin.id,
  points: 10,
});
```

### 3. Use Assertion Helpers

```typescript
// ❌ Bad - verbose assertions
assert.ok(submission.submitted_on !== null);
assert.ok(submission.witnessed_on !== null);
assert.strictEqual(submission.approved_on, null);

// ✅ Good - concise and clear
assertSubmissionState(submission, {
  submitted: true,
  witnessed: true,
  approved: false,
});
```

### 4. Leverage Mock Data

```typescript
// ❌ Bad - repeated boilerplate
await approveSubmission(adminId, submissionId,
  { common_name_id: 1, scientific_name_id: 1 },
  {
    id: 0,
    group_id: 1,
    points: 20,
    article_points: 0,
    first_time_species: false,
    cares_species: false,
    flowered: false,
    sexual_reproduction: false,
  }
);

// ✅ Good - reuse mock data
await approveSubmission(adminId, submissionId, mockSpeciesIds, {
  ...mockApprovalData,
  points: 20,
});
```

## Migration Guide

### Converting Existing Tests

**Before:**
```typescript
void describe("My Test", () => {
  let db: Database;
  let member: TestMember;
  let admin: TestMember;

  beforeEach(async () => {
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = OFF;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);

    const memberEmail = `member-${Date.now()}@test.com`;
    const adminEmail = `admin-${Date.now()}@test.com`;
    const memberId = await createMember(memberEmail, "Test Member");
    const adminId = await createMember(adminEmail, "Test Admin");
    member = (await getMember(memberId)) as TestMember;
    admin = (await getMember(adminId)) as TestMember;
  });

  afterEach(async () => {
    try { await db.close(); } catch {}
  });

  // ... tests
});
```

**After:**
```typescript
import { setupTestDatabase, teardownTestDatabase, type TestContext } from './helpers/testHelpers';

void describe("My Test", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  // ... tests (use ctx.db, ctx.member, ctx.admin)
});
```

## Examples

See `example.test.ts` for a complete working example demonstrating all helper functions.

## Contributing

When adding new helper functions:

1. Add full JSDoc documentation
2. Include usage examples
3. Add types and interfaces
4. Update this README
5. Add tests to `example.test.ts`

## Related

- See existing test files for usage examples in production
- Refer to `src/__tests__/witness-operations.test.ts` for complex workflow testing patterns
- Check `src/__tests__/approval-validation.test.ts` for state machine testing examples
