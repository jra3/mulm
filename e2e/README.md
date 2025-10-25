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
│   ├── tomSelect.ts     # Tom Select dropdown interaction helpers
│   └── testData.ts      # Test data seeding and cleanup
├── global-setup.ts      # Runs once before all tests (creates test users)
├── hello-world.spec.ts  # ✅ Basic connectivity tests (4/4 passing)
├── form-field-linking.spec.ts  # ✅ Form field linking tests (11/11 passing)
├── form-submission.spec.ts     # ✅ Form submission flow tests (4/4 passing)
├── auth.spec.ts         # ✅ Authentication tests
├── admin-workflows.spec.ts     # ✅ Admin workflow tests
└── tom-select-demo.spec.ts     # ✅ Tom Select demo tests
```

## Test Status

### ✅ Working (CI Passing)

**hello-world.spec.ts** - Basic connectivity (4/4 tests)
- ✅ Home page loads with content
- ✅ Login link/form exists
- ✅ No console errors on load
- ✅ Health check endpoint responds

**form-field-linking.spec.ts** - Form field linking (11/11 tests) ⭐ **NEW**
- ✅ Auto-populate scientific name when common name is selected
- ✅ Auto-populate common name when scientific name is selected
- ✅ Update hidden species_name_id field when species is selected
- ✅ Populate species_class field based on selected species
- ✅ Maintain sync when switching between fields
- ✅ Properly initialize Tom Select dropdowns
- ✅ No JavaScript errors during field linking
- ✅ Handle bidirectional sync correctly
- ✅ Preserve field values across HTMX swaps
- ✅ Handle species with multiple common names
- ✅ Handle newly created custom species names

**form-submission.spec.ts** - Form submission flows (4/4 tests)
- ✅ Create and save draft submission
- ✅ Submit complete form for review
- ✅ Edit draft submission
- ✅ Delete draft submission

**CI Integration:**
- ✅ Runs on every push/PR
- ✅ Browser auto-install in CI
- ✅ Screenshot/video on failure
- ✅ Artifacts uploaded (30 day retention)
- ✅ Parallel with unit tests

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

**scripts/setup-e2e-db.ts** runs before Playwright (via CI workflow):
- Creates database and runs all migrations
- **Seeds test species data** (Guppy, Swordtail, Platy)
- Required for Tom Select typeahead fields to work properly

**e2e/global-setup.ts** runs before all tests:
- Creates test user `baptest+e2e@porcnick.com` if it doesn't exist
- Uses proper scrypt password hashing (via `src/auth.ts`)
- Idempotent - safe to run multiple times

### Test Data Seeding

**CRITICAL**: The CI database starts completely empty (just schema, no data).

When adding new E2E tests that use species data, ensure the species exist in `scripts/setup-e2e-db.ts`:

```typescript
const testSpecies = [
  {
    group: { canonical_genus: "Poecilia", canonical_species_name: "reticulata", ... },
    commonNames: ["Guppy", "Fancy Guppy"],
    scientificNames: ["Poecilia reticulata"]
  },
  // Add more species as needed
];
```

**Why this matters**: Issue #180 spent weeks chasing "timing issues" that were actually missing species data. Tests searched for species that didn't exist in CI, causing:
- Tom Select API returning 0 results
- Tests creating custom entries instead of selecting existing species
- HTMX field linking failures (no species to link to)
- Intermittent failures that seemed timing-related

**Lesson learned**: When tests pass locally but fail in CI, check if test data exists in both environments!

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

### Tom Select Dropdowns (`helpers/tomSelect.ts`)

```typescript
import { fillTomSelectTypeahead, getTomSelectValue, selectTomSelectMultiple } from "./helpers/tomSelect";

// Fill a typeahead field (e.g., species name)
await fillTomSelectTypeahead(page, "species_common_name", "Guppy");

// Get the selected value
const value = await getTomSelectValue(page, "species_common_name");

