# Problem Analysis: Tom Select Flaky E2E Tests (Issue #180)

**Date**: 2025-10-24
**Issue**: https://github.com/jra3/mulm/issues/180
**Status**: Unresolved - All attempted fixes pass locally but fail in CI

---

## Problem Statement

E2E tests intermittently fail in CI with timeout/incorrect value errors when interacting with Tom Select dropdown fields. The failures occur in ~10-30% of CI runs and are **not correlated with code changes** - they happen even when the PR doesn't touch form-related code.

### Affected Tests

1. `e2e/form-field-linking.spec.ts:64` - "should auto-populate common name when scientific name is selected"
2. `e2e/form-field-linking.spec.ts:321` - "should handle species with multiple common names"
3. `e2e/submission-lifecycle.spec.ts:29` - "happy path: draft → submit → witness → wait → approve"

### Original Error Pattern

```
TimeoutError: page.waitForSelector: Timeout 2000ms exceeded.
Call log:
  - waiting for locator('.ts-dropdown') to be hidden
    9 × locator resolved to visible <div class="ts-dropdown single">…</div>

at helpers/tomSelect.ts:53
```

---

## Critical Observation

**ALL FIXES PASS 100% LOCALLY BUT FAIL IN CI**

This is the most important finding and indicates the problem is **environmental**, not just timing-related.

### Local Test Results
- Original code: Passes consistently
- Timeout increased to 5s: **15/15 tests pass** (3 consecutive runs)
- Added 300ms delay: **15/15 tests pass**
- Added 500ms delay: **15/15 tests pass**
- Specific selector + timeout: **15/15 tests pass**

### CI Test Results
- Original code: **~30% failure rate** (flaky)
- Timeout increased to 5s: **FAILS** (same as original)
- Added 300ms delay: **FAILS** - wrong values selected
- Added 500ms delay: **FAILS** - wrong values selected
- Specific selector + timeout: **FAILS** - wrong values selected

---

## Approaches Attempted

### Attempt 1: Complex Value Checking (Commit 89f8736)
**Approach**: Poll `selectElement.inputValue()` until value is populated

**Code**:
```typescript
const selectElement = page.locator(`select[name="${fieldName}"]`);
let valueSet = false;
const maxWaitTime = 5000;
while (!valueSet && Date.now() - startTime < maxWaitTime) {
  const currentValue = await selectElement.inputValue();
  if (currentValue && currentValue.trim() !== '') {
    valueSet = true;
    break;
  }
  await page.waitForTimeout(100);
}
```

**Result**:
- ✅ Local: 15/15 pass
- ❌ CI: Failed - `inputValue()` doesn't work correctly for Tom Select fields (returns empty or wrong values)

---

### Attempt 2: Remove Sleep, Use Specific Selector (Commit 1b553ff)
**Approach**: Remove arbitrary sleeps, use specific dropdown selector, rely on `waitFor()` polling

**Code**:
```typescript
const tsWrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
const dropdownSelector = tsWrapper.locator('.ts-dropdown');
await dropdownSelector.waitFor({ state: "hidden", timeout: 5000 });
```

**Result**:
- ✅ Local: 15/15 pass
- ❌ CI: Failed - Gets wrong species selected (Platystomatichthys sturio instead of Poecilia reticulata)

**Why it failed**: Without the sleep after `Enter`, Tom Select's JavaScript doesn't have time to process the keypress and update the value before the dropdown closes.

---

### Attempt 3: Add 300ms Delay (Commit 8d66426)
**Approach**: Add 300ms sleep after Enter, then check dropdown state

**Code**:
```typescript
await input.press('Enter');
await page.waitForTimeout(300);
const tsWrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
await tsWrapper.locator('.ts-dropdown').waitFor({ state: "hidden", timeout: 5000 });
```

**Result**:
- ✅ Local: 15/15 pass
- ❌ CI: Failed - 300ms insufficient; common name field empty or wrong species selected

---

### Attempt 4: Increase to 500ms Delay (Commits 855a693, 89d0373)
**Approach**: Increase delay to 500ms to give more time for Tom Select JavaScript to execute

**Code**:
```typescript
await input.press('Enter');
await page.waitForTimeout(500);
const tsWrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
await tsWrapper.locator('.ts-dropdown').waitFor({ state: "hidden", timeout: 5000 });
```

**Result**:
- ✅ Local: 15/15 pass (37.2s total)
- ❌ CI: Failed - Even 500ms not enough; still getting wrong species

