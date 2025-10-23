# Mulm Test Coverage Analysis Report

## Executive Summary

The Mulm codebase has **24 unit tests** covering core business logic and **5 e2e tests** using Playwright for integration testing. The test coverage is moderate with some critical gaps in route handlers, advanced database operations, and admin workflows.

**Current Status:**
- Unit Tests: 24 test files using Node.js native test runner
- E2E Tests: 5 Playwright test suites
- Test Framework: Native Node.js `test` module with `assert`
- Database Testing: In-memory SQLite with migrations
- Total Lines of Code: ~6,900 in db + routes layer

---

## Part 1: Current Test Coverage Summary

### What IS Being Tested (24 Unit Tests)

#### Authentication & Authorization (3 tests)
- `accountLockout.test.ts` - Account lockout after failed attempts (comprehensive)
- `webauthn.test.ts` - WebAuthn credential management and challenge lifecycle
- `passwordComplexity.test.ts` - Password complexity validation

#### Submission State Machine (5 tests)
- `submission-state-invariants.test.ts` - All state transitions maintain invariants (Issue #172)
- `approval-validation.test.ts` - Approval workflow state validation
- `request-changes-validation.test.ts` - Request changes validation (Issue #176)
- `submission-deletion.test.ts` - Deletion authorization
- `submissionStatus.test.ts` - Submission status calculations

#### Utility Functions (6 tests)
- `dateFormat.test.ts` - Date formatting utilities
- `awards.test.ts` - Award calculation logic
- `passwordComplexity.test.ts` - Password validation
- `image-processor.test.ts` - Image resizing/processing
- `waitingPeriod.test.ts` - Witness waiting period calculations
- `rateLimiter.test.ts` - Rate limiting logic

#### Species Management (5 tests)
- `specialty-award-manager.test.ts` - Specialty award checking for split schema
- `species-admin-list.test.ts` - Admin species listing
- `species-group-crud.test.ts` - Species group creation/edit
- `species-typeahead.test.ts` - Species search functionality
- `species-split-names.test.ts` - Split schema name handling

#### Form & Data Processing (4 tests)
- `upload.test.ts` - Image upload transaction handling
- `witness-integration.test.ts` - Witness workflow integration
- `cleanup.test.ts` - Database cleanup operations
- `pug-templates.test.ts` - Template rendering validation
- `get-breeders-for-species.test.ts` - Species breeder queries
- `get-canonical-species-name.test.ts` - Canonical species name resolution

### E2E Tests (5 Playwright Tests)
- `auth.spec.ts` - Basic login/logout flow (7 lines of test code)
- `admin-workflows.spec.ts` - Changes-requested workflow (150+ lines, comprehensive)
- `form-submission.spec.ts` - Draft form submission (80+ lines, partial)
- `tom-select-demo.spec.ts` - Tom Select typeahead integration
- `hello-world.spec.ts` - Basic health check

---

## Part 2: Major Gaps and Missing Tests

### HIGH PRIORITY - Critical Business Logic NOT Tested

#### 1. **Admin Routes (1,237 lines) - 0% Test Coverage**
**File:** `src/routes/admin.ts`

Missing test coverage for:
- `requireAdmin()` middleware - Admin authorization checks
- `viewMembers()` - Member listing and filtering
- `updateMemberFields()` - Member data updates
- `sendRequestChanges()` - Request changes submission (only e2e)
- `confirmWitnessAction()` - Witness confirmation
- `declineWitnessForm()` / `declineWitnessAction()` - Witness decline workflow
- `inviteMember()` - Member invitation logic
- `approveSubmission()` - Full approval workflow (most complex)
- `checkMemberLevels()` - Level calculation endpoint
- `checkMemberSpecialtyAwards()` - Award checking endpoint
- `saveApprovedSubmissionEdits()` - Post-approval edits (Issue #xxx)

**Why it matters:** These are critical admin workflows that control the approval process

#### 2. **Submission Routes (586 lines) - Partial Coverage**
**File:** `src/routes/submission.ts`

Missing test coverage for:
- `renderSubmissionForm()` - Form rendering with template data
- `create()` - Submission creation from form
- `update()` - Submission updates/edits
- `remove()` - Submission deletion with auth
- `renderEditMedia()` - Media editing form
- `updateMedia()` - Media updates with image processing
- `videoPreview()` - Video URL preview generation

**Why it matters:** Core user-facing submission workflow

#### 3. **Authentication Routes (470 lines) - Minimal Coverage**
**File:** `src/routes/auth.ts`

Missing test coverage for:
- `signup()` - New account creation
- `passwordLogin()` - Password authentication with lockout integration
- `resetPassword()` - Password reset flow
- `googleOAuth()` - Google OAuth integration
- `passkeyRegisterOptions()` - WebAuthn registration flow
- `passkeyRegisterVerify()` - WebAuthn registration verification
- `passkeyLoginOptions()` - WebAuthn login options
- `passkeyLoginVerify()` - WebAuthn login verification
- `deletePasskey()` - Passkey deletion
- `renamePasskey()` - Passkey renaming

**Why it matters:** Critical security paths, multiple authentication methods

#### 4. **Account Routes (268 lines) - 0% Unit Test Coverage**
**File:** `src/routes/account.ts`

Missing test coverage for:
- `viewAccountSettings()` - Account settings page rendering
- `updateAccountSettings()` - Password changes and account updates
- `unlinkGoogleAccount()` - OAuth account removal
- `saveTankPresetRoute()` - Tank preset CRUD operations
- `deleteTankPresetRoute()` - Tank preset deletion
- `editTankPresetForm()` - Tank preset form rendering

**Why it matters:** User-facing account management features

#### 5. **Database Layer - Partial Coverage**

**submissions.ts (712 lines) - Gaps:**
- `createSubmission()` - Form-to-DB conversion not tested
- `updateSubmission()` - Direct submission updates
- `deleteSubmissionWithAuth()` - Auth-protected deletion
- `getOutstandingSubmissions()` - Admin queue queries
- `getWitnessQueue()` - Witness queue queries
- `getWaitingPeriodSubmissions()` - Waiting period queue

**members.ts (356 lines) - Gaps:**
- `createMember()` - Member creation with password/oauth
- `updateMember()` - Member field updates
- `getMembersList()` - Member listing
- `grantAward()` - Award granting logic
- `getMemberWithAwards()` - Award aggregation

**species.ts (1,773 lines) - Gaps:**
- `createSpeciesGroup()` - Species group creation
- `getSpeciesGroup()` - Species group retrieval
- `ensureNameIdsForGroupId()` - Name ID reconciliation
- Most species expert/admin operations

#### 6. **Level & Award Managers - 0% Unit Tests**

**levelManager.ts** - No dedicated tests
- `checkAndUpdateMemberLevel()` - Level calculation and updates
- `checkAllMemberLevels()` - Bulk level checking
- Level upgrade email notifications

**specialtyAwardManager.ts** - Only 1 test
- `checkAndGrantSpecialtyAwards()` - Award granting logic
- Meta-award calculations
- Award deduplication
- Award notification emails

#### 7. **Complex Form Validations - Not Tested**
**Files:** `src/forms/*.ts`

Missing tests for:
- `submission.ts` - Form field validation, conditional requirements
- `approval.ts` - Approval form validation
- `approvedEdit.ts` - Post-approval edit validation
- `tank.ts` - Tank preset validation
- `species-explorer.ts` - Species form validation

#### 8. **Member & Standing Routes - 0% Coverage**
**Files:** `src/routes/standings.ts`, `src/routes/member.ts`

Missing test coverage for:
- `annual()` - Annual standings calculation
- `lifetime()` - Lifetime standings calculation
- `member.view()` - Member profile page with submissions

**Why it matters:** Public-facing stats/leaderboard features

#### 9. **Specialized Routes - 0% Coverage**
- `typeahead.ts` - Search functionality (searchMembers, searchSpecies)
- `tank.ts` - Tank CRUD operations
- `species.ts` - Species detail page
- `activityDemo.ts`, `emailDemo.ts`, `display.ts` - Support routes

#### 10. **Admin Species Management - Gaps**
**File:** `src/routes/admin/species.ts`

Species admin operations not tested:
- Species name merging
- Species edits and validation
- Species category management

---

## Part 3: Test Patterns in Use

### Current Patterns to Follow

All unit tests follow consistent patterns:

```typescript
// 1. Setup
void describe("Feature Name", () => {
  let db: Database;
  
  beforeEach(async () => {
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = OFF;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);
  });

  afterEach(async () => {
    await db.close();
  });

  // 2. Test groups
  void describe("Subfeature", () => {
    void test("should do specific thing", async () => {
      // 3. Setup test data
      const result = await someFunction(testData);
      
      // 4. Assert
      assert.strictEqual(result.field, expectedValue);
    });
  });
});
```

### Key Patterns

1. **In-memory SQLite** - Each test gets fresh database with migrations
2. **Assertion style** - Uses Node.js built-in `assert` module (not Jest/Chai)
3. **Async/await** - All async operations properly awaited
4. **Helper functions** - Create mock data builders in beforeEach
5. **Test isolation** - No shared state between tests
6. **Error testing** - `assert.rejects()` for error cases
7. **Invariant testing** - Custom helper `assertSubmissionInvariantsHold()` for state machine

### E2E Patterns

E2E tests use:
- Playwright with `@playwright/test`
- Test database helpers (`getTestDatabase()`, `createTestSubmission()`)
- Login helpers (`login()`, `logout()`)
- UI helpers (`fillTomSelectTypeahead()`, `selectTomSelectMultiple()`)
- Serial mode for tests that share state

---

## Part 4: Infrastructure Observations

### Test Configuration
- **Test runner:** Node.js native `test` module (tsx runner)
- **Command:** `NODE_ENV=test tsx --test src/__tests__/*.test.ts`
- **Watch mode:** `NODE_ENV=test tsx --test --watch 'src/**/*.test.ts'`

### Database Testing
- Uses `sqlite` + `sqlite3` packages
- Migrations applied fresh each test
- Foreign keys disabled for most tests
- In-memory `:memory:` database

### Missing Test Infrastructure
1. **No test utilities library** - Helpers scattered in different test files
2. **No faker integration** - Some tests create fake data manually
3. **No mock library** - Basic `mock.fn()` from Node.js test module
4. **No fixtures** - Test data created inline in each test
5. **No test database cleanup utility** - Each test manages own cleanup

---

## Part 5: Recommended Test Additions (Prioritized)

### Priority 1: Critical Business Logic (Value: HIGH, Effort: HIGH)

#### 1. Approval Workflow (Admin Route Tests)
**Files:** `src/routes/admin.ts::approveSubmission()` + `src/db/submissions.ts::approveSubmission()`

```
Test suite: admin-approval-workflow.test.ts
- Test approval of valid submission (witnessed + submitted)
- Test invalid state rejections (draft, denied, already approved)
- Test points calculation with all bonus combinations
- Test species ID assignment (common_name_id, scientific_name_id)
- Test level checking after approval
- Test specialty award checking after approval
- Test email notification triggers
- Test concurrent approvals (race conditions)
```

**Estimated effort:** 3 hours (complexity: logic is already in db layer)

#### 2. Admin Witness Workflow
**Files:** `src/routes/admin.ts::confirmWitnessAction()`, `::declineWitnessAction()`

```
Test suite: admin-witness-workflow.test.ts
- Test witness confirmation state transitions
- Test witness decline logic
- Test waiting period validation (70 days)
- Test queue removal after witness action
- Test email notifications
```

**Estimated effort:** 2 hours

#### 3. Submission Creation & Updates
**Files:** `src/routes/submission.ts::create()`, `::update()`, `::remove()`

```
Test suite: submission-crud.test.ts
- Test form-to-DB conversion (formToDB)
- Test draft creation
- Test resubmission after changes
- Test media updates with image processing
- Test deletion authorization
- Test form validation errors
```

**Estimated effort:** 3 hours

### Priority 2: Authentication Flows (Value: HIGH, Effort: MEDIUM)

#### 1. Password Authentication Route Tests
**File:** `src/routes/auth.ts::passwordLogin()`, `::signup()`, `::resetPassword()`

```
Test suite: auth-password-flow.test.ts
- Test successful signup
- Test duplicate email rejection
- Test password login success
- Test lockout after 5 failed attempts (already tested in service)
- Test password reset code generation
- Test reset with valid code
- Test reset with expired code
```

**Estimated effort:** 2.5 hours

#### 2. WebAuthn Flow Route Tests
**File:** `src/routes/auth.ts::passkeyRegister*()`, `::passkeyLogin*()`

```
Test suite: auth-webauthn-flow.test.ts
- Test registration challenge generation
- Test registration verification
- Test login challenge generation  
- Test login verification
- Test passkey deletion
- Test passkey renaming
```

**Estimated effort:** 3 hours (requires WebAuthn mocking)

#### 3. OAuth Flow Tests
**File:** `src/routes/auth.ts::googleOAuth()`

```
Test suite: auth-oauth-flow.test.ts
- Test OAuth state generation and validation
- Test Google user profile conversion
- Test first-time user signup via OAuth
- Test existing user OAuth linking
- Test OAuth unlinking
```

**Estimated effort:** 2 hours

### Priority 3: Member Management (Value: MEDIUM, Effort: MEDIUM)

#### 1. Member Route Tests
**Files:** `src/routes/member.ts`, `src/routes/account.ts`

```
Test suite: member-routes.test.ts
- Test member profile visibility (public, owner, admin)
- Test submission filtering by visibility
- Test points aggregation by program
- Test account settings form rendering
- Test password change validation
- Test tank preset CRUD
- Test tank preset list rendering
```

**Estimated effort:** 2.5 hours

#### 2. Admin Member Management
**File:** `src/routes/admin.ts::viewMembers()`, `::updateMemberFields()`, `::inviteMember()`

```
Test suite: admin-member-management.test.ts
- Test member list filtering and pagination
- Test member field updates
- Test member invite with email sending
- Test bulk level checking
- Test bulk award checking
```

**Estimated effort:** 2 hours

### Priority 4: Standings & Awards (Value: MEDIUM, Effort: MEDIUM)

#### 1. Standings Calculation Tests
**File:** `src/routes/standings.ts::annual()`, `::lifetime()`

```
Test suite: standings-calculations.test.ts
- Test annual standings point aggregation
- Test date range filtering (Aug 1 - Jul 31)
- Test lifetime standings grouping by level
- Test trophy data aggregation
- Test empty standings handling
```

**Estimated effort:** 1.5 hours

#### 2. Level Manager Tests
**File:** `src/levelManager.ts::checkAndUpdateMemberLevel()`, `::checkAllMemberLevels()`

```
Test suite: levelManager.test.ts (currently missing!)
- Test level calculation from points
- Test level upgrades (not downgrades)
- Test level stagnation (no change)
- Test email notification on upgrade
- Test bulk checking
- Test different programs (fish, plant, coral)
```

**Estimated effort:** 2 hours

#### 3. Specialty Award Manager Tests
**File:** `src/specialtyAwardManager.ts::checkAndGrantSpecialtyAwards()`

```
Enhance existing: specialty-award-manager.test.ts
- Test specialty award granting
- Test meta-award calculations (aggregate awards)
- Test award deduplication
- Test email notifications (currently disabled in test mode)
- Test error handling and partial failures
```

**Estimated effort:** 1.5 hours (enhancement)

### Priority 5: Database Operations (Value: MEDIUM, Effort: HIGH)

#### 1. Submission Database Tests
**File:** `src/db/submissions.ts` (gaps)

```
Test suite: db-submissions-complete.test.ts
- Test getOutstandingSubmissions() with filtering
- Test getWitnessQueue() with 70-day cutoff
- Test getWaitingPeriodSubmissions() calculations
- Test bulk query performance
- Test concurrent updates
```

**Estimated effort:** 2.5 hours

#### 2. Species Database Tests
**File:** `src/db/species.ts` (1,773 lines, critical)

```
Test suite: db-species-complete.test.ts
- Test createSpeciesGroup() uniqueness
- Test getSpeciesGroup() caching
- Test addCommonName() and addScientificName()
- Test ensureNameIdsForGroupId() reconciliation
- Test split schema queries with joins
- Test species merge operations
```

**Estimated effort:** 3.5 hours

#### 3. Members Database Tests
**File:** `src/db/members.ts` (356 lines)

```
Test suite: db-members-complete.test.ts
- Test createMember() with various credential types
- Test getMembersList() with filters
- Test updateMember() field-by-field
- Test grantAward() uniqueness
- Test award aggregation queries
- Test Google account linking/unlinking
```

**Estimated effort:** 2 hours

### Priority 6: Form Validation (Value: LOW-MEDIUM, Effort: MEDIUM)

#### 1. Form Validation Tests
**Files:** `src/forms/*.ts`

```
Test suite: forms-validation.test.ts
- Test submission form field validation
- Test conditional field requirements (species_type determines visible fields)
- Test approval form bonus validation
- Test tank preset validation
- Test error message generation
```

**Estimated effort:** 2 hours

### Priority 7: Edge Cases & Error Handling (Value: MEDIUM, Effort: HIGH)

#### 1. Concurrent Operation Tests
```
Test suite: concurrency.test.ts
- Race condition: simultaneous approvals
- Race condition: simultaneous witness confirmations
- Race condition: level updates during approval
- Race condition: award granting
```

**Estimated effort:** 2.5 hours

#### 2. Error Recovery Tests
```
Test suite: error-recovery.test.ts
- Database connection failures
- Image processing failures
- Email sending failures
- OAuth provider unavailability
- Partial transaction rollbacks
```

**Estimated effort:** 2 hours

---

## Part 6: Test Infrastructure Improvements Needed

### 1. Centralized Test Helpers Library
**Create:** `src/__tests__/testHelpers.ts`

```typescript
// Extract common patterns
export class TestDatabase {
  static async create(): Promise<Database>
  async close()
}

export class TestMemberFactory {
  static createMember(overrides?): Promise<TestMember>
  static createAdmin(overrides?): Promise<TestMember>
}

export class TestSubmissionFactory {
  static createDraft(memberId): Promise<number>
  static createSubmitted(memberId): Promise<number>
  static createWitnessed(memberId, witnessId): Promise<number>
  static createApproved(memberId, approverId): Promise<number>
}
```

**Estimated effort:** 2 hours

### 2. Test Fixtures
**Create:** `src/__tests__/fixtures/` directory

Extract hardcoded test data into reusable fixtures

**Estimated effort:** 1 hour

### 3. Mock E-mail Service
**Currently:** Emails disabled in test mode (NODE_ENV=test)

Add proper mocking:
```typescript
export class MockEmailService {
  static sentEmails: Email[] = []
  static async send(email): Promise<void>
  static findEmail(query): Email
  static reset()
}
```

**Estimated effort:** 1.5 hours

### 4. Improve E2E Test Helpers
**Current issues:**
- Test database cleanup is manual
- No consistent test data factory
- No assertion helpers for common scenarios

**Improvements:**
- Add `TestDataManager` class
- Add `AssertionHelpers` for form validation
- Add `UIHelpers` for common patterns

**Estimated effort:** 2 hours

---

## Part 7: Known Issues & Test-Related TODOs

### Current TODOs in Code
1. **src/specialtyAwardManager.ts:117** - "TODO: Send email notification if not disabled"
   - Email notifications disabled in test mode
   - Need to verify actual email sending in non-test environments

2. **src/routes/tank.ts:29** - "TODO handle getting name[Symbol].."
   - Incomplete tank handling

3. **src/routes/submission.ts:307** - "TODO figure out how to avoid read after write"
   - Race condition or consistency issue after submission creation

4. **src/forms/approvedEdit.ts:26** - "TODO: Convert to multiSelect"
   - Post-approval edit form needs enhancement

### Related Issues (from e2e tests)
- **Issue #169** - Changes-requested workflow (now has e2e coverage, needs unit test)
- **Issue #172** - Submission state machine invariants (comprehensive coverage added)
- **Issue #176** - Request changes validation (comprehensive coverage added)

---

## Part 8: Recommended Next Steps

### Immediate (Week 1)
1. Add `admin-approval-workflow.test.ts` (Priority 1.1) - 3 hours
2. Add `submission-crud.test.ts` (Priority 2.3) - 3 hours
3. Create test helpers library (Infrastructure 1) - 2 hours
4. Total: 8 hours

### Short term (Week 2-3)
1. Add `auth-password-flow.test.ts` (Priority 2.1) - 2.5 hours
2. Add `admin-witness-workflow.test.ts` (Priority 1.2) - 2 hours
3. Add `member-routes.test.ts` (Priority 3.1) - 2.5 hours
4. Add `levelManager.test.ts` (Priority 4.2) - 2 hours
5. Total: 9 hours

### Medium term (Week 3-4)
1. Add database layer tests (Priority 5) - 8 hours
2. Add WebAuthn flow tests (Priority 2.2) - 3 hours
3. Add standings tests (Priority 4.1) - 1.5 hours

### Long term (As time permits)
1. Edge case and concurrent operation tests (Priority 7)
2. Form validation tests (Priority 6)
3. Additional infrastructure improvements

---

## Summary Statistics

| Metric | Current | Recommended |
|--------|---------|-------------|
| Unit test files | 24 | 35+ |
| Test coverage % | ~30% (estimated) | ~70% (estimated) |
| Routes tested | 3-4 | 12+ |
| Database functions tested | ~40% | ~85% |
| E2E test suites | 5 | 8+ |
| Test helper utilities | Minimal | Comprehensive |
| Infrastructure tests | 0 | 5+ |

---

## Conclusion

The Mulm codebase has solid foundation tests for complex business logic (state machines, specialty awards, authentication security). However, there are significant gaps in:

1. **Route handler testing** (admin, submission, account routes)
2. **Database function coverage** (especially species operations)
3. **Authentication flow testing** (WebAuthn, OAuth, password reset)
4. **Integration between layers** (form → route → database)

The test infrastructure is good but would benefit from centralized helpers and fixtures to reduce duplication and improve maintainability.

**Recommended focus:** Address Priority 1 items first as they cover critical business logic (approval workflow, witness workflow, submission CRUD). These are the most frequently used features and highest-value test additions.
