import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";
import { attachDebugger } from "./helpers/debugger";

/**
 * Example test demonstrating the debug helper
 *
 * Run with: npm run test:e2e -- debug-example.spec.ts
 */

test.describe("Debugging Example", () => {
  test("shows network and console logging", async ({ page }) => {
    // Attach debugger to capture all network and console activity
    const debug = attachDebugger(page);

    // Login
    await login(page);

    // Navigate to a page
    await page.goto("/submissions/new");

    // Interact with the page
    await page.selectOption('select[name="water_type"]', "Fresh");

    // Check for specific requests
    const newSubmissionPage = debug.findRequest("/submissions/new");
    console.log("Page load status:", newSubmissionPage?.status);

    // Check for any failed requests
    const failedRequests = debug.getFailedRequests();
    if (failedRequests.length > 0) {
      console.error("⚠️ Found failed requests:");
      failedRequests.forEach((req) => {
        console.error(`  ${req.method} ${req.url} - ${req.status}`);
      });
    }

    // Check for console errors
    const consoleErrors = debug.getConsoleErrors();
    if (consoleErrors.length > 0) {
      console.error("⚠️ Found console errors:");
      consoleErrors.forEach((err) => {
        console.error(`  ${err.text}`);
      });
    }

    // Print comprehensive summary
    debug.printSummary();

    // Optional: Save detailed logs to file for later analysis
    // await debug.saveToFile('test-results/debug-example.json');

    // Assertions
    expect(failedRequests.length).toBe(0);
    expect(consoleErrors.length).toBe(0);
  });

  test("demonstrates query capabilities", async ({ page }) => {
    const debug = attachDebugger(page);

    await login(page);
    await page.goto("/");

    // Wait for page to fully load
    await page.waitForLoadState("networkidle");

    // Get all API calls
    const apiCalls = debug.filterRequestsByUrl(/^.*\/api\//);
    console.log(`Made ${apiCalls.length} API calls`);

    // Get all requests to a specific endpoint
    const submissionRequests = debug.filterRequestsByUrl(/\/submissions/);
    console.log(`Made ${submissionRequests.length} requests to /submissions`);

    // Check timing of requests
    const slowRequests = debug.getNetworkLogs().filter(
      (req) => req.timing.duration && req.timing.duration > 1000
    );
    if (slowRequests.length > 0) {
      console.warn(`⚠️ Found ${slowRequests.length} slow requests (>1s):`);
      slowRequests.forEach((req) => {
        console.warn(`  ${req.url} took ${req.timing.duration}ms`);
      });
    }

    debug.printSummary();
  });

  test.skip("example: debugging a form submission issue", async ({ page }) => {
    const debug = attachDebugger(page);

    await login(page);
    await page.goto("/submissions/new");

    // Fill out form
    await page.selectOption('select[name="water_type"]', "Fresh");
    await page.selectOption('select[name="species_type"]', "Fish");
    await page.waitForLoadState("networkidle");

    // Try to submit
    await page.click('button[name="draft"]');
    await page.waitForLoadState("networkidle");

    // Check what happened
    const submissionRequest = debug.findRequest("/submissions", "POST");

    if (submissionRequest) {
      console.log("=== Submission Request ===");
      console.log("Status:", submissionRequest.status);
      console.log("Request body:", submissionRequest.requestBody);
      console.log("Response body:", submissionRequest.responseBody);

      if (submissionRequest.status && submissionRequest.status >= 400) {
        console.error("❌ Submission failed!");
        console.error("Error response:", submissionRequest.responseBody);
      }
    } else {
      console.error("❌ No submission request found!");
    }

    // Save detailed logs
    await debug.saveToFile("test-results/form-submission-debug.json");

    debug.printSummary();
  });
});