---

### Attempt 5: Minimal Change - Just Timeout (Commit 3a758cd - CURRENT)
**Approach**: Revert all complexity, change ONLY the timeout from 2s to 5s

**Code**:
```typescript
// Original structure preserved, only timeout changed:
await input.press('Enter');
await page.waitForSelector('.ts-dropdown', { state: "hidden", timeout: 5000 });
```

**Result**:
- ✅ Local: 15/15 pass
- ❌ CI: Failed - Same failure pattern as original

---

## Error Patterns in CI

### Pattern 1: Empty Fields
```
Error: expect(received).toBeTruthy()
Received: ""

const commonName = await getTomSelectValue(page, "species_common_name");
expect(commonName).toBeTruthy(); // FAILS
```

The auto-populated field (common name) is empty after selecting scientific name.

### Pattern 2: Wrong Species Selected
```
Error: expect(received).toContain(expected)
Expected substring: "Xiphophorus"
Received string: "Platystomatichthys sturio"
```

A completely different species is selected than what was requested.

---

## Root Cause Hypothesis

The consistent pattern (works locally, fails in CI) points to **environmental differences** that affect Tom Select's behavior:

### Potential Causes

1. **Keyboard Event Timing in CI**
   - GitHub Actions runners may process keyboard events differently
   - The `ArrowDown` + `Enter` sequence may not be properly synchronized
   - Tom Select's JavaScript event handlers may fire in different order

2. **Network Latency**
   - Tom Select hits `/api/species/search` for typeahead
   - CI environment has different network characteristics
   - The 1500ms wait for API results may be insufficient in CI

3. **JavaScript Execution Speed**
   - CI runners may be slower at executing JavaScript
   - Tom Select's internal state updates may not complete in time
   - Race condition between dropdown closing and value setting

4. **Headless Browser Differences**
   - Rendering/animation timing differs in headless mode
   - DOM updates may not be synchronous with visual changes
   - Tom Select animations may complete at different speeds

5. **Multiple Tom Select Instances**
   - Generic `.ts-dropdown` selector matches wrong dropdown
   - Multiple typeahead fields on same page cause interference
   - Events from one field affect another

---

## Current Helper Implementation

**File**: `e2e/helpers/tomSelect.ts:16-54`

```typescript
export async function fillTomSelectTypeahead(
  page: Page,
  fieldName: string,
  searchText: string,
  exactMatch = false
): Promise<void> {
  // Wait for Tom Select to be initialized
  await page.waitForSelector(`select[name="${fieldName}"].tomselected`, { timeout: 10000 });
  await page.waitForSelector(`select[name="${fieldName}"] + .ts-wrapper`, { timeout: 2000 });

  // Find the ts-control and click to open dropdown
  const control = page.locator(`select[name="${fieldName}"] + .ts-wrapper .ts-control`);
  await control.click();

  // Type into the Tom Select input
  const input = control.locator('input');
  await input.fill(searchText);

  // Wait for API results to load (Tom Select hits /api/species/search)
  await page.waitForTimeout(1500); // ⚠️ ARBITRARY WAIT

  // Use keyboard navigation to select the first option
  await input.press('ArrowDown');
  await page.waitForTimeout(200); // ⚠️ ARBITRARY WAIT
  await input.press('Enter');

  // Wait for Tom Select to process the selection and close dropdown
  await page.waitForSelector('.ts-dropdown', { state: "hidden", timeout: 5000 }); // ⚠️ GENERIC SELECTOR
}
```

### Problems with Current Approach

1. **Generic selector** - `.ts-dropdown` matches ANY dropdown on the page
2. **Arbitrary waits** - 1500ms for API, 200ms after ArrowDown
3. **No verification** - Doesn't check if correct option was selected
4. **No HTMX awareness** - Doesn't wait for field linking to complete (the test has its own 500ms wait on line 71)

---

## Test Flow Analysis

### What Actually Happens

1. User types "Poecilia reticulata" in scientific name field
2. Tom Select hits `/api/species/search?q=Poecilia+reticulata`
3. Dropdown shows matching results
4. User presses ArrowDown (highlights first result)
5. User presses Enter (selects highlighted result)
6. Tom Select:
   - Updates underlying `<select>` element value
   - Triggers `change` event
   - Closes dropdown
7. **HTMX field linking** (not Tom Select!):
   - Listens for `change` event
   - Makes request to populate common name
   - Updates common name field

