# E2E Testing with Playwright

End-to-end tests for the BAP application using Playwright.

## Quick Start

```bash
# Run all e2e tests (headless)
npm run test:e2e

# Run with visible browser
npm run test:e2e:headed

# Debug mode with Playwright inspector
npm run test:e2e:debug

# Interactive UI mode
npm run test:e2e:ui

# View last test report
npm run test:e2e:report

# Run specific test file
npm run test:e2e -- hello-world.spec.ts
```

## Test Structure

```
e2e/
├── helpers/
│   ├── auth.ts          # Authentication utilities
│   └── testData.ts      # Test data seeding and cleanup
├── global-setup.ts      # Runs once before all tests (creates test users)
├── hello-world.spec.ts  # ✅ Basic connectivity tests (4/4 passing)
└── form-submission.spec.ts  # 🚧 WIP: Form submission flow tests
```

## Test Status

### ✅ Working (CI Passing)

**hello-world.spec.ts** - Basic connectivity (4/4 tests)
- ✅ Home page loads with content
- ✅ Login link/form exists
- ✅ No console errors on load
- ✅ Health check endpoint responds

**CI Integration:**
- ✅ Runs on every push/PR
- ✅ Browser auto-install in CI
- ✅ Screenshot/video on failure
- ✅ Artifacts uploaded (30 day retention)
- ✅ Parallel with unit tests

### 🚧 Work in Progress

**form-submission.spec.ts** - Form submission flows (0/4 passing)
- ❌ Create and save draft submission
- ❌ Submit complete form for review
- ❌ Edit draft submission
- ❌ Delete draft submission

**Known Issues:**
1. **Login flow needs refinement** - Dialog interaction not completing
2. **Tom Select fields** - Species name fields use Tom Select dropdowns, not regular inputs
3. **HTMX interactions** - Need to wait for HTMX swaps after field changes

**Next Steps:**
- Fix login helper to handle HTMX dialog properly
- Create Tom Select interaction helpers
- Add proper waits for HTMX swaps
- Handle session/cookie management

## Helpers

### Authentication (`helpers/auth.ts`)

```typescript
import { login, logout, isLoggedIn, ensureLoggedIn } from "./helpers/auth";

// Login with default test user
await login(page);

// Login with custom credentials
await login(page, { email: "custom@test.com", password: "pass123" });

// Logout
await logout(page);

// Check if logged in
const loggedIn = await isLoggedIn(page);

// Ensure logged in (login if not already)
await ensureLoggedIn(page);
```

### Test Data (`helpers/testData.ts`)

```typescript
import { ensureTestUserExists, cleanupTestUserSubmissions, TEST_USER } from "./helpers/testData";

// Default test user
const user = TEST_USER; // baptest+e2e@porcnick.com

// Create/ensure test user exists
const memberId = await ensureTestUserExists(email, password, displayName);

// Clean up test submissions
await cleanupTestUserSubmissions(TEST_USER.email);

// Create test submission
const submissionId = await createTestSubmission(memberId, {
  speciesType: "Fish",
  speciesCommonName: "Guppy",
  isDraft: true
});

// Delete submission
await deleteSubmission(submissionId);
```

## Configuration

### playwright.config.ts

- **Base URL**: `http://localhost:4200`
- **Test timeout**: 30 seconds
- **Global setup**: Creates test user before all tests
- **Web server**: Auto-starts `npm start` before tests
- **Browsers**: Chromium (headless by default)
- **Workers**: 4 parallel (1 in CI for stability)
- **Retries**: 0 local, 2 in CI
- **Screenshots**: Only on failure
- **Videos**: Retain on failure only

### Global Setup

**e2e/global-setup.ts** runs before all tests:
- Creates test user `baptest+e2e@porcnick.com` if it doesn't exist
- Uses proper scrypt password hashing (via `src/auth.ts`)
- Idempotent - safe to run multiple times

## Debugging Failed Tests

### View Screenshots

