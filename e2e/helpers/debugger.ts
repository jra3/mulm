import type { Page, Request, Response } from "@playwright/test";

/**
 * Network request logger that captures all HTTP traffic during tests
 */
export interface NetworkLog {
  method: string;
  url: string;
  status: number | null;
  statusText: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  timing: {
    startTime: number;
    endTime: number | null;
    duration: number | null;
  };
  error?: string;
}

/**
 * Console message logger that captures all browser console output
 */
export interface ConsoleLog {
  type: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  location?: string;
  args: string[];
  timestamp: number;
}

export class TestDebugger {
  private networkLogs: NetworkLog[] = [];
  private consoleLogs: ConsoleLog[] = [];
  private page: Page;
  private enabled: boolean;

  constructor(page: Page, options: { enabled?: boolean } = {}) {
    this.page = page;
    this.enabled = options.enabled ?? true;

    if (this.enabled) {
      this.setupNetworkLogging();
      this.setupConsoleLogging();
      this.setupPageErrorLogging();
    }
  }

  /**
   * Set up network request/response logging
   */
  private setupNetworkLogging() {
    this.page.on("request", (request: Request) => {
      const log: NetworkLog = {
        method: request.method(),
        url: request.url(),
        status: null,
        statusText: "",
        requestHeaders: request.headers(),
        responseHeaders: {},
        requestBody: this.getRequestBody(request),
        responseBody: null,
        timing: {
          startTime: Date.now(),
          endTime: null,
          duration: null,
        },
      };

      // Store with request as key so we can update on response
      this.networkLogs.push(log);
    });

    this.page.on("response", async (response: Response) => {
      const request = response.request();
      const log = this.networkLogs.find(
        (l) => l.url === request.url() && l.method === request.method() && !l.endTime
      );

      if (log) {
        log.status = response.status();
        log.statusText = response.statusText();
        log.responseHeaders = response.headers();
        log.responseBody = await this.getResponseBody(response);
        log.timing.endTime = Date.now();
        log.timing.duration = log.timing.endTime - log.timing.startTime;

        // Log failed requests immediately
        if (response.status() >= 400) {
          console.error(
            `❌ HTTP ${response.status()} ${request.method()} ${request.url()}`
          );
          if (log.responseBody) {
            console.error(`Response: ${log.responseBody.substring(0, 500)}`);
          }
        }
      }
    });

    this.page.on("requestfailed", (request: Request) => {
      const log = this.networkLogs.find(
        (l) => l.url === request.url() && l.method === request.method() && !l.endTime
      );

      if (log) {
        log.error = request.failure()?.errorText || "Request failed";
        log.timing.endTime = Date.now();
        log.timing.duration = log.timing.endTime - log.timing.startTime;

        console.error(`❌ Request failed: ${request.method()} ${request.url()}`);
        console.error(`Error: ${log.error}`);
      }
    });
  }

  /**
   * Set up browser console logging
   */
  private setupConsoleLogging() {
    this.page.on("console", (msg) => {
      const log: ConsoleLog = {
        type: msg.type() as ConsoleLog["type"],
        text: msg.text(),
        location: msg.location()
          ? `${msg.location().url}:${msg.location().lineNumber}`
          : undefined,
        args: msg.args().map((arg) => String(arg)),
        timestamp: Date.now(),
      };

      this.consoleLogs.push(log);

      // Echo to test console with appropriate formatting
      const prefix = this.getConsolePrefix(log.type);
      console.log(`${prefix} ${log.text}`);
      if (log.location) {
        console.log(`  at ${log.location}`);
      }
    });
  }

  /**
   * Set up page error logging (uncaught exceptions, etc.)
   */
  private setupPageErrorLogging() {
    this.page.on("pageerror", (error) => {
      console.error("❌ Page Error:", error.message);
      console.error(error.stack);
    });
  }

  /**
   * Get request body (if available)
   */
  private getRequestBody(request: Request): string | null {
    try {
      const postData = request.postData();
      if (!postData) return null;

      // Truncate large bodies
      return postData.length > 10000
        ? postData.substring(0, 10000) + "... (truncated)"
        : postData;
    } catch {
      return null;
    }
  }