### The Real Issue

The test at `form-field-linking.spec.ts:68-76` is testing **HTMX field linking**, not just Tom Select! The helper only handles Tom Select interaction, but the test expects HTMX to have completed the field linking.

**Current test code**:
```typescript
await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");

// Wait for field linking to complete
await page.waitForTimeout(500); // ⚠️ ANOTHER ARBITRARY WAIT

// Verify common name field was auto-populated
const commonName = await getTomSelectValue(page, "species_common_name");
expect(commonName).toBeTruthy(); // FAILS IN CI
```

The 500ms wait on line 71 is supposed to give HTMX time to update the common name field, but it's clearly not enough in CI.

---

## Research: E2E Testing for Tom Select

### Tom Select Documentation

Tom Select is a lightweight, framework-agnostic replacement for Select2. Key characteristics:

- **Event-driven**: Fires `change`, `item_add`, `dropdown_open`, `dropdown_close` events
- **Async API calls**: Can load options from remote endpoints
- **DOM manipulation**: Creates wrapper elements (`.ts-wrapper`, `.ts-control`, `.ts-dropdown`)
- **Keyboard navigation**: Supports ArrowDown/ArrowUp/Enter for selection

### Recommended Testing Patterns

#### Pattern 1: Wait for Specific Element State (Not Generic Selectors)
```typescript
// ❌ BAD: Generic selector
await page.waitForSelector('.ts-dropdown', { state: "hidden" });

// ✅ GOOD: Specific to this field
const dropdown = page.locator(`[aria-labelledby="${fieldName}-ts-label"]`);
await dropdown.waitFor({ state: "hidden" });
```

#### Pattern 2: Wait for Network Requests (Not Arbitrary Timeouts)
```typescript
// ❌ BAD: Arbitrary wait
await page.waitForTimeout(1500);

// ✅ GOOD: Wait for specific API call
await page.waitForResponse(resp =>
  resp.url().includes('/api/species/search') && resp.status() === 200
);
```

#### Pattern 3: Verify Selection Before Proceeding
```typescript
// ❌ BAD: Hope the right thing was selected
await input.press('Enter');

// ✅ GOOD: Click specific option by text
await page.click(`.ts-dropdown .option:text("${searchText}")`);
```

#### Pattern 4: Use Tom Select API Directly (via evaluate)
```typescript
// Access Tom Select instance directly in browser context
await page.evaluate((fieldName) => {
  const selectEl = document.querySelector(`select[name="${fieldName}"]`);
  const tomselect = selectEl.tomselect; // Tom Select attaches itself here
  return new Promise(resolve => {
    tomselect.on('change', () => resolve());
    tomselect.setValue(value);
  });
}, fieldName);
```

---

## New Investigation Plan

### Phase 1: Understand the Environment Difference

**Goal**: Identify WHY local and CI behave differently

**Tasks**:
1. Add extensive logging to CI runs
   - Log dropdown HTML before/after selection
   - Log all Tom Select field values at each step
   - Log network request timing
   - Log JavaScript errors/warnings

2. Compare Playwright versions
   - Check if local and CI use same Playwright version
   - Check if browser versions differ

3. Test with headed browser in CI
   - Run CI with `headed: true` to see visual behavior
   - Record video of failures

4. Slow down local tests to match CI
   - Use Playwright's `slowMo` option locally
   - Try to reproduce CI failures locally

**Implementation**:
```typescript
// Add debug logging to helper
export async function fillTomSelectTypeahead(page: Page, fieldName: string, searchText: string) {
  console.log(`[TomSelect] Starting interaction with field: ${fieldName}`);
  console.log(`[TomSelect] Search text: ${searchText}`);

  // ... existing code ...

  await input.fill(searchText);
  console.log(`[TomSelect] Filled input, waiting for API response`);

  const responsePromise = page.waitForResponse(
    resp => resp.url().includes('/api/species/search'),
    { timeout: 3000 }
  );
  const response = await responsePromise;
  console.log(`[TomSelect] API responded with status: ${response.status()}`);

  // Log dropdown contents
  const dropdownHTML = await page.locator('.ts-dropdown-content').innerHTML();
  console.log(`[TomSelect] Dropdown HTML:`, dropdownHTML);

  // ... rest of interaction ...

  const finalValue = await page.locator(`select[name="${fieldName}"]`).inputValue();
  console.log(`[TomSelect] Final value set to: ${finalValue}`);
}
```

