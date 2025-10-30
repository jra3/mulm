# Database Layer

SQLite database with dual connection pattern for read/write separation.

## Connection Pattern

Database connections are managed in `src/db/conn.ts`:

- **`readConn`** - Read-only connection for SELECT queries
- **`writeConn`** - Write connection for INSERT/UPDATE/DELETE
- **`query()`** - Helper function for SELECT queries (uses readConn)
- **`withTransaction()`** - Transaction wrapper for atomic operations

## Query Helpers

### Read Operations

Use `query()` helper for all SELECT operations:

```typescript
import { query } from '@/db/conn';

const results = await query<Type>('SELECT * FROM table WHERE id = ?', [id]);
return results.pop(); // Get single result

// Or for multiple results
const results = await query<Type>('SELECT * FROM table WHERE status = ?', ['active']);
return results;
```

### Write Operations (Single Statement)

For single-statement writes, use `writeConn` directly:

```typescript
import { writeConn } from '@/db/conn';

const conn = writeConn;
const stmt = await conn.prepare('INSERT INTO table (field) VALUES (?)');
try {
  const result = await stmt.run(value);
  return result.lastID; // For INSERT
  // OR return result.changes; // For UPDATE/DELETE
} finally {
  await stmt.finalize(); // ALWAYS finalize in finally block
}
```

### Write Operations (Multi-Statement)

For multi-statement operations, use `withTransaction()`:

```typescript
import { withTransaction } from '@/db/conn';

await withTransaction(async (db) => {
  const stmt1 = await db.prepare('INSERT INTO table1 VALUES (?)');
  const stmt2 = await db.prepare('UPDATE table2 SET field = ? WHERE id = ?');
  try {
    await stmt1.run(value1);
    await stmt2.run(value2, id);
  } finally {
    await stmt1.finalize();
    await stmt2.finalize();
  }
});
```

## Best Practices

### Statement Finalization

- ✅ **Always finalize statements** in `try/finally` blocks - Prevents SQLITE_BUSY errors
- ❌ **Don't finalize outside finally** - Can be skipped if error thrown

```typescript
// CORRECT
const stmt = await conn.prepare('...');
try {
  const result = await stmt.run(...);
  return result.lastID;
} finally {
  await stmt.finalize(); // Always runs
}

// WRONG - finalize might not run
const stmt = await conn.prepare('...');
const result = await stmt.run(...);
await stmt.finalize(); // Skipped if stmt.run throws
return result.lastID;
```

### Return Values

- ✅ **Return meaningful values**: `lastID` for INSERT, `changes` for UPDATE/DELETE
- ✅ Use `stmt.get()` for single row with RETURNING clause
- ✅ Use `stmt.all()` for multiple rows with RETURNING clause

```typescript
// INSERT - return new ID
const stmt = await conn.prepare('INSERT INTO ... RETURNING id');
const result = await stmt.get<{ id: number }>(...);
return result.id;

// UPDATE - return affected row count
const stmt = await conn.prepare('UPDATE ...');
const result = await stmt.run(...);
return result.changes;

// DELETE - return affected row count
const stmt = await conn.prepare('DELETE FROM ...');
const result = await stmt.run(...);
return result.changes;
```

### Input Validation

- ✅ **Validate inputs** before database operations
- ✅ Trim strings, check non-empty
- ✅ Verify foreign key references exist

```typescript
export async function addItem(name: string, categoryId: number): Promise<number> {
  // 1. Validate inputs
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Name cannot be empty');
  }

  // 2. Verify foreign key references exist
  const categories = await query<{ id: number }>(
    'SELECT id FROM categories WHERE id = ?',
    [categoryId]
  );
  if (categories.length === 0) {
    throw new Error('Category not found');
  }

  // 3. Execute write operation
  // ...
}
```

### Error Handling

- ✅ Catch database errors
- ✅ Log with `logger.error()`
- ✅ Check for specific constraint violations
- ✅ Rethrow with user-friendly message

```typescript
import { logger } from '@/utils/logger';

try {
  const conn = writeConn;
  const stmt = await conn.prepare('INSERT INTO ...');
  try {
    const result = await stmt.run(...);
    return result.lastID;
  } finally {
    await stmt.finalize();
  }
} catch (err) {
  // Handle specific errors
  if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
    throw new Error('Duplicate entry');
  }
  if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
    throw new Error('Referenced record not found');
  }

  logger.error('Operation failed', err);
  throw new Error('Failed to save data');
}
```

### Documentation

- ✅ **JSDoc comments** for all database functions
- ✅ Document params, return values, and `@throws` conditions

```typescript
/**
 * Add a synonym for a species group
 * @param groupId The species group ID
 * @param commonName The common name synonym
 * @param scientificName The scientific name synonym
 * @returns The ID of the newly created synonym
 * @throws {Error} If name is empty, group not found, or duplicate entry
 */
export async function addSynonym(
  groupId: number,
  commonName: string,
  scientificName: string
): Promise<number> {
  // Implementation
}
```

## Species Database Schema

The species data is organized into three tables:

### `species_name_group`

The core species table containing canonical names and all metadata:

