# E2E Test Debugging Guide

This guide explains how to debug E2E test failures with comprehensive network and console logging.

## Quick Start: Using the Test Debugger

```typescript
import { test, expect } from "@playwright/test";
import { attachDebugger } from "./helpers/debugger";

test("my test", async ({ page }) => {
  // Attach debugger at the start of your test
  const debug = attachDebugger(page);

  await page.goto("/submissions/new");
  await page.fill('input[name="temperature"]', "75");
  await page.click('button[name="draft"]');

  // Print summary at the end (or on failure)
  debug.printSummary();

  // Optional: Check for specific issues
  const failedRequests = debug.getFailedRequests();
  if (failedRequests.length > 0) {
    console.log("Failed requests:", failedRequests);
  }

  // Optional: Save detailed logs to file
  await debug.saveToFile('test-results/debug.json');
});
```

## Features

### 1. Automatic Network Logging

The debugger captures all HTTP requests and responses:

- **Request details**: method, URL, headers, body
- **Response details**: status, headers, body
- **Timing**: duration of each request
- **Failed requests**: automatically highlighted with ❌

**Example output:**
```
❌ HTTP 500 POST /submissions
Response: {"error":"table submissions has no column named images"}
```

### 2. Browser Console Logging

All browser console messages are captured and echoed to the test console:

- 📝 Regular logs
- ℹ️ Info messages
- 🟡 Warnings
- 🔴 Errors
- 🔍 Debug messages

**Example output:**
```
🔴 TypeError: Cannot read property 'value' of null
  at https://johns-mac.corgi-hammerhead.ts.net/public/form.js:42
```

### 3. Query and Filter Logs

```typescript
// Find specific requests
const submissionPost = debug.findRequest('/submissions', 'POST');
console.log('Submission response:', submissionPost?.responseBody);

// Filter by URL pattern
const apiCalls = debug.filterRequestsByUrl(/^\/api\//);
console.log(`Made ${apiCalls.length} API calls`);

// Get only errors
const errors = debug.getConsoleErrors();
const failedRequests = debug.getFailedRequests();
```

### 4. Save Logs for Later Analysis

```typescript
// Save comprehensive debug info to JSON file
await debug.saveToFile('test-results/my-test-debug.json');
```

The JSON file includes:
- All network requests/responses with timing
- All console messages with timestamps
- Summary statistics

## Advanced Debugging Techniques

### 1. HAR Recording (Full Network Capture) - **Enabled by Default Locally!**

HAR (HTTP Archive) recording is **automatically enabled** when running tests locally (disabled in CI).

After running tests locally, you'll find:
- `test-results/network-latest.har` - Full network activity from your last test run

