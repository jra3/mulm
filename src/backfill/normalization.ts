import { parse } from "csv-parse/sync";
import { foodTypes, spawnLocations } from "../forms/submission";
export type CsvRow = Record<string, string>;

/** Parse historical CSV text without filesystem or database access. */
export function parseCsv(content: string): { rows: CsvRow[]; columns: string[] } {
  const rows: CsvRow[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  return { rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] };
}

// Month name mapping for date normalization
const MONTH_MAP: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

// ============================================================================
// Internal Helpers
// ============================================================================

export function normalizeDateString(input: string | undefined): string | null {
  if (!input || !input.trim()) return null;

  const trimmed = input.trim();

  // ISO date passthrough (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // MM/DD/YYYY or M/D/YYYY
  const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const month = mdyMatch[1].padStart(2, "0");
    const day = mdyMatch[2].padStart(2, "0");
    return `${mdyMatch[3]}-${month}-${day}`;
  }

  const lower = trimmed.toLowerCase();

  // "Mid April 2024" → 2024-04-15
  const midMatch = lower.match(/^mid\s+(\w+)\s+(\d{4})$/);
  if (midMatch) {
    const month = MONTH_MAP[midMatch[1]];
    if (month) {
      return `${midMatch[2]}-${String(month).padStart(2, "0")}-15`;
    }
  }

  // "June/July 2024" or "June-July 2024" → midpoint of first month
  const rangeMatch = lower.match(/^(\w+)\s*[-/]\s*(\w+)\s+(\d{4})$/);
  if (rangeMatch) {
    const month = MONTH_MAP[rangeMatch[1]];
    if (month) {
      return `${rangeMatch[3]}-${String(month).padStart(2, "0")}-15`;
    }
  }

  // "Dec 2024", "September 2024", "Sept 2024" → first of month
  const monthYearMatch = lower.match(/^(\w+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const month = MONTH_MAP[monthYearMatch[1]];
    if (month) {
      return `${monthYearMatch[2]}-${String(month).padStart(2, "0")}-01`;
    }
  }

  // If it parses as a valid JS Date, use it
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().split("T")[0];
  }

  // Unrecognizable
  return null;
}

export function normalizeWaterType(input: string | undefined): string | null {
  if (!input || !input.trim()) return null;
  const lower = input.trim().toLowerCase();
  if (lower === "freshwater" || lower === "fresh") return "Fresh";
  if (lower === "brackish") return "Brackish";
  if (lower === "saltwater" || lower === "salt" || lower === "marine") return "Salt";
  // Return as-is if it's already a valid value
  if (["Fresh", "Brackish", "Salt"].includes(input.trim())) return input.trim();
  return input.trim();
}

export function normalizeNullLike(input: string | undefined): string | null {
  if (!input) return null;
  const lower = input.trim().toLowerCase();
  if (
    lower === "" ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "none" ||
    lower === "dont test" ||
    lower === "don't test" ||
    lower === "unknown" ||
    lower === "not tested" ||
    lower === "-" ||
    lower === "?"
  ) {
    return null;
  }
  return input.trim();
}

export function fuzzyMatchList(input: string | undefined, validOptions: string[]): string[] {
  if (!input || !input.trim()) return [];

  // Split on commas, semicolons, or " and "
  const parts = input
    .split(/[,;]|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const matched: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    // Exact match first
    const exact = validOptions.find((opt) => opt.toLowerCase() === lower);
    if (exact) {
      matched.push(exact);
      continue;
    }
    // Prefix match
    const prefix = validOptions.find((opt) => opt.toLowerCase().startsWith(lower));
    if (prefix) {
      matched.push(prefix);
      continue;
    }
    // Contains match
    const contains = validOptions.find((opt) => opt.toLowerCase().includes(lower));
    if (contains) {
      matched.push(contains);
      continue;
    }
    // Keep original if no match found
    matched.push(part);
  }

  return [...new Set(matched)];
}

export function normalizeFoods(input: string | undefined): string | null {
  const matched = fuzzyMatchList(input, foodTypes);
  return matched.length > 0 ? JSON.stringify(matched) : null;
}

export function normalizeSpawnLocations(input: string | undefined): string | null {
  const matched = fuzzyMatchList(input, spawnLocations);
  return matched.length > 0 ? JSON.stringify(matched) : null;
}

export function parseFertilizers(
  input: string | undefined
): Array<{ type: string; regimen: string }> {
  if (!input || !input.trim() || normalizeNullLike(input) === null) return [];

  // Split on commas or semicolons
  const parts = input
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.map((part) => ({
    type: part,
    regimen: "",
  }));
}