// Select multiple values (e.g., foods, spawn locations)
await selectTomSelectMultiple(page, "foods", ["Live", "Flake"]);

// Clear a field
await clearTomSelect(page, "species_common_name");
```

## Known Limitations

1. **No file upload tests** - Image upload not yet fully tested in E2E
2. **Limited mobile viewport testing** - Most tests focus on desktop viewport
3. **No visual regression testing** - UI changes are not automatically detected

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

### Tom Select fields not interacting

**Issue:** Can't fill `species_common_name` or `species_latin_name`

**Cause:** These are Tom Select typeahead dropdowns, not regular inputs

**Solution:** ✅ **FIXED** - Use the Tom Select helpers in `e2e/helpers/tomSelect.ts`:
```typescript
import { fillTomSelectTypeahead } from "./helpers/tomSelect";
await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
```

### Field linking not working

**Issue:** Common name and scientific name fields don't sync

**Status:** ✅ **FIXED** - Comprehensive tests added in `form-field-linking.spec.ts` to prevent regressions

The form field linking functionality (which was temporarily disabled in commit c9e9606) is now:
- Re-enabled in production
- Fully tested with 11 E2E tests
- Protected against future regressions

## HTMX Testing - Hard-Won Lessons

### Overview

This application uses HTMX extensively for dynamic page updates. HTMX has unique timing challenges compared to traditional SPAs because content loads asynchronously via HTML fragments.

### Lesson 1: Elements Exist Before They're Ready

**The Problem**: HTMX swaps HTML into the page, but elements aren't immediately interactive.

```typescript
// ❌ COMMON MISTAKE - Element exists but is disabled
await page.waitForSelector('input[name="points"]');
await page.fill('input[name="points"]', "10"); // TIMEOUT! Element is disabled

// ✅ CORRECT - Wait for element to be enabled
await page.waitForSelector('input[name="points"]:not([disabled])');
await page.fill('input[name="points"]', "10"); // Works!

// ✅ ALSO CORRECT - Wait for visible state
await page.waitForSelector('input[name="count"]:visible', { state: 'visible' });
```

**Why this happens**: HTMX loads HTML with disabled inputs, then makes a follow-up request to populate/enable them.

**Real example from submission-lifecycle tests**: The approval panel loads with all inputs disabled, then HTMX populates them based on the submission data.

### Lesson 2: HTMX Dialogs - Two-Step Loading

**The Pattern**: Buttons that open dialogs AND load content via HTMX:

```pug
button(
  onclick="dialog.showModal()"
  hx-get="/endpoint"
  hx-target="#dialog"
)
```

This executes two actions:
1. `onclick` - Opens dialog immediately (synchronous)
2. `hx-get` - Loads content into dialog (asynchronous)

```typescript
// ❌ WRONG - Dialog opens but content isn't loaded
await page.click('button:has-text("Edit")');
await page.fill('input[name="field"]', "value"); // FAILS - form not loaded!

// ✅ CORRECT - Wait for both steps
await page.click('button:has-text("Edit Approved Submission")');

// Step 1: Wait for dialog to open
await page.waitForSelector('dialog#edit-dialog[open]');

// Step 2: Wait for HTMX content to load
await page.waitForSelector('#edit-dialog form');

// Step 3: Wait for inputs to be visible/enabled
await page.waitForSelector('#edit-dialog input[name="field"]:visible', { state: 'visible' });

// NOW safe to interact
await page.fill('#edit-dialog input[name="field"]', "value");
```

**Real issue encountered**: Post-approval edit dialog opens successfully but form inputs remain hidden. The HTMX content loads into a hidden container within the dialog, requiring additional investigation into proper wait strategies.

### Lesson 3: Form Validation Failures Are Silent

When form submission doesn't redirect or show an error:

**Common causes**:
1. Missing required field
2. Field value doesn't meet constraints (minlength, pattern, etc.)
3. Wrong field type (text input vs dropdown)

```typescript
// Form submission that appears to do nothing:
await page.click('button:has-text("Approve")');
await page.waitForURL(/\/admin\/queue\//); // TIMEOUT!

// Why? Check the form schema in src/forms/approval.ts:
// - group_id is REQUIRED ("Species selection required")
// - points must be provided
```

**Debugging strategy**:
```typescript
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);

