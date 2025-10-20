# Submission State Machine - Testing Strategy

## Overview

This document outlines the submission state machine, existing test coverage, and recommendations for comprehensive testing to ensure correctness.

## State Machine Diagram

```
                            ┌─────────────────────────────┐
                            │         DRAFT               │
                            │  (no submitted_on)          │
                            └──────────────┬──────────────┘
                                           │ submit
                                           ▼
                            ┌─────────────────────────────┐
                            │    PENDING-WITNESS          │
                            │ (witness_status=pending)    │
                            └──┬────────────────────┬─────┘
                               │ confirm            │ decline
                               ▼                    ▼
                    ┌──────────────────┐   ┌────────────────────┐
                    │  WAITING-PERIOD  │   │  PENDING-APPROVAL  │
                    │  (witnessed_on)  │   │ (witness=declined) │
                    └────────┬─────────┘   └─────────┬──────────┘
                             │ wait 30-60 days        │
                             ▼                        │
                    ┌──────────────────┐             │
                    │ PENDING-APPROVAL │◄────────────┘
                    │ (eligible)       │
                    └─────┬──────┬─────┘
                          │      │
                ┌─────────┘      └────────┐
                │                          │
                ▼                          ▼
     ┌──────────────────┐      ┌──────────────────┐
     │   CHANGES-        │      │    APPROVED      │
     │   REQUESTED       │      │  (approved_on)   │
     └─────┬─────────────┘      └──────────────────┘
           │ resubmit (preserves witness data)
           │
           └──────────► (back to PENDING-APPROVAL)

                               ┌──────────────────┐
                               │     DENIED       │
                               │  (denied_on)     │
                               └──────────────────┘
```

## Key State Transitions

### 1. **DRAFT → PENDING-WITNESS**
- **Trigger**: User clicks "Submit" on form
- **Code**: `src/routes/submission.ts:356` (submitSubmission)
- **Changes**: Sets `submitted_on`, `witness_verification_status = 'pending'`
- **Validations**: Form must be complete
- **Side Effects**: None (no email sent at this stage)

### 2. **PENDING-WITNESS → WAITING-PERIOD**
- **Trigger**: Admin confirms witness
- **Code**: `src/db/submissions.ts` (confirmWitness)
- **Changes**:
  - `witness_verification_status = 'confirmed'`
  - `witnessed_by = admin_id`
  - `witnessed_on = NOW()`
- **Validations**:
  - Cannot witness own submission
  - Must be in 'pending' state
  - Prevents race conditions via transaction
- **Side Effects**: Email to member (onScreeningApproved)

### 3. **PENDING-WITNESS → PENDING-APPROVAL**
- **Trigger**: Admin declines witness
- **Code**: `src/db/submissions.ts` (declineWitness)
- **Changes**:
  - `witness_verification_status = 'declined'`
  - `witnessed_by = admin_id`
  - `witnessed_on = NOW()`
- **Validations**: Same as confirm
- **Side Effects**: Email to member (onScreeningRejected)

### 4. **WAITING-PERIOD → PENDING-APPROVAL**
- **Trigger**: Time-based (30 days for marine, 60 days for others)
- **Code**: `src/utils/waitingPeriod.ts`
- **Changes**: None (status is calculated, not stored)
- **Validations**: Must have `witnessed_on` date
- **Side Effects**: None

### 5. **PENDING-APPROVAL → CHANGES-REQUESTED**
- **Trigger**: Admin requests changes
- **Code**: `src/routes/admin.ts:348` (sendRequestChanges)
- **Changes**:
  - `changes_requested_on = NOW()`
  - `changes_requested_by = admin_id`
  - `changes_requested_reason = text`
  - **PRESERVES**: `witnessed_by`, `witnessed_on`, `witness_verification_status`
- **Validations**: Submission must be submitted but not approved/denied
- **Side Effects**: Email to member (onChangesRequested)

### 6. **CHANGES-REQUESTED → PENDING-APPROVAL** (Resubmit)
- **Trigger**: User edits and resubmits
- **Code**: `src/routes/submission.ts:357`
- **Changes**:
  - Clears `changes_requested_*` fields
  - **PRESERVES**: All witness data
- **Validations**: Must be submission owner
- **Side Effects**: None (returns to queue silently)

### 7. **PENDING-APPROVAL → APPROVED**
- **Trigger**: Admin approves submission
- **Code**: `src/routes/admin.ts:673` (approveSubmission), `src/db/submissions.ts` (approveSubmission)
- **Changes**:
  - `approved_on = NOW()`
  - `approved_by = admin_id`
  - `points = calculated`
  - Sets species links
- **Validations**: Must be admin, submission must be eligible
- **Side Effects**:
  - Email to member (onSubmissionApprove)
  - Activity feed entry
  - Award creation/updates

### 8. **PENDING-APPROVAL → DENIED**
- **Trigger**: Admin denies submission
- **Code**: `src/db/submissions.ts` (denySubmission)
- **Changes**:
  - `denied_on = NOW()`
  - `denied_by = admin_id`
  - `denied_reason = text`