  /**
   * Get response body (if available and not too large)
   */
  private async getResponseBody(response: Response): Promise<string | null> {
    try {
      const contentType = response.headers()["content-type"] || "";

      // Only capture text-based responses
      if (
        !contentType.includes("json") &&
        !contentType.includes("html") &&
        !contentType.includes("text") &&
        !contentType.includes("javascript")
      ) {
        return `<binary: ${contentType}>`;
      }

      const body = await response.text();

      // Truncate large responses
      return body.length > 50000
        ? body.substring(0, 50000) + "... (truncated)"
        : body;
    } catch {
      return null;
    }
  }

  /**
   * Get console prefix based on type
   */
  private getConsolePrefix(type: ConsoleLog["type"]): string {
    switch (type) {
      case "error":
        return "🔴";
      case "warn":
        return "🟡";
      case "info":
        return "ℹ️";
      case "debug":
        return "🔍";
      default:
        return "📝";
    }
  }

  /**
   * Get all network logs
   */
  getNetworkLogs(): NetworkLog[] {
    return this.networkLogs;
  }

  /**
   * Get all console logs
   */
  getConsoleLogs(): ConsoleLog[] {
    return this.consoleLogs;
  }

  /**
   * Get only failed network requests
   */
  getFailedRequests(): NetworkLog[] {
    return this.networkLogs.filter((log) => log.status && log.status >= 400);
  }

  /**
   * Get only console errors
   */
  getConsoleErrors(): ConsoleLog[] {
    return this.consoleLogs.filter((log) => log.type === "error");
  }

  /**
   * Print summary of captured logs
   */
  printSummary() {
    console.log("\n=== Test Debug Summary ===");
    console.log(`Network requests: ${this.networkLogs.length}`);
    console.log(`Failed requests: ${this.getFailedRequests().length}`);
    console.log(`Console messages: ${this.consoleLogs.length}`);
    console.log(`Console errors: ${this.getConsoleErrors().length}`);

    const failedRequests = this.getFailedRequests();
    if (failedRequests.length > 0) {
      console.log("\n❌ Failed Requests:");
      failedRequests.forEach((req) => {
        console.log(`  ${req.method} ${req.url} - ${req.status} ${req.statusText}`);
        if (req.error) {
          console.log(`    Error: ${req.error}`);
        }
      });
    }

    const consoleErrors = this.getConsoleErrors();
    if (consoleErrors.length > 0) {
      console.log("\n🔴 Console Errors:");
      consoleErrors.forEach((log) => {
        console.log(`  ${log.text}`);
        if (log.location) {
          console.log(`    at ${log.location}`);
        }
      });
    }
  }

  /**
   * Filter network logs by URL pattern
   */
  filterRequestsByUrl(pattern: string | RegExp): NetworkLog[] {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    return this.networkLogs.filter((log) => regex.test(log.url));
  }

  /**
   * Find a specific request by URL and method
   */
  findRequest(url: string | RegExp, method?: string): NetworkLog | undefined {
    const regex = typeof url === "string" ? new RegExp(url) : url;
    return this.networkLogs.find(
      (log) => regex.test(log.url) && (!method || log.method === method)
    );
  }

  /**
   * Save network activity to a JSON file for later analysis
   */
  async saveToFile(filename: string) {
    const fs = await import("fs/promises");
    const data = {
      networkLogs: this.networkLogs,
      consoleLogs: this.consoleLogs,
      summary: {
        totalRequests: this.networkLogs.length,
        failedRequests: this.getFailedRequests().length,
        totalConsoleMessages: this.consoleLogs.length,
        consoleErrors: this.getConsoleErrors().length,
      },
    };

    await fs.writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`Debug logs saved to ${filename}`);
  }
}

/**
 * Helper to create and attach debugger to a page
 */
export function attachDebugger(page: Page, options?: { enabled?: boolean }) {
  return new TestDebugger(page, options);
}
