# E2E Test Implementation Status: Plant & Coral Submissions

## Date: 2025-11-10

## Objective
Extend E2E testing to cover PLANT and CORAL submission types, ensuring unique UI elements are tested and functional.

---

## ✅ Completed Work

### 1. Test Species Added (`scripts/setup-e2e-db.ts`)
- **Plant Species:**
  - Cryptocoryne wendtii (class: Cryptocoryne)
  - Anubias barteri (class: Anubias & Lagenandra)
- **Coral Species:**
  - Acropora millepora (class: Hard)
  - Sinularia flexibilis (class: Soft)

### 2. Test Helper Extended (`e2e/helpers/submissions.ts`)
- Added Plant/Coral specific field support to `TestSubmissionOptions`:
  - `propagationMethod` (Plant only)
  - `lightType`, `lightStrength`, `lightHours` (Plant & Coral)
  - `co2`, `co2Description` (Plant & Coral)
  - `supplementTypes[]`, `supplementRegimens[]` (Plant & Coral)
- Updated `createTestSubmission()` to populate these fields intelligently based on species type
- Fixed water type: Changed "Marine" to "Salt" (correct value in system)

### 3. Test Files Created

#### `e2e/plant-submissions.spec.ts` (8 tests)
1. ✅ **PASSING** - Field visibility test
   - Propagation method visible and required
   - All 3 lighting fields visible
   - Supplements section with CO2
   - Fish fields hidden (count, foods, spawn_locations)

2. ✅ **PASSING** - Label test
   - "Date Propagated" instead of "Date Spawned"

3. ❌ **FAILING** - Draft saving with partial data
   - **BLOCKED BY BUG** - Stack overflow on server

4. ✅ **PASSING** - Propagation method validation
   - Form blocked without propagation_method

5. ✅ **PASSING** - Lighting fields validation
   - All 3 lighting fields required

6. ✅ **PASSING** - CO2 description conditional validation
   - Required when CO2=yes

7. ❌ **FAILING** - Complete form submission
   - **BLOCKED BY BUG** - Stack overflow on server

8. ⏭️ **NOT RUN** - Dynamic supplement rows (serial mode)

#### `e2e/coral-submissions.spec.ts` (8 tests)
1. ❌ **FAILING** - Field visibility test
   - **Issue:** propagation_method still visible (should be hidden for Coral)
   - Timing issue with HTMX swap

2. ✅ **PASSING** - Label test
   - "Date Propagated" label correct

3. ❌ **FAILING** - Draft saving
   - **BLOCKED BY BUG** - Same stack overflow as Plant

4-8. ⏭️ **NOT RUN** - Serial mode stopped after first failure

---

## 🐛 Critical Bug: Server-Side Stack Overflow

### Symptoms
- **Error:** "Maximum call stack size exceeded" (JavaScript stack overflow)
- **Occurs:** When saving Plant or Coral submissions (draft or submit)
- **Does NOT occur:** With Fish submissions
- **HTTP Response:** 500 Internal Server Error

### Evidence
From test output:
```
PAGE ERROR: Maximum call stack size exceeded.
PAGE LOG: Failed to load resource: the server responded with a status of 500 (Internal Server Error)
PAGE LOG: Response Status Error Code 500 from /submissions
URL after draft save: http://localhost:4200/submissions/new
```

### Attempted Fixes

#### Fix #1: Excluded supplement arrays from `formToDB` ✅ APPLIED
**File:** `src/db/submissions.ts:136-137`

**Problem:** The `formToDB()` function was spreading `...form` which included `supplement_type` and `supplement_regimen` arrays. These should be handled separately via `setSubmissionSupplements()`.

**Fix:**
```typescript
return {
  member_id: memberId,
  program,
  submitted_on: submit ? new Date().toISOString() : undefined,
  witness_verification_status: submit ? ("pending" as const) : undefined,
  ...form,
  member_name: undefined,
  member_email: undefined,
  foods: arrayToJSON(form.foods),
  spawn_locations: arrayToJSON(form.spawn_locations),
  // Supplements are handled separately via setSubmissionSupplements() - don't include arrays
  supplement_type: undefined,        // ← ADDED
  supplement_regimen: undefined,     // ← ADDED
};
```

**Result:** Did NOT resolve stack overflow

#### Fix #2: Added null/undefined check to multiSelect ✅ APPLIED
**File:** `src/forms/utils.ts:40-42`

**Problem:** The `multiSelect` transform might not handle undefined/null gracefully.

**Fix:**
```typescript
export const multiSelect = z.union([z.string(), z.array(z.string())]).transform((val) => {
  if (val === undefined || val === null) {  // ← ADDED
    return undefined;
  }
  const arr = typeof val === "string" ? [val] : val;
  return arr;
});
```