// Still on same URL? Validation failed
const url = page.url();
console.log("URL after submit:", url);

// Check for error messages
const errors = await page.locator('.error, [role="alert"]').allTextContents();
console.log("Errors:", errors);
```

**Real examples from this codebase**:
- Approval requires `group_id` (species selection) - silently fails without it
- Witness decline dialog requires `reason` with `minlength="10"`
- Approval uses dropdown `select[name="points"]` not text input

### Lesson 4: Button Text ≠ Documentation

**Always verify actual button text** - documentation can be outdated.

```typescript
// ❌ Based on docs/TESTING_STRATEGY.md
await page.click('button:has-text("Confirm Witness")'); // Doesn't exist!

// ✅ Actual button text in src/views/submission/review.pug
await page.click('button:has-text("Approve for Screening")');
```

**How to find actual text**:
1. Check Pug templates: `grep -r "button.*text" src/views/`
2. Run test and check error: `waiting for locator('button:has-text("X")')`
3. Check error-context.md: Shows all buttons on page
4. Use Playwright codegen: `npx playwright codegen localhost:4200`

**Examples discovered**:
| Documentation | Actual UI |
|---------------|-----------|
| "Confirm Witness" | "Approve for Screening" |
| "Decline Witness" | "Request More Info" |
| "Edit" | "Edit Approved Submission" |

### Lesson 5: HTMX Redirects to Different Queues

**The pattern**: Admin actions redirect to different queues based on context:

```typescript
// ❌ TOO SPECIFIC - Only matches one queue
await page.click('button:has-text("Approve")');
await page.waitForURL(/\/admin\/queue\//); // Might redirect to /admin/witness-queue/!

// ✅ FLEXIBLE - Matches either queue
await page.waitForURL(/\/admin\/(witness-queue|queue)\//);
```

**Why**: Witness confirmations redirect to witness queue, approvals redirect to approval queue.

### Lesson 6: Waiting Period Logic

**Critical business rule**: The waiting period is calculated from `reproduction_date` (fry age), NOT `witnessed_on`.

```typescript
// ❌ WRONG ASSUMPTION - Thought it was from witness date
const id = await createTestSubmission({
  witnessed: true,
  witnessedDaysAgo: 70, // Witnessed 70 days ago
  // reproduction_date defaults to TODAY
});
// Result: Shows "Elapsed: 0 of 60 days" - fry are 0 days old!

// ✅ CORRECT - Fry are actually old enough
const id = await createTestSubmission({
  witnessed: true,
  witnessedDaysAgo: 70,
  reproductionDaysAgo: 70, // Fry born 70 days ago
});
// Result: Shows "Elapsed: 70 of 60 days" - eligible for approval!
```

**Why**: The waiting period ensures fry/plants are biologically mature (30/60 days old), not just that admin witnessed them quickly.

**Where defined**: `src/utils/waitingPeriod.ts:39` - `getDaysElapsed(submission.reproduction_date)`

### Lesson 7: Test Data Defaults Matter

**Problem**: `createTestSubmission()` originally defaulted `reproduction_date` to today.

**Impact**: Every test submission appeared to be 0 days old, failing all waiting period checks.

**Solution**: Changed default to 70 days ago for "mature spawns":

```typescript
export interface TestSubmissionOptions {
  reproductionDaysAgo?: number; // Default: 70 (old enough for approval)
}

// Now tests work without specifying:
const id = await createTestSubmission({ submitted: true, witnessed: true });
// Automatically creates 70-day-old spawn
```

**Lesson**: Test helpers should default to the "happy path" state.

### Lesson 8: HTMX Swaps Can Replace Page Sections

Some HTMX interactions replace large sections of the DOM:

```typescript
// Selecting species_type triggers full form replacement via HTMX
await page.selectOption('select[name="species_type"]', "Fish");

// ❌ WRONG - Old form is gone, selector fails
await page.fill('input[name="count"]', "25");

// ✅ CORRECT - Wait for new form to load
await page.waitForLoadState("networkidle");
await page.waitForSelector('select[name="species_class"]', { state: "visible" });

// NOW the new form is ready
await page.selectOption('select[name="species_class"]', "Livebearers");
```

**How to identify these**: Look for `hx-swap="outerHTML"` or `hx-swap="innerHTML"` on parent containers.

### Lesson 9: Multiple Matching Selectors

**Problem**: Generic selectors match multiple elements:

```typescript
// ❌ BAD - Clicks first of 3 submit buttons (might be wrong one)
await page.click('button[type="submit"]');
// Error: "locator resolved to 3 elements. Proceeding with the first one"

// ✅ GOOD - Specific context
await page.click('form#witnessForm button[type="submit"]');

// ✅ GOOD - Specific text
await page.click('button[type="submit"]:has-text("Save")');

// ✅ GOOD - Use .first() deliberately
await page.locator('button:has-text("Approve")').first().click();
```

**Real example**: Witness decline dialog has multiple submit buttons - one for the decline form, another for the main page.

### Lesson 10: Database State vs UI State

**Problem**: Updating database mid-test doesn't update the rendered page:

```typescript
// ❌ DOESN'T WORK
const id = await createTestSubmission({ witnessed: true });
await page.goto(`/submissions/${id}`);

// Try to mock time travel by updating database
await db.run("UPDATE submissions SET witnessed_on = ?", seventyDaysAgo, id);

// Page still shows today's date!
await page.reload(); // Even reload doesn't always help (caching)
```

**Why**: The page was rendered with the original data. HTMX doesn't re-query the database on every render.

**Solution**: Create test data correctly from the start:

```typescript
// ✅ WORKS
const id = await createTestSubmission({
  witnessed: true,
  witnessedDaysAgo: 70, // Creates submission with old witnessed_on from start
});
await page.goto(`/submissions/${id}`);
// Page shows correct 70-day-old date
```

## Testing Workflow Patterns

### Pattern: Approval Workflow

The approval form has specific requirements:

```typescript
// Navigate to eligible submission (must be past waiting period)
const id = await createTestSubmission({
  submitted: true,
  witnessed: true,
  witnessedDaysAgo: 70,
  reproductionDaysAgo: 70, // REQUIRED - ensures fry are old enough
});

await login(page, TEST_ADMIN);
await page.goto(`/submissions/${id}`);

// Wait for approval panel to load
const approveButton = page.locator('button:has-text("Approve")').first();
await approveButton.scrollIntoViewIfNeeded();
await page.waitForLoadState("networkidle");

// REQUIRED: Select species (validation fails without this)
await fillTomSelectTypeahead(page, "group_id", "Poecilia reticulata");
await page.waitForTimeout(500); // HTMX updates points dropdown

// Select base points
await page.selectOption('select[name="points"]', "10");

// Submit
await approveButton.click();
await page.waitForURL(/\/admin\/(witness-queue|queue)\//);
```

**Key requirements**:
1. Submission must be past waiting period (check reproduction_date)
2. Must select species via `group_id` (required field)
3. Must select points from dropdown (not text input)
4. Wait for `networkidle` before selecting species

### Pattern: Changes Requested Workflow

```typescript
// Create witnessed submission
const id = await createTestSubmission({
  submitted: true,
  witnessed: true,
  witnessedBy: admin.id,
  witnessedDaysAgo: 70,
  reproductionDaysAgo: 70,
});

// Admin requests changes
await login(page, TEST_ADMIN);
await page.goto(`/submissions/${id}`);

await page.click('button:has-text("Request Changes")');
await page.waitForSelector('textarea[name="content"]');
await page.fill('textarea[name="content"]', "Please add more photos");
await page.click('button[type="submit"]:has-text("Send")');

await page.waitForURL(/\/admin\/(witness-queue|queue)\//);

// Member edits and resubmits
await logout(page);
await login(page, TEST_USER);
await page.goto(`/submissions/${id}`);

// Changes requested banner should be visible
await expect(page.locator('text=Changes Requested')).toBeVisible();

// Make edits
await page.fill('input[name="ph"]', "7.5");

// Resubmit (clears changes_requested fields)
await page.click('button[type="submit"]:has-text("Resubmit")');
await page.waitForLoadState("networkidle");

// Verify in database
const db = await getTestDatabase();
const submission = await db.get("SELECT * FROM submissions WHERE id = ?", id);
expect(submission.changes_requested_on).toBeNull(); // Cleared
expect(submission.witnessed_by).toBeTruthy(); // Preserved
await db.close();
```

**Critical verifications**:
- `changes_requested_*` fields are cleared on resubmit
- Witness data (`witnessed_by`, `witnessed_on`, `witness_verification_status`) is PRESERVED

### Pattern: Witness Confirmation/Decline

```typescript
// Witness confirmation (approve for screening)
await page.click('button:has-text("Approve for Screening")');
await page.waitForURL(/\/admin\/(witness-queue|queue)\//);

// Witness decline (request more info - opens dialog)
await page.click('button:has-text("Request More Info")');
await page.waitForSelector('form#witnessForm');
await page.fill('textarea[name="reason"]', "Additional documentation is needed"); // minlength=10
await page.click('form#witnessForm button[type="submit"]');
await page.waitForURL(/\/admin\/(witness-queue|queue)\//);
```

**Key insights**:
- "Approve for Screening" = confirm witness (not "Confirm Witness")
- "Request More Info" = decline witness (opens dialog, not immediate action)
- Decline dialog requires reason with at least 10 characters

## Debugging Techniques

### 1. Read Error Context Files

When a test fails, Playwright saves the full page state:

```bash
cat test-results/test-name/error-context.md
```

This shows the accessibility tree - every element on the page with its text, state (disabled/enabled), and visibility.

**Example output**:
```yaml
- button "Approve for Screening" [ref=e114]
- button "Request More Info" [ref=e115]
- textbox "Points" [disabled] [ref=e103]
```

Tells you:
- Exact button text to use
- Which elements are disabled
- What's actually on the page

### 2. Check Form Schemas

Before writing form tests, check the validation schema:

```bash
cat src/forms/approval.ts
```

```typescript
export const approvalSchema = z.object({
  group_id: z.string().min(1, "Species selection required"), // REQUIRED!
  points: z.string().transform(val => parseInt(val)),
  // ... optional fields ...
});
```

Tells you which fields are required and their constraints.

### 3. Use Headed Mode for Visual Debugging

```bash
npm run test:e2e:headed -- e2e/submission-lifecycle.spec.ts
```

Watch the browser and see:
- Where elements are located
- When HTMX swaps occur
- Which buttons are actually present
- Dialog opening/loading behavior

### 4. Console Logging Current State

```typescript
// After an action, log current state
await page.click('button');
console.log("Current URL:", page.url());
console.log("Page title:", await page.title());

// Check if element exists
const exists = await page.locator('button:has-text("Approve")').count();
console.log("Approve buttons found:", exists);

// Database state
const db = await getTestDatabase();
const sub = await db.get("SELECT * FROM submissions WHERE id = ?", id);
console.log("Submission state:", sub);
await db.close();
```

### 5. Check Playwright Logs

Error messages show the action attempts:

```
- waiting for locator('button:has-text("Approve")')
- locator resolved to <button>Approve</button>
- scrolling into view if needed
- element is visible, enabled and stable
- <textarea> intercepts pointer events  ← THE PROBLEM!
- retrying click action
```

This tells you another element is blocking the click.

## Common Failures and Solutions

### "Element is not enabled"

**Cause**: HTMX hasn't finished loading/enabling the element

**Solution**: Wait for `:not([disabled])` state:
```typescript
await page.waitForSelector('input:not([disabled])');
```

### "Element intercepts pointer events"

**Cause**: Another element (dialog backdrop, modal, overlay) is blocking the click

**Solution**: Click the correct element within the context:
```typescript
// Instead of:
await page.click('button[type="submit"]');

// Use:
await page.click('form#specificForm button[type="submit"]');
```

### "locator resolved to X elements"

**Cause**: Selector matches multiple elements

**Solution**: Be more specific:
```typescript
// Add context
await page.click('#dialog button:has-text("Save")');

// Or use .first() deliberately
await page.locator('button:has-text("Approve")').first().click();
```

### "Timeout waiting for navigation"

**Cause**: Form validation failed (no redirect occurs)

**Solution**: Check required fields and validation schema

### "locator resolved to hidden element"

**Cause**: Element is in DOM but not visible (display:none, hidden container)

**Solution**: Wait for visible state:
```typescript
await page.waitForSelector('input:visible', { state: 'visible' });
```

## Performance Optimization

### Use Database Helpers, Not UI

**Slow approach** (3-5 seconds per test):
```typescript
test("test workflow", async ({ page }) => {
  await login(page);
  await page.goto("/submissions/new");
  // ... fill 20+ fields via UI ...
  await page.click('button:has-text("Submit")');
  // ... wait for HTMX ...
  // ... admin login ...
  // ... witness confirmation ...
  // NOW test the actual thing we care about
});
```

**Fast approach** (0.5 seconds per test):
```typescript
test("test workflow", async ({ page }) => {
  // Create test data directly in database
  const id = await createTestSubmission({
    submitted: true,
    witnessed: true,
    reproductionDaysAgo: 70,
  });

  // Login and go directly to the state we want to test
  await login(page, TEST_ADMIN);
  await page.goto(`/submissions/${id}`);

  // Test only the interaction we care about
  await fillTomSelectTypeahead(page, "group_id", "Poecilia reticulata");
  await page.selectOption('select[name="points"]', "10");
  await page.click('button:has-text("Approve")');

  // Verify
  // ...
});
```

**Rule of thumb**: If you're testing workflow X, use database helpers to set up state, then test only X via UI.

### Example: Testing Approval (Not Form Submission)

```typescript
// ❌ SLOW - Tests form submission AND approval
test("approval flow", async ({ page }) => {
  await page.goto("/submissions/new");
  // Fill entire form (20+ fields, 3-4 seconds)
  await page.click('button:has-text("Submit")');
  // Admin witness (1-2 seconds)
  // Test approval (what we actually care about)
});

// ✅ FAST - Tests only approval
test("approval flow", async ({ page }) => {
  const id = await createTestSubmission({ /* ready for approval */ });
  // Test approval directly (0.5 seconds)
});
```

Separate concerns:
- `form-submission.spec.ts` - Tests the form itself
- `submission-lifecycle.spec.ts` - Tests state transitions (uses DB helpers)

## Real-World Evolution: Debugging a Test

This shows the iterative process of fixing a failing test.

### Iteration 1: Wrong URL
```typescript
await page.goto("/bap-form");
```
**Error**: Timeout waiting for #bapForm
**Fix**: Correct URL is `/submissions/new`

### Iteration 2: Wrong Button Text
```typescript
await page.click('button:has-text("Confirm Witness")');
```
**Error**: Timeout waiting for button
**Fix**: Actual text is "Approve for Screening" (checked Pug template)

### Iteration 3: Wrong URL Pattern
```typescript
await page.waitForURL(/\/admin\/queue\//);
```
**Error**: Timeout - navigated to /admin/witness-queue/fish
**Fix**: Use flexible pattern `/\/admin\/(witness-queue|queue)\//`

### Iteration 4: Missing Waiting Period
```typescript
const id = await createTestSubmission({ witnessed: true, witnessedDaysAgo: 70 });
```
**Error**: No "Approve" button appears - shows "Awaiting: 0 of 60 days"
**Fix**: Also set `reproductionDaysAgo: 70` (waiting period based on fry age, not witness date)

### Iteration 5: Missing Required Field
```typescript
await page.selectOption('select[name="points"]', "10");
await page.click('button:has-text("Approve")');
```
**Error**: No redirect occurs (silent validation failure)
**Fix**: Must select species first - `group_id` is required field

### Iteration 6: Wrong Field Type
```typescript
await page.fill('input[name="points"]', "10");
```
**Error**: Element is disabled and never enables
**Fix**: It's a dropdown: `await page.selectOption('select[name="points"]', "10")`

### Iteration 7: Success!
```typescript
const id = await createTestSubmission({
  submitted: true,
  witnessed: true,
  witnessedDaysAgo: 70,
  reproductionDaysAgo: 70,
});

await login(page, TEST_ADMIN);
await page.goto(`/submissions/${id}`);

const approveButton = page.locator('button:has-text("Approve")').first();
await approveButton.scrollIntoViewIfNeeded();
await page.waitForLoadState("networkidle");

await fillTomSelectTypeahead(page, "group_id", "Poecilia reticulata");
await page.waitForTimeout(500);

await page.selectOption('select[name="points"]', "10");
await approveButton.click();

await page.waitForURL(/\/admin\/(witness-queue|queue)\//);

const db = await getTestDatabase();
const submission = await db.get("SELECT * FROM submissions WHERE id = ?", id);
expect(submission.approved_on).toBeTruthy();
await db.close();
```

**Time to success**: 7 iterations, each fixing one specific issue discovered through error messages and error context files.

## Key Takeaways

1. **HTMX elements exist before they're ready** - Use `:not([disabled])` and `:visible`
2. **Form validation fails silently** - Check schemas in `src/forms/*.ts`
3. **Button text ≠ documentation** - Verify with Pug templates or codegen
4. **Waiting period = fry age** - Based on `reproduction_date`, not `witnessed_on`
5. **Dialogs load in two steps** - Open (sync) + content load (async)
6. **Use database for setup** - Only test UI interactions you care about
7. **Read error context files** - They show exactly what's on the page
8. **Be specific with selectors** - Context matters when multiple elements match
9. **CI database is empty by default** - Seed test data in setup-e2e-db.ts, not migrations
10. **Debug logging reveals environment differences** - Add logging to understand CI vs local behavior

The most important skill: **Iterate based on actual error messages**, not assumptions. Every test failure teaches you something about how HTMX works in this application.

### Debugging "Flaky" Tests

If tests pass locally but fail intermittently in CI:

1. **Add comprehensive logging** to understand what's different
2. **Check test data** - Does the data exist in both environments?
3. **Compare API responses** - Do searches return the same results?
4. **Don't assume timing** - Most "timing issues" are actually missing/different data

See Issue #180 for a real-world example where weeks of timing fixes failed, but logging revealed the CI database was simply empty.

## Future Enhancements

1. **Image upload tests** - Test file upload flow and image preview
2. **Session persistence tests** - Test sessionStorage behavior across reloads
3. **Visual regression testing** - Add screenshot comparison tests
4. **Cross-browser testing** - Run tests on Firefox and WebKit
5. **Mobile viewport testing** - Add responsive design tests
6. **Accessibility testing** - Add automated a11y checks
7. **Performance testing** - Add Core Web Vitals monitoring
8. **Post-approval edit test** - Fix HTMX dialog timing to complete this test
