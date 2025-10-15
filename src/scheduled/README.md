# Scheduled Tasks

This directory contains scheduled background tasks that run automatically.

## Daily Cleanup Task

### Overview
The daily cleanup task (`cleanup.ts`) removes expired data from the database to prevent unnecessary data accumulation.

### Schedule
- **First run**: Immediately when the application starts
- **Recurring**: Daily at 3:00 AM server time
- **Duration**: Typically completes in under 1 second

### What Gets Cleaned Up

1. **Expired Password Reset Tokens** (`auth_codes` table)
   - Removes tokens that have expired
   - Password reset tokens typically expire after 1 hour

2. **Expired WebAuthn Challenges** (`webauthn_challenges` table)
   - Removes authentication challenges that have expired
   - WebAuthn challenges expire after 5 minutes

### Implementation Details

The cleanup is implemented in `src/scheduled/cleanup.ts` and integrated into the main application startup in `src/index.ts`.

```typescript
// Runs immediately on startup
void runDailyCleanup();

// Schedules daily execution at 3 AM
startScheduledCleanup();
```

### Logging

All cleanup operations are logged with the following format:
- Start: `Starting daily cleanup tasks`
- Auth codes: `Deleted N expired auth codes`
- WebAuthn challenges: `Deleted N expired WebAuthn challenges`
- Complete: `Daily cleanup tasks completed successfully`
- Errors: `Error during daily cleanup` (with error details)

### Testing

Tests for the cleanup functionality are located in `src/__tests__/cleanup.test.ts`.

To run the cleanup tests:
```bash
npm test -- src/__tests__/cleanup.test.ts
```

### Stopping Cleanup (for testing/shutdown)

The cleanup scheduler can be stopped using:
```typescript
import { stopScheduledCleanup } from './scheduled/cleanup';
stopScheduledCleanup();
```

### Monitoring

Monitor cleanup effectiveness by checking:
1. Application logs for daily cleanup messages
2. Database table sizes for `auth_codes` and `webauthn_challenges`
3. Error logs for any cleanup failures