- **Validations**: Must be admin
- **Side Effects**: Email to member

### 9. **APPROVED → APPROVED** (Post-Approval Edits)
- **Trigger**: Admin edits approved submission
- **Code**: `src/routes/admin.ts:1044` (saveApprovedSubmissionEdits)
- **Changes**: Can update most fields except dates/witness data
- **Validations**: Cannot edit own submission
- **Side Effects**:
  - Activity feed entry
  - Award recalculation
  - Email if points change

## Existing Test Coverage

### ✅ Well Covered

1. **`submissionStatus.test.ts`** (Status Calculation)
   - ✅ All status calculations
   - ✅ Priority order (denied > approved > changes-requested > etc)
   - ✅ Waiting period integration
   - **Missing**: Changes-requested status test

2. **`witness-integration.test.ts`** (Witness Workflow)
   - ✅ Confirm/decline witness operations
   - ✅ Self-witnessing prevention
   - ✅ State transition validation
   - ✅ Race condition handling
   - ✅ Concurrent operations
   - ✅ Foreign key integrity
   - ✅ Transaction atomicity
   - ✅ Waiting period integration
   - ✅ Real-world workflows

3. **`waitingPeriod.test.ts`** (Waiting Period Logic)
   - ✅ Date calculations
   - ✅ Species type variations

### ⚠️ Partially Covered

1. **Submission Creation & Editing**
   - ⚠️ No tests for draft → submitted transition
   - ⚠️ No tests for form validation
   - ⚠️ No tests for image upload handling

2. **Approval/Denial**
   - ⚠️ No integration tests for approval workflow
   - ⚠️ No tests for points calculation
   - ⚠️ No tests for species linking

### ❌ Not Covered

1. **Changes Requested Workflow** 🔴 **CRITICAL**
   - ❌ Request changes action
   - ❌ Witness data preservation
   - ❌ Edit while in changes-requested state
   - ❌ Resubmit clears changes_requested fields
   - ❌ Email notifications

2. **Post-Approval Edits** 🔴 **CRITICAL**
   - ❌ Edit approved submission
   - ❌ Field validation for approved edits
   - ❌ Cannot edit own submission
   - ❌ Award recalculation
   - ❌ Activity feed updates

3. **End-to-End Workflows**
   - ❌ Complete lifecycle: draft → submit → witness → wait → approve
   - ❌ Edge case: witness → changes requested → resubmit → approve
   - ❌ Edge case: witness → changes requested → resubmit → deny

## Recommended New Tests

### Priority 1: Changes Requested Workflow (New Feature)

Create `src/__tests__/changes-requested-workflow.test.ts`:

```typescript
describe("Changes Requested Workflow", () => {
  describe("Basic Operations", () => {
    test("should request changes on submitted submission");
    test("should preserve witness data when requesting changes");
    test("should send email notification");
    test("should not allow changes request on draft submission");
    test("should not allow changes request on approved submission");
  });

  describe("Editing with Changes Requested", () => {
    test("should allow member to edit submission when changes requested");
    test("should not allow member to edit others' submissions");
    test("should preserve witness data during edit");
  });

  describe("Resubmit After Changes", () => {
    test("should clear changes_requested fields on resubmit");
    test("should preserve witness data on resubmit");
    test("should return submission to pending-approval queue");
    test("should not trigger witness screening again");
  });

  describe("Status Display", () => {
    test("should show changes-requested status correctly");
    test("should show proper badge/color");
  });
});
```

### Priority 2: Post-Approval Edits

Create `src/__tests__/post-approval-edits.test.ts`:

```typescript
describe("Post-Approval Editing", () => {
  describe("Permission Checks", () => {
    test("should allow admin to edit approved submission");
    test("should prevent member from editing approved submission");
    test("should prevent admin from editing own approved submission");
  });

  describe("Field Updates", () => {
    test("should update common fields");
    test("should update points and recalculate awards");
    test("should update species and maintain links");
    test("should not allow editing witness data");
    test("should not allow editing approval data");
  });

  describe("Side Effects", () => {
    test("should create activity feed entry");
    test("should update awards when points change");
    test("should send email when points change significantly");
  });
});
```

### Priority 3: End-to-End State Machine Tests

Create `src/__tests__/submission-lifecycle.test.ts`:

```typescript
describe("Submission Complete Lifecycle", () => {
  test("happy path: draft → submit → witness → wait → approve", async () => {
    // 1. Create draft
    // 2. Submit
    // 3. Witness confirm
    // 4. Wait (mock time if needed)
    // 5. Approve
    // Verify state at each step
  });

  test("changes path: draft → submit → witness → changes → edit → resubmit → approve");

  test("decline path: draft → submit → witness decline → approve");

  test("deny path: draft → submit → witness → deny");

  test("complex path: witness → changes → edit → resubmit → changes again → approve");
});
```

### Priority 4: State Machine Invariants

Create `src/__tests__/submission-invariants.test.ts`:

```typescript
describe("State Machine Invariants", () => {
  test("cannot have both approved_on and denied_on set");
  test("cannot have changes_requested_on if approved_on is set");
  test("cannot have changes_requested_on if denied_on is set");
  test("if witnessed_on is set, witnessed_by must be set");
  test("if approved_on is set, points must be set");
  test("witness data should never be cleared once set");
  test("submitted_on should never be null if witness_verification_status != null");
});
```

## Testing Utilities Needed

### 1. State Machine Helper

```typescript
// src/__tests__/helpers/stateMachine.ts
export class SubmissionStateMachine {
  constructor(private db: Database);

  async createDraft(memberId: number): Promise<number>;
  async submit(submissionId: number): Promise<void>;
  async witnessConfirm(submissionId: number, adminId: number): Promise<void>;
  async witnessDecline(submissionId: number, adminId: number): Promise<void>;
  async requestChanges(submissionId: number, adminId: number, reason: string): Promise<void>;
  async editAndResubmit(submissionId: number, updates: Partial<Submission>): Promise<void>;
  async approve(submissionId: number, adminId: number, points: number): Promise<void>;
  async deny(submissionId: number, adminId: number, reason: string): Promise<void>;

  async getStatus(submissionId: number): Promise<SubmissionStatus>;
  async assertState(submissionId: number, expectedState: SubmissionStatus): Promise<void>;
}
```

### 2. Time Travel Helper

```typescript
// For testing waiting period
export class TimeMachine {
  async advanceDays(days: number): Promise<void>;
  async setDate(date: Date): Promise<void>;
  async reset(): Promise<void>;
}
```

### 3. Assertion Helpers

```typescript
export async function assertWitnessDataPreserved(
  before: Submission,
  after: Submission
): Promise<void> {
  assert.strictEqual(after.witnessed_by, before.witnessed_by);
  assert.strictEqual(after.witnessed_on, before.witnessed_on);
  assert.strictEqual(after.witness_verification_status, before.witness_verification_status);
}

export async function assertChangesRequestedCleared(submission: Submission): Promise<void> {
  assert.strictEqual(submission.changes_requested_on, null);
  assert.strictEqual(submission.changes_requested_by, null);
  assert.strictEqual(submission.changes_requested_reason, null);
}
```

## Integration Test Strategy

### Database Transactions
- Use in-memory SQLite for speed
- Run migrations for each test
- Ensure foreign key constraints are enabled
- Test transaction rollback scenarios

### Email Mocking
- Mock the notifications module
- Verify correct email is sent for each transition
- Verify email content contains expected information

### Time-Based Testing
- Mock `Date.now()` for waiting period tests
- Test boundary conditions (exactly 30 days, 59 days, 60 days, etc.)

### Race Condition Testing
- Use `Promise.allSettled()` for concurrent operations
- Verify exactly one succeeds
- Verify database state is consistent

## Performance Testing

### Load Tests
- Concurrent witness confirmations (already covered)
- Bulk approval operations
- Many changes requested → resubmit cycles

### Query Performance
- Verify indexes are used for queue queries
- Test with 10k+ submissions
- Monitor query execution time

## Manual Testing Checklist

### Changes Requested Flow
- [ ] Request changes on witnessed submission
- [ ] Verify email received
- [ ] Edit submission as member
- [ ] Resubmit
- [ ] Verify appears in approval queue
- [ ] Approve and verify witness data intact

### Post-Approval Edits
- [ ] Edit approved submission as admin
- [ ] Verify cannot edit own submission
- [ ] Change points and verify award updates
- [ ] Verify activity feed entry created

## Regression Testing

### When to Run Full Suite
- Before merging PRs that touch submission routes
- Before deploying to production
- Weekly on main branch

### Critical Path Tests
- Draft → Submit → Witness → Approve (< 2 seconds)
- Changes Requested → Edit → Resubmit (< 1 second)
- All status calculations (< 100ms)

## Monitoring & Observability

### Metrics to Track
- Submission state transition counts
- Average time in each state
- Changes requested → resubmit rate
- Witness confirmation rate
- Errors during state transitions

### Alerts
- Failed state transitions
- Orphaned submissions (in state > 90 days)
- Submissions with invalid state combinations

## Conclusion

The submission state machine is complex with 7 distinct states and 9+ transitions. The recent "changes requested" feature adds significant complexity by allowing re-editing while preserving witness data.

**Immediate Action Items**:
1. 🔴 **Add changes-requested workflow tests** (new feature, no coverage)
2. 🔴 **Add post-approval edit tests** (complex feature, no coverage)
3. 🟡 Add end-to-end lifecycle tests
4. 🟡 Add invariant tests
5. ⚪ Add performance/load tests

**Current Coverage**: ~60%
**Target Coverage**: >90%
**Estimated Effort**: 2-3 days

The existing tests for witness workflow and status calculation are excellent. Building on that foundation with the recommended tests will provide comprehensive coverage and confidence in the state machine's correctness.
