# Backend Architecture

This directory contains the Node.js/Express backend application code.

## Directory Structure

```
src/
├── __tests__/        # Test files and helpers
├── auth/             # Authentication logic (password hashing, tokens, OAuth)
├── db/               # Database layer (See src/db/README.md)
├── forms/            # Zod schemas for form validation
├── middleware/       # Express middleware (auth, session, error handling)
├── routes/           # Route handlers (See src/routes/README.md)
├── services/         # Business logic (email, submissions, levels, etc.)
├── types/            # TypeScript type definitions
├── utils/            # Utility functions (logger, date formatting, etc.)
├── views/            # Pug templates (See src/views/README.md)
├── config.json       # Local config (git-ignored)
└── index.ts          # Application entry point
```

## Code Quality Standards

**CRITICAL**: Follow these rules for maintainable, performant code:

### Static Imports Only

- ❌ **Never use dynamic imports** - Always use static imports at the top of files
  ```typescript
  // WRONG
  const { someFunction } = await import('../module');

  // CORRECT
  import { someFunction } from '../module';
  ```
- ❌ **Never use `require()`** in TypeScript - Use ES6 imports
- ✅ **Static imports only** - Enables tree shaking, type checking, and better performance

## Session Management

- Cookie-based sessions stored in SQLite (`sessions` table)
- `MulmRequest` type extends Express Request with typed `viewer` property
- Session middleware automatically populates viewer from database
- Viewer object contains user info: `{ member_id, email, first_name, last_name, role }`

### Request Handling Pattern

```typescript
import { MulmRequest } from '@/types/request';

router.get('/path', async (req: MulmRequest, res) => {
  const { viewer } = req; // Typed viewer or undefined
  if (!viewer) return res.redirect('/signin');

  // Use viewer safely
  const memberId = viewer.member_id;
  // ...
});
```

## Form Validation

All form inputs are validated using Zod schemas defined in `src/forms/`.

### Pattern

```typescript
import { submissionFormSchema } from '@/forms/submission';

router.post('/submissions', async (req: MulmRequest, res) => {
  const result = submissionFormSchema.safeParse(req.body);

  if (!result.success) {
    // Return form with errors
    return res.render('submission-form', {
      errors: result.error.flatten().fieldErrors,
      formData: req.body // Preserve user input
    });
  }

  // Process valid data
  const data = result.data;
  // ...
});
```

### Best Practices

- ✅ Server-side validation for all forms
- ✅ Field-level error messages
- ✅ Form state preservation on validation errors
- ✅ Type-safe data after validation (Zod infers TypeScript types)

## Testing Strategy

Each test gets an isolated in-memory SQLite database with full schema.

### Test Setup Pattern

```typescript
import { createTestDb, overrideConnection } from '@/__tests__/testDbHelper.helper';

describe('MyModule', () => {
  let db: Database.Database;

  beforeAll(async () => {
    db = await createTestDb(); // Creates in-memory DB with migrations
    overrideConnection(db);     // Injects test DB into app
  });

  afterAll(async () => {
    await db.close();
  });

  it('should do something', async () => {
    // Test code here
  });
});
```

### Key Points

- Each test file gets its own database
- Migrations run automatically for each test database
- Tests are isolated from production and development databases
- Helper utilities in `src/__tests__/testDbHelper.helper.ts`

## Authentication

Authentication logic lives in `src/auth/`:

- **Password auth**: `src/auth/password.ts` (bcrypt hashing, verification)
- **Token auth**: `src/auth/token.ts` (password reset tokens, email verification)
- **OAuth**: `src/auth/oauth.ts` (Google OAuth integration)

### Password Handling

```typescript
import { hashPassword, verifyPassword } from '@/auth/password';

// Hash password for storage
const hashedPassword = await hashPassword(plainPassword);

// Verify password on login
const isValid = await verifyPassword(plainPassword, hashedPassword);
```

## Services Layer

Business logic is organized in `src/services/`:

- **Email**: `emailService.ts` - Sending transactional emails
- **Submissions**: `submissionService.ts` - Submission lifecycle, status transitions
- **Levels**: `levelService.ts` - BAP level calculations, awards
- **Images**: `imageService.ts` - R2 storage, image processing
- **Activity**: `activityService.ts` - Activity feed generation

### Service Pattern

Services contain business logic and orchestrate database operations:

```typescript
// Service function
export async function approveSubmission(
  submissionId: number,
  approverId: number
): Promise<void> {
  // 1. Validate preconditions
  const submission = await getSubmissionById(submissionId);
  if (!submission) throw new Error('Submission not found');
  if (submission.status !== 'pending_review') {
    throw new Error('Submission not pending review');
  }

  // 2. Perform database operations
  await withTransaction(async (db) => {
    await updateSubmissionStatus(db, submissionId, 'approved');
    await recordActivity(db, submissionId, 'approved', approverId);
    await updateMemberLevel(db, submission.member_id);
  });

  // 3. Send notifications
  await sendApprovalEmail(submission.member_id);
}
```

## Middleware

Express middleware in `src/middleware/`:

- **Auth**: `auth.ts` - Require login, require admin
- **Session**: `session.ts` - Session loading, viewer population
- **Error**: `error.ts` - Error handling, logging
- **Upload**: `upload.ts` - File upload handling (multer)

### Common Middleware

```typescript
import { requireLogin, requireAdmin } from '@/middleware/auth';

// Require authenticated user
router.get('/protected', requireLogin, async (req, res) => {
  // req.viewer is guaranteed to exist
});

// Require admin role
router.get('/admin', requireAdmin, async (req, res) => {
  // req.viewer is guaranteed to be admin
});
```

## Utilities

Common utilities in `src/utils/`:

- **Logger**: `logger.ts` - Structured logging (respects NODE_ENV)
- **Date formatting**: `dateFormat.ts` - Consistent date display (See src/views/README.md)
- **Config**: `config.ts` - Configuration loading

### Logger Usage

```typescript
import { logger } from '@/utils/logger';

try {
  // Do something
} catch (err) {
  logger.error('Operation failed', err);
  throw new Error('User-friendly message');
}

logger.info('User logged in', { memberId });
logger.warn('Rate limit approaching', { ip: req.ip });
```

Logger is automatically silenced during tests (NODE_ENV=test).

## Configuration

### Development

Config file: `src/config.json` (git-ignored)

```json
{
  "databaseFile": "./db/database.db",
  "googleClientId": "...",
  "googleClientSecret": "...",
  "smtpHost": "...",
  "smtpPort": 587,
  "r2AccountId": "...",
  "r2AccessKeyId": "...",
  "r2SecretAccessKey": "..."
}
```

### Production

Config file: `/mnt/basny-data/app/config/config.production.json`

Mounted read-only into container at `/app/src/config.json`

Database path must be absolute: `"/mnt/app-data/database/database.db"`

File permissions: Must be 600 (owner-only) and owned by UID 1001 (nodejs user)

## Further Reading

- **[src/db/README.md](db/README.md)** - Database patterns, queries, transactions
- **[src/routes/README.md](routes/README.md)** - Routing conventions, API reference
- **[src/views/README.md](views/README.md)** - Pug templates, design system