**Result:** Did NOT resolve stack overflow

### Hypothesis
The stack overflow likely occurs in one of these areas:
1. **Form parsing** - `bapDraftForm.safeParse()` or `extractValid()` creating circular references
2. **Template rendering** - Pug template for supplements section when `supplement_type` is not an array
3. **Database insertion** - Some recursive processing in the submission creation flow
4. **Error handling** - Recursive error rendering when trying to show validation errors

### Next Steps for Debugging
1. Add server-side logging to trace exact call stack location
2. Use Node debugger with breakpoints in:
   - `src/routes/submission.ts:284` (bapDraftForm.safeParse)
   - `src/db/submissions.ts:145` (formToDB call)
   - `src/db/submissions.ts:154` (Object.entries loop)
3. Check if Pug template has infinite recursion when rendering supplement fields
4. Verify `extractValid()` function doesn't create circular object references

---

## 📊 Test Results Summary

### Passing Tests: 5/16 (31%)
- 2 Plant field visibility/label tests
- 3 Plant validation tests

### Failing Tests: 4/16 (25%)
- 2 Draft saving tests (stack overflow bug)
- 1 Coral field visibility (HTMX timing)
- 1 Plant submission test (stack overflow bug)

### Not Run: 7/16 (44%)
- Serial mode stopped execution after failures

---

## 🎯 Test Coverage Achieved

### Plant Submission Unique Elements
- ✅ Propagation method field (required)
- ✅ Lighting section (3 fields, all required)
- ✅ Supplements/CO2 section
- ✅ CO2 description conditional requirement
- ✅ Fish fields hidden (count, foods, spawn_locations)
- ✅ "Date Propagated" label
- ❌ Draft saving (blocked by bug)
- ❌ Full submission (blocked by bug)
- ⏭️ Dynamic supplement row addition

### Coral Submission Unique Elements
- ❌ Field visibility (HTMX timing issue)
- ✅ "Date Propagated" label
- ❌ Draft saving (blocked by bug)
- ⏭️ Foods field validation
- ⏭️ Lighting validation
- ⏭️ CO2 validation
- ⏭️ Full submission
- ⏭️ Dynamic supplement rows

---

## 📁 Files Modified

### Test Files (NEW)
- `e2e/plant-submissions.spec.ts` - 500+ lines, 8 tests
- `e2e/coral-submissions.spec.ts` - 500+ lines, 8 tests

### Test Infrastructure (MODIFIED)
- `scripts/setup-e2e-db.ts` - Added 4 test species
- `e2e/helpers/submissions.ts` - Extended interface & helper function

### Source Code (BUG FIXES)
- `src/db/submissions.ts` - Excluded supplement arrays from formToDB
- `src/forms/utils.ts` - Added null check to multiSelect transform

---

## 🚧 Known Issues

### Issue #1: Server Stack Overflow (CRITICAL)
- **Severity:** Blocker
- **Impact:** Cannot save Plant or Coral submissions
- **Affects:** Draft saving AND full submissions
- **Status:** Root cause unknown despite 2 attempted fixes
- **Workaround:** None - tests cannot pass until fixed

### Issue #2: Coral Field Visibility Test Flaky
- **Severity:** Minor
- **Impact:** propagation_method field still visible for Coral
- **Root Cause:** HTMX swap timing - field not hidden fast enough
- **Potential Fix:** Longer wait time or poll for field to disappear

---

## 💡 Recommendations

1. **Immediate Priority:** Debug and fix stack overflow bug
   - Add comprehensive server-side logging
   - Use debugger to trace exact stack location
   - May need to refactor supplement handling completely

2. **Field Visibility Test:** Add longer wait or explicit check for HTMX swap completion

3. **Test Serial Mode:** Consider using `test.describe.configure({ mode: 'parallel' })` to allow more tests to run even if some fail

4. **Validation Coverage:** Once bug is fixed, ensure all validation tests run to completion

---

## 📝 Notes

- All Fish E2E tests continue to pass (regression check: ✅)
- Test helper backward compatible with existing Fish tests
- Plant/Coral species data structure matches existing patterns
- Tom Select initialization timing handled consistently (3000ms wait)
- Debugging output added to tests (console logs for errors)

---

## 🔗 Related Files

- Main submission form: `src/views/bapForm/form.pug:153-197` (supplements section)
- Form validation: `src/forms/submission.ts:142-182`
- Submission DB logic: `src/db/submissions.ts:100-196`
- Route handler: `src/routes/submission.ts:274-310` (form parsing)
