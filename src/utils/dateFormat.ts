/**
 * Centralized date formatting utilities
 *
 * All date formatting should use these utilities to ensure consistency
 * across the application. Never use .toLocaleDateString() directly.
 *
 * @module dateFormat
 */

/**
 * Validates if a value is a valid date
 * @param date - The date value to validate (string, Date, or other)
 * @returns true if the date is valid, false otherwise
 */
export function isValidDate(date: string | Date | null | undefined): boolean {
  if (!date) {
    return false;
  }

  const d = new Date(date);
  return !isNaN(d.getTime());
}

/**
 * Formats a date as MM/DD/YYYY
 * Used for compact display in tables and lists
 *
 * @param date - The date to format (string or Date object)
 * @returns Formatted date string (MM/DD/YYYY) or empty string if invalid
 *
 * @example
 * formatShortDate('2025-01-15') // Returns: "01/15/2025"
 * formatShortDate(new Date()) // Returns: "10/07/2025"
 * formatShortDate(null) // Returns: ""
 */
export function formatShortDate(date: string | Date | null | undefined): string {
  if (!isValidDate(date)) {
    return '';
  }

  const d = new Date(date!);
  // Use Intl.DateTimeFormat for consistent formatting
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  }).format(d);
}

/**
 * Formats a date as "Month DD, YYYY"
 * Used for detailed views and formal contexts
 *
 * @param date - The date to format (string or Date object)
 * @returns Formatted date string (e.g., "January 15, 2025") or empty string if invalid
 *
 * @example
 * formatLongDate('2025-01-15') // Returns: "January 15, 2025"
 * formatLongDate(new Date()) // Returns: "October 7, 2025"
 */
export function formatLongDate(date: string | Date | null | undefined): string {
  if (!isValidDate(date)) {
    return '';
  }

  const d = new Date(date!);
  // Use Intl.DateTimeFormat for consistent formatting
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(d);
}

/**
 * Formats a date as a relative time string
 * Used for activity feeds and recent events
 *
 * @param date - The date to format (string or Date object)
 * @returns Relative time string (e.g., "3 days ago", "2 months ago") or empty string if invalid
 *
 * @example
 * formatRelativeDate('2025-10-04') // Returns: "3 days ago" (if today is Oct 7)
 * formatRelativeDate('2025-09-07') // Returns: "1 month ago"
 * formatRelativeDate('2024-10-07') // Returns: "1 year ago"
 */
export function formatRelativeDate(date: string | Date | null | undefined): string {
  if (!isValidDate(date)) {
    return '';
  }

  const d = new Date(date!);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  // Future dates
  if (diffMs < 0) {
    return 'in the future';
  }

  // Less than 1 minute
  if (diffMin < 1) {
    return 'just now';
  }

  // Less than 1 hour
  if (diffHour < 1) {
    return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`;
  }

  // Less than 1 day
  if (diffDay < 1) {
    return diffHour === 1 ? '1 hour ago' : `${diffHour} hours ago`;
  }

  // Less than 1 week
  if (diffWeek < 1) {
    return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
  }

  // Less than 1 month
  if (diffMonth < 1) {
    return diffWeek === 1 ? '1 week ago' : `${diffWeek} weeks ago`;
  }

  // Less than 1 year
  if (diffYear < 1) {
    return diffMonth === 1 ? '1 month ago' : `${diffMonth} months ago`;
  }

  // 1 year or more
  return diffYear === 1 ? '1 year ago' : `${diffYear} years ago`;
}

/**
 * Formats a date as an ISO 8601 string
 * Used for datetime attributes in HTML time elements
 *
 * @param date - The date to format (string or Date object)
 * @returns ISO date string (e.g., "2025-01-15T10:30:00.000Z") or empty string if invalid
 *
 * @example
 * formatISODate('2025-01-15') // Returns: "2025-01-15T00:00:00.000Z"
 * formatISODate(new Date()) // Returns: "2025-10-07T14:30:00.000Z"
 */
export function formatISODate(date: string | Date | null | undefined): string {
  if (!isValidDate(date)) {
    return '';
  }

  return new Date(date!).toISOString();
}