**View HAR files:**
- Chrome DevTools: Open DevTools → Network tab → Right-click → "Import HAR file"
- Online: [HAR Viewer](http://www.softwareishard.com/har/viewer/)
- VS Code: Install "HAR Viewer" extension

This gives you the full Chrome DevTools Network experience for any test run!

### 2. Use Playwright Traces

Traces are automatically captured on first retry. View them with:

```bash
npx playwright show-trace test-results/.../trace.zip
```

Traces include:
- Network activity
- DOM snapshots
- Screenshots
- Console logs
- Timeline of all actions

### 3. Run Tests in Headed Mode

See the browser while testing:

```bash
npm run test:e2e:headed
```

### 4. Debug Mode (Step Through)

```bash
npx playwright test --debug
```

Opens Playwright Inspector where you can:
- Step through each action
- Inspect the page at any point
- View network activity live
- Modify selectors interactively

### 5. Pause at Specific Points

```typescript
test("debug at specific point", async ({ page }) => {
  await page.goto("/submissions/new");

  // Pause here - opens inspector
  await page.pause();

  await page.click('button[name="draft"]');
});
```

### 6. Check Server Logs

The test server logs are visible in the test output. Look for errors like:

```
[0] [ERROR] Failed to add submission [Error: SQLITE_ERROR: table submissions has no column named images]
```

## Common Debugging Patterns

### Pattern 1: Form Submission Failures

```typescript
test("debug form submission", async ({ page }) => {
  const debug = attachDebugger(page);

  await page.goto("/submissions/new");
  // ... fill form ...
  await page.click('button[name="draft"]');

  // Check what request was made
  const submission = debug.findRequest('/submissions', 'POST');
  console.log('Request body:', submission?.requestBody);
  console.log('Response:', submission?.responseBody);
  console.log('Status:', submission?.status);

  // Check for console errors
  const errors = debug.getConsoleErrors();
  if (errors.length > 0) {
    console.log('Browser errors:', errors);
  }
});
```

### Pattern 2: HTMX Swap Issues

```typescript
test("debug HTMX swap", async ({ page }) => {
  const debug = attachDebugger(page);

  await page.selectOption('select[name="species_type"]', "Fish");

  // Wait for HTMX request
  await page.waitForLoadState("networkidle");

  // Check what was swapped
  const htmxRequest = debug.filterRequestsByUrl('/submissions/new')[0];
  console.log('HTMX response:', htmxRequest?.responseBody);

  // Check if swap completed
  const isVisible = await page.isVisible('select[name="species_class"]');
  console.log('Species class visible:', isVisible);
});
```

### Pattern 3: Timing Issues

```typescript
test("debug timing", async ({ page }) => {
  const debug = attachDebugger(page);

  await page.click('button[name="submit"]');

  // Check request timing
  const requests = debug.getNetworkLogs();
  requests.forEach(req => {
    if (req.timing.duration && req.timing.duration > 1000) {
      console.log(`Slow request: ${req.url} took ${req.timing.duration}ms`);
    }
  });
});
```

## Debugging Workflow

1. **Run test and collect logs**
   ```bash
   npm run test:e2e -- my-test.spec.ts
   ```

2. **Check the output for**:
   - ❌ Failed HTTP requests
   - 🔴 Console errors
   - Debug summary at the end

3. **If test fails**:
   - Check screenshot: `test-results/.../*.png`
   - Check video: `test-results/.../*.webm`
   - Check trace: `test-results/.../trace.zip`
   - Check debug JSON if you saved it

4. **Reproduce locally**:
   ```bash
   npm run dev  # Start server
   # Open browser to same URL from test
   # Check Network tab and Console in DevTools
   ```

5. **Re-run with debug mode** if needed:
   ```bash
   npx playwright test --debug my-test.spec.ts
   ```

## Tips for Working with Claude

When asking Claude to fix E2E tests:

1. **Include the debug summary** in your prompt:
   ```
   The test failed with these errors:
   - ❌ HTTP 500 POST /submissions
   - Response: {"error":"table submissions has no column named images"}
   ```

2. **Share specific request/response data**:
   ```
   Request body: member_id=9&images=[]&draft=true
   Response: Error: SQLITE_ERROR: table submissions has no column named images
   ```

3. **Include console errors** if any:
   ```
   🔴 TypeError: Cannot read property 'value' of null
   ```

4. **Mention if it's timing or real bug**:
   - "The form submits but returns 500" = real bug
   - "The element isn't found but might appear later" = timing issue

This helps Claude distinguish between:
- **Timing issues**: Need better waits (`waitForSelector`, `waitForLoadState`)
- **Real bugs**: Need code fixes (like missing column handling)

## Environment Variables

```bash
# Enable debug mode for all tests
DEBUG=pw:api npm run test:e2e

# Run specific test with verbose logging
npm run test:e2e -- my-test.spec.ts --reporter=line --headed
```

## Checklist: Before Assuming It's a Timing Issue

- [ ] Does the HTTP request succeed? (200/201 status)
- [ ] Are there any 4xx/5xx errors?
- [ ] Are there browser console errors?
- [ ] Does the server log show errors?
- [ ] Can you reproduce it manually in the browser?

If any of these show actual errors, it's likely a real bug, not timing!