- `group_id` (PK) - Unique species group identifier
- `canonical_genus` - Official genus name
- `canonical_species_name` - Official species epithet
- `program_class` - BAP program class (e.g., "Cichlids - New World", "Livebearers")
- `species_type` - High-level category ("Fish", "Plant", "Invert", "Coral")
- `base_points` - Point value for breeding this species (nullable)
- `is_cares_species` - CARES conservation priority flag (0/1)
- `iucn_*` fields - IUCN Red List conservation status data
- `fishbase_*` fields - FishBase ecological and biological data

### `species_common_name`

Common name synonyms (many-to-one relationship with species_name_group):

- `common_name_id` (PK)
- `group_id` (FK to species_name_group)
- `common_name` - Common name variant (e.g., "Rosy Barb", "Red Barb")
- UNIQUE constraint on (group_id, common_name)

### `species_scientific_name`

Scientific name synonyms (many-to-one relationship with species_name_group):

- `scientific_name_id` (PK)
- `group_id` (FK to species_name_group)
- `scientific_name` - Scientific name variant (e.g., "Puntius conchonius", "Barbus conchonius")
- UNIQUE constraint on (group_id, scientific_name)

**Example**: The species Puntius conchonius (group_id=1066) might have:
- Common names: "Rosy Barb", "Red Barb" (in species_common_name)
- Scientific names: "Puntius conchonius", "Barbus conchonius" (in species_scientific_name)

## Complete Example

From `src/db/species.ts`:

```typescript
import { query, writeConn } from '@/db/conn';
import { logger } from '@/utils/logger';

/**
 * Add a common name synonym for a species group
 * @param groupId The species group ID
 * @param commonName The common name synonym
 * @returns The ID of the newly created synonym
 * @throws {Error} If name is empty, group not found, or duplicate entry
 */
export async function addCommonName(
  groupId: number,
  commonName: string
): Promise<number> {
  // 1. Validate inputs
  const trimmed = commonName.trim();
  if (!trimmed) {
    throw new Error('Common name cannot be empty');
  }

  // 2. Verify foreign key references exist
  const groups = await query<{ group_id: number }>(
    'SELECT group_id FROM species_name_group WHERE group_id = ?',
    [groupId]
  );
  if (groups.length === 0) {
    throw new Error('Species group not found');
  }

  // 3. Execute write operation
  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      INSERT INTO species_common_name (group_id, common_name)
      VALUES (?, ?)
      RETURNING common_name_id
    `);
    try {
      const result = await stmt.get<{ common_name_id: number }>(groupId, trimmed);
      return result.common_name_id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    // 4. Handle specific errors
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error('Duplicate common name for this species');
    }
    logger.error('Failed to add common name', err);
    throw new Error('Failed to add common name');
  }
}
```

## Transaction Handling

### When to Use Transactions

- ✅ Use `withTransaction()` for operations that must be atomic
- ✅ Multiple related writes (e.g., insert + update)
- ❌ Don't use for single-statement operations (unnecessary overhead)

### Transaction Pattern

```typescript
import { withTransaction } from '@/db/conn';

await withTransaction(async (db) => {
  // All statements within this function are part of the transaction
  // If any statement fails, all changes are rolled back

  const stmt1 = await db.prepare('INSERT INTO submissions ...');
  const stmt2 = await db.prepare('UPDATE members SET ...');
  const stmt3 = await db.prepare('INSERT INTO activity ...');

  try {
    const sub = await stmt1.get<{ id: number }>(...);
    await stmt2.run(sub.id);
    await stmt3.run(sub.id);
  } finally {
    await stmt1.finalize();
    await stmt2.finalize();
    await stmt3.finalize();
  }
});
```

### Transaction Error Handling

The try/catch around ROLLBACK in `withTransaction()` is intentional - the sqlite3 package doesn't expose transaction state, so ROLLBACK might fail if transaction already rolled back.

```typescript
// From src/db/conn.ts
export async function withTransaction<T>(
  callback: (db: Database.Database) => Promise<T>
): Promise<T> {
  const db = writeConn;
  await db.exec('BEGIN TRANSACTION');
  try {
    const result = await callback(db);
    await db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      await db.exec('ROLLBACK');
    } catch (rollbackErr) {
      // Transaction might already be rolled back
      logger.warn('ROLLBACK failed (transaction may already be rolled back)', rollbackErr);
    }
    throw err;
  }
}
```

## Migration System

Migrations run automatically on startup from `db/migrations/`.

### Migration File Naming

Files are run in alphabetical order: `001_initial.sql`, `002_add_feature.sql`, etc.

### Migration Tracking

Migrations are tracked in the `migrations` table:

```sql
CREATE TABLE migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Creating Migrations

1. Create new file in `db/migrations/` with sequential number prefix
2. Write SQL statements (semicolon-separated)
3. Migrations run automatically on next app start

Example migration (`db/migrations/003_add_field.sql`):

```sql
-- Add new field to submissions table
ALTER TABLE submissions ADD COLUMN notes TEXT;

-- Create index on new field
CREATE INDEX idx_submissions_notes ON submissions(notes);
```

## Database Modules

Database operations are organized by domain:

- `src/db/conn.ts` - Connection management, query helpers
- `src/db/members.ts` - Member CRUD operations
- `src/db/submissions.ts` - Submission CRUD operations
- `src/db/species.ts` - Species and synonym management
- `src/db/iucn.ts` - IUCN Red List conservation status operations
- `src/db/tanks.ts` - Tank preset operations
- `src/db/activity.ts` - Activity feed operations

Each module exports functions for specific database operations, following the patterns above.