```bash
# Failed tests auto-capture screenshots
ls test-results/*/test-failed-*.png

# View in browser
open test-results/form-submission-*/test-failed-1.png
```

### View Videos

```bash
# Videos captured for failed tests
open test-results/*/video.webm
```

### View HTML Report

```bash
npm run test:e2e:report
# Opens interactive report at http://localhost:9323
```

### Debug Interactively

```bash
# Run in debug mode (opens Playwright inspector)
npm run test:e2e:debug

# Run specific test in debug mode
npm run test:e2e:debug -- form-submission.spec.ts

# Run with visible browser
npm run test:e2e:headed -- form-submission.spec.ts
```

## CI Integration

Tests run automatically in `.github/workflows/ci.yml`:

```yaml
e2e-tests:
  steps:
    - Setup Node.js
    - Install dependencies (npm ci)
    - Setup config file
    - Install Playwright browsers (chromium only)
    - Build project
    - Setup E2E database (migrations)
    - Run e2e tests
    - Upload artifacts (reports, screenshots)
```

**CI Run Time:** ~1m14s total
- Browser install: ~30s
- Build: ~20s
- Tests: ~5s
- Setup/teardown: ~20s

## Best Practices

### Test Isolation
- Each test should clean up its own data
- Use `beforeEach` to reset state
- Don't rely on test execution order

### Waiting for Elements
```typescript
// ✅ GOOD: Use Playwright's auto-waiting
await page.click('button:has-text("Submit")');
await page.fill('input[name="email"]', 'test@example.com');

// ✅ GOOD: Wait for specific state
await page.waitForSelector('#form', { state: 'visible' });
await page.waitForLoadState('networkidle');

// ❌ BAD: Arbitrary sleeps
await page.waitForTimeout(1000); // Avoid unless absolutely necessary
```

### HTMX Interactions
```typescript
// After HTMX swap, wait for target element
await page.selectOption('select[name="species_type"]', 'Fish');
await page.waitForSelector('select[name="species_class"]'); // Wait for HTMX swap
```

### Tom Select Dropdowns
```typescript
// Tom Select creates custom dropdowns - need special handling
// Regular fill/type won't work
// TODO: Create helper functions for Tom Select interactions
```

## Known Limitations

1. **No Tom Select helper yet** - Need to create utilities for Tom Select dropdown interactions
2. **Login flow incomplete** - HTMX dialog interaction needs refinement
3. **No file upload tests** - Image upload not yet tested
4. **No admin workflow tests** - Witness/approval flows not yet tested

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Testing Library](https://playwright.dev/docs/test)
- [Tom Select Documentation](https://tom-select.js.org/)
- [HTMX Documentation](https://htmx.org/)

## Troubleshooting

### Tests timeout waiting for server

**Issue:** `Timed out waiting 120000ms from config.webServer`

**Solution:** Ensure database is initialized:
```bash
npx ts-node scripts/setup-e2e-db.ts
npm run build
npm run test:e2e
```

### Login fails in tests

**Issue:** Login dialog doesn't complete, can't find logout link

**Status:** Known issue - needs debugging. The login dialog opens and credentials are filled, but the form submission via HTMX isn't completing.

**Workaround:** Use direct database session creation (bypass UI login) - TODO

### Tom Select fields not interacting

**Issue:** Can't fill `species_common_name` or `species_latin_name`

**Cause:** These are Tom Select typeahead dropdowns, not regular inputs

**Solution:** Need to create Tom Select interaction helpers that:
1. Click the Tom Select control
2. Type into the search input
3. Wait for results
4. Select from dropdown
5. Verify selection

## Next Steps

1. **Fix login helper** - Debug HTMX dialog interaction
2. **Create Tom Select helpers** - Enable species field interactions
3. **Complete form submission tests** - Get all 4 tests passing
4. **Add field linking tests** - Test common ↔ scientific name sync
5. **Add image upload tests** - Test file upload flow
6. **Add session persistence tests** - Test sessionStorage behavior