---

### Phase 2: Fix Network Request Timing

**Goal**: Eliminate arbitrary 1500ms wait for API results

**Current Problem**:
```typescript
await input.fill(searchText);
await page.waitForTimeout(1500); // ⚠️ ARBITRARY
await input.press('ArrowDown');
```

**Proposed Solution**:
```typescript
await input.fill(searchText);

// Wait for the actual API call to complete
await page.waitForResponse(
  resp => resp.url().includes('/api/species/search') && resp.status() === 200,
  { timeout: 5000 }
);

// Wait for dropdown options to be rendered
await page.waitForSelector('.ts-dropdown .option', { state: "visible", timeout: 2000 });

await input.press('ArrowDown');
```

**Benefits**:
- No arbitrary waits
- Tests run as fast as the API responds
- Fails immediately if API call fails
- More reliable in variable network conditions

---

### Phase 3: Fix Selection Logic

**Goal**: Ensure we select the correct option, not just the first one

**Current Problem**:
```typescript
await input.press('ArrowDown'); // Highlights first option
await page.waitForTimeout(200);
await input.press('Enter'); // Selects whatever is highlighted
```

In CI, the "first option" might not be what we expect if:
- Results load in different order
- Dropdown hasn't fully rendered
- Previous selection is still highlighted

**Proposed Solution - Option A: Click Specific Option**:
```typescript
// Instead of keyboard navigation, click the specific option by text
await page.click(`.ts-dropdown .option:has-text("${searchText}")`, { timeout: 3000 });
```

**Proposed Solution - Option B: Verify Highlighted Option**:
```typescript
await input.press('ArrowDown');

// Verify the correct option is highlighted before selecting
const highlightedText = await page.locator('.ts-dropdown .option.active').textContent();
if (!highlightedText?.includes(searchText)) {
  throw new Error(`Wrong option highlighted. Expected "${searchText}", got "${highlightedText}"`);
}

await input.press('Enter');
```

**Proposed Solution - Option C: Use Tom Select API**:
```typescript
// Access Tom Select instance and use its API directly
await page.evaluate(({ fieldName, searchText }) => {
  const selectEl = document.querySelector(`select[name="${fieldName}"]`);
  const ts = selectEl.tomselect;

  // Search and select using Tom Select API
  ts.search(searchText);
  return new Promise((resolve) => {
    // Wait for options to load
    setTimeout(() => {
      const firstOption = ts.options[Object.keys(ts.options)[0]];
      ts.addItem(firstOption.value);
      resolve();
    }, 100);
  });
}, { fieldName, searchText });
```

---

### Phase 4: Fix HTMX Field Linking Awareness

**Goal**: Wait for HTMX field linking to complete, not just Tom Select

**Current Problem**:
The test waits 500ms after `fillTomSelectTypeahead()` returns, hoping HTMX has finished. This is too short in CI.

**Proposed Solution - Wait for HTMX Request**:
```typescript
// In the test itself, wait for the HTMX request to complete
await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");

// Wait for HTMX to fetch and populate the common name field
await page.waitForResponse(
  resp => resp.url().includes('/api/species/') && resp.status() === 200,
  { timeout: 3000 }
);

// Wait for the common name field to be populated
await page.waitForFunction(
  () => document.querySelector('select[name="species_common_name"]')?.value !== '',
  { timeout: 3000 }
);
```

**Proposed Solution - Add to Helper**:
```typescript
export async function fillTomSelectTypeahead(
  page: Page,
  fieldName: string,
  searchText: string,
  waitForLinkedFields = false // New parameter
): Promise<void> {
  // ... existing Tom Select interaction ...

  if (waitForLinkedFields) {
    // Wait for any HTMX requests triggered by the change event
    await page.waitForLoadState('networkidle', { timeout: 3000 });
  }
}
```

---

### Phase 5: Alternative Interaction Method

**Goal**: Try a completely different way to interact with Tom Select

**Option A: Use Playwright's built-in select**:
```typescript
// If Tom Select is just enhancing a regular select, try:
await page.selectOption(`select[name="${fieldName}"]`, { label: searchText });
```

**Option B: Direct DOM manipulation**:
```typescript
await page.evaluate(({ fieldName, value }) => {
  const select = document.querySelector(`select[name="${fieldName}"]`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}, { fieldName, value });
```

