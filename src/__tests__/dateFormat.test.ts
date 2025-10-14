import { describe, test } from "node:test";
import assert from "node:assert";
import {
  isValidDate,
  formatShortDate,
  formatLongDate,
  formatRelativeDate,
  formatISODate,
} from "../utils/dateFormat";

describe("Date Format Utilities", () => {
  describe("isValidDate", () => {
    test("should return true for valid date strings", () => {
      assert.strictEqual(isValidDate("2025-01-15"), true);
      assert.strictEqual(isValidDate("2025-10-07T14:30:00Z"), true);
      assert.strictEqual(isValidDate("01/15/2025"), true);
    });

    test("should return true for valid Date objects", () => {
      assert.strictEqual(isValidDate(new Date()), true);
      assert.strictEqual(isValidDate(new Date("2025-01-15")), true);
    });

    test("should return false for invalid dates", () => {
      assert.strictEqual(isValidDate("invalid"), false);
      assert.strictEqual(isValidDate("not-a-date"), false);
      assert.strictEqual(isValidDate(""), false);
    });

    test("should return false for null and undefined", () => {
      assert.strictEqual(isValidDate(null), false);
      assert.strictEqual(isValidDate(undefined), false);
    });
  });

  describe("formatShortDate", () => {
    test("should format dates as MM/DD/YYYY", () => {
      assert.strictEqual(formatShortDate("2025-01-15"), "01/15/2025");
      assert.strictEqual(formatShortDate("2025-12-31"), "12/31/2025");
      assert.strictEqual(formatShortDate("2025-07-04"), "07/04/2025");
    });

    test("should handle Date objects", () => {
      const date = new Date("2025-01-15T10:30:00Z");
      const formatted = formatShortDate(date);
      assert.match(formatted, /01\/15\/2025/);
    });

    test("should pad single digit months and days", () => {
      assert.strictEqual(formatShortDate("2025-01-01"), "01/01/2025");
      assert.strictEqual(formatShortDate("2025-09-09"), "09/09/2025");
    });

    test("should return empty string for invalid dates", () => {
      assert.strictEqual(formatShortDate("invalid"), "");
      assert.strictEqual(formatShortDate(null), "");
      assert.strictEqual(formatShortDate(undefined), "");
    });
  });

  describe("formatLongDate", () => {
    test('should format dates as "Month DD, YYYY"', () => {
      assert.strictEqual(formatLongDate("2025-01-15"), "January 15, 2025");
      assert.strictEqual(formatLongDate("2025-12-31"), "December 31, 2025");
      assert.strictEqual(formatLongDate("2025-07-04"), "July 4, 2025");
    });

    test("should handle all months correctly", () => {
      assert.strictEqual(formatLongDate("2025-02-01"), "February 1, 2025");
      assert.strictEqual(formatLongDate("2025-03-01"), "March 1, 2025");
      assert.strictEqual(formatLongDate("2025-04-01"), "April 1, 2025");
      assert.strictEqual(formatLongDate("2025-05-01"), "May 1, 2025");
      assert.strictEqual(formatLongDate("2025-06-01"), "June 1, 2025");
      assert.strictEqual(formatLongDate("2025-08-01"), "August 1, 2025");
      assert.strictEqual(formatLongDate("2025-09-01"), "September 1, 2025");
      assert.strictEqual(formatLongDate("2025-10-01"), "October 1, 2025");
      assert.strictEqual(formatLongDate("2025-11-01"), "November 1, 2025");
    });

    test("should return empty string for invalid dates", () => {
      assert.strictEqual(formatLongDate("invalid"), "");
      assert.strictEqual(formatLongDate(null), "");
      assert.strictEqual(formatLongDate(undefined), "");
    });
  });

  describe("formatRelativeDate", () => {
    test('should return "just now" for very recent dates', () => {
      const now = new Date();
      const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
      const result = formatRelativeDate(thirtySecondsAgo);
      assert.strictEqual(result, "just now");
    });

    test("should format minutes ago", () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const oneMinuteAgo = new Date(now.getTime() - 61 * 1000); // 61 seconds

      assert.match(formatRelativeDate(fiveMinutesAgo), /\d+ minutes ago/);
      assert.match(formatRelativeDate(oneMinuteAgo), /1 minute ago/);
    });

    test("should format hours ago", () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      assert.match(formatRelativeDate(twoHoursAgo), /\d+ hours? ago/);
    });

    test("should format days ago", () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      assert.match(formatRelativeDate(threeDaysAgo), /\d+ days? ago/);
    });

    test("should format weeks ago", () => {
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      assert.match(formatRelativeDate(twoWeeksAgo), /\d+ weeks? ago/);
    });

    test("should format months ago", () => {
      const now = new Date();
      const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      assert.match(formatRelativeDate(twoMonthsAgo), /\d+ months? ago/);
    });

    test("should format years ago", () => {
      const now = new Date();
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      assert.match(formatRelativeDate(oneYearAgo), /\d+ years? ago/);
    });

    test("should handle future dates", () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      assert.strictEqual(formatRelativeDate(futureDate), "in the future");
    });

    test("should return empty string for invalid dates", () => {
      assert.strictEqual(formatRelativeDate("invalid"), "");
      assert.strictEqual(formatRelativeDate(null), "");
      assert.strictEqual(formatRelativeDate(undefined), "");
    });
  });

  describe("formatISODate", () => {
    test("should format dates as ISO 8601 strings", () => {
      const result = formatISODate("2025-01-15");
      assert.match(result, /2025-01-15T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    test("should handle Date objects", () => {
      const date = new Date("2025-01-15T10:30:00Z");
      const result = formatISODate(date);
      assert.strictEqual(result, "2025-01-15T10:30:00.000Z");
    });

    test("should return empty string for invalid dates", () => {
      assert.strictEqual(formatISODate("invalid"), "");
      assert.strictEqual(formatISODate(null), "");
      assert.strictEqual(formatISODate(undefined), "");
    });
  });

  describe("Edge Cases", () => {
    test("should handle leap years correctly", () => {
      assert.strictEqual(formatShortDate("2024-02-29"), "02/29/2024");
      assert.strictEqual(formatLongDate("2024-02-29"), "February 29, 2024");
    });

    test("should handle year boundaries", () => {
      assert.strictEqual(formatShortDate("2024-12-31"), "12/31/2024");
      assert.strictEqual(formatShortDate("2025-01-01"), "01/01/2025");
    });

    test("should handle very old dates", () => {
      assert.strictEqual(formatShortDate("1900-01-01"), "01/01/1900");
      assert.strictEqual(formatLongDate("1900-01-01"), "January 1, 1900");
    });

    test("should handle various input formats", () => {
      // ISO format
      assert.ok(formatShortDate("2025-01-15").length > 0);
      // US format
      assert.ok(formatShortDate("01/15/2025").length > 0);
      // Long format
      assert.ok(formatShortDate("January 15, 2025").length > 0);
    });
  });
});