**Option C: Use Playwright's auto-waiting with better selectors**:
```typescript
// Let Playwright handle all the waiting
await page.locator(`select[name="${fieldName}"] + .ts-wrapper`).click();
await page.locator('.ts-control input').fill(searchText);
await page.locator(`.ts-dropdown .option >> text="${searchText}"`).click();
```

---

## Recommended Action Plan

### Immediate Next Steps (Priority Order)

1. **Add comprehensive logging** (30 min)
   - Instrument the helper with detailed console.log statements
   - Run in CI to see exact failure point
   - Identify which step is failing

2. **Replace arbitrary waits with network waits** (1 hour)
   - Use `page.waitForResponse()` for API calls
   - Use `page.waitForSelector()` for DOM elements
   - Remove all `waitForTimeout()` except where absolutely necessary

3. **Fix selection logic** (1 hour)
   - Change from keyboard navigation to clicking specific option by text
   - Add verification that correct option is selected
   - Log selected value before helper returns

4. **Add HTMX awareness** (30 min)
   - Wait for `networkidle` or specific HTMX requests
   - Verify linked fields are populated before proceeding
   - Consider adding helper parameter for HTMX-aware waiting

5. **Test in CI-like environment locally** (30 min)
   - Use `slowMo` option to slow down tests
   - Run tests in Docker container matching CI environment
   - Try to reproduce CI failures locally

---

## Alternative Strategies

### Strategy A: Increase Playwright Retries
Instead of fixing the flakiness, make tests retry more aggressively:

```typescript
// In playwright.config.ts
export default defineConfig({
  retries: process.env.CI ? 3 : 0, // Retry up to 3 times in CI
});
```

**Pros**: Quick fix, might be acceptable if failure rate is low
**Cons**: Doesn't solve root cause, makes CI slower

---

### Strategy B: Skip Tom Select in Tests
Use a simpler interaction method that bypasses Tom Select's complexity:

```typescript
// Set value directly via DOM manipulation
await page.evaluate(({ fieldName, value, label }) => {
  const select = document.querySelector(`select[name="${fieldName}"]`);

  // Add option if it doesn't exist
  if (!Array.from(select.options).some(opt => opt.value === value)) {
    const option = new Option(label, value, false, true);
    select.add(option);
  }

  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}, { fieldName, value, label });
```

**Pros**: Completely reliable, no timing issues
**Cons**: Doesn't test actual user interaction flow

---

### Strategy C: Use Different Testing Library
Consider using Testing Library patterns with Playwright:

```typescript
import { waitFor } from '@testing-library/dom';

await page.evaluate(async (searchText) => {
  const { waitFor } = await import('@testing-library/dom');

  // Use Testing Library's smart waiting
  await waitFor(() => {
    const option = document.querySelector(`.ts-dropdown .option:contains("${searchText}")`);
    if (!option) throw new Error('Option not found');
    return option;
  });
}, searchText);
```

---

## Success Criteria

- [ ] E2E tests pass **100% of the time** in CI (not 90% or 95%)
- [ ] No arbitrary `waitForTimeout()` calls (use event/network/DOM waits)
- [ ] Tests complete in reasonable time (<3min for full E2E suite)
- [ ] Test code is maintainable and self-documenting
- [ ] 10 consecutive CI runs pass without failure

---

## Resources

- **Tom Select Docs**: https://tom-select.js.org/
- **Playwright Best Practices**: https://playwright.dev/docs/best-practices
- **Playwright Auto-waiting**: https://playwright.dev/docs/actionability
- **Issue #180**: https://github.com/jra3/mulm/issues/180
- **Failed CI Runs**:
  - https://github.com/jra3/mulm/actions/runs/18794087341 (first attempt)
  - https://github.com/jra3/mulm/actions/runs/18794175406 (timeout increase)
  - https://github.com/jra3/mulm/actions/runs/18794243920 (300ms delay)
  - https://github.com/jra3/mulm/actions/runs/18794360536 (500ms delay removed)
  - https://github.com/jra3/mulm/actions/runs/18794491253 (500ms delay restored)
  - https://github.com/jra3/mulm/actions/runs/18794858663 (minimal change)

---

## Notes

- All local testing was done on macOS (Darwin 24.5.0)
- CI runs on Ubuntu (GitHub Actions)
- Playwright version: (check package.json)
- Tom Select version: (check package.json)
- The flakiness existed BEFORE any fix attempts
- The issue explicitly notes this is "not related to code changes"
