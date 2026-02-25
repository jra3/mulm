/**
 * Backfill MCP Server - Core Logic
 *
 * Provides tools for importing legacy CSV submission data into the database.
 * Handles CSV parsing, field normalization, member/species matching,
 * and bulk insertion of fully-approved historical submissions.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { query, withTransaction } from "../db/conn";
import { parse } from "csv-parse/sync";
import { readFile, readdir, stat } from "fs/promises";
import { join, extname } from "path";
import { foodTypes, spawnLocations } from "../forms/submission";

// Type definitions

type CsvRow = Record<string, string>;

type ParseCsvArgs = {
  file_path: string;
  preview_limit?: number;
};

type ValidateImportArgs = {
  file_path: string;
  member_id?: number;
  admin_id: number;
  default_points?: number;
};

type ImportSubmissionsArgs = {
  file_path: string;
  member_id: number;
  admin_id: number;
  default_points?: number;
  skip_rows?: number[];
  species_overrides?: Record<string, { common_name_id: number; scientific_name_id: number }>;
  date_overrides?: Record<string, string>;
  dry_run?: boolean;
};

type SearchMemberArgs = {
  name: string;
  email?: string;
};

type SearchSpeciesArgs = {
  query: string;
  species_type?: string;
};

type ListCsvFilesArgs = {
  directory_path: string;
};

type SpeciesMatch = {
  common_name_id: number;
  scientific_name_id: number;
  group_id: number;
  common_name: string;
  scientific_name: string;
  base_points: number | null;
  species_class: string | null;
};

type RowValidation = {
  row_index: number;
  status: "ready" | "needs_attention";
  warnings: string[];
  normalized: {
    member_id: number | null;
    member_name: string | null;
    species_common_name: string;
    species_latin_name: string;
    species_type: string;
    species_class: string;
    program: string;
    water_type: string | null;
    reproduction_date: string | null;
    count: string | null;
    foods: string | null;
    spawn_locations: string | null;
    points: number | null;
    common_name_id: number | null;
    scientific_name_id: number | null;
  };
  original: CsvRow;
};

// Month name mapping for date normalization
const MONTH_MAP: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

// ============================================================================
// Internal Helpers
// ============================================================================

async function parseCsvFile(filePath: string): Promise<{ rows: CsvRow[]; columns: string[] }> {
  const content = await readFile(filePath, "utf-8");
  const rows: CsvRow[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, columns };
}

function normalizeDateString(input: string | undefined): string | null {
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

function normalizeWaterType(input: string | undefined): string | null {
  if (!input || !input.trim()) return null;
  const lower = input.trim().toLowerCase();
  if (lower === "freshwater" || lower === "fresh") return "Fresh";
  if (lower === "brackish") return "Brackish";
  if (lower === "saltwater" || lower === "salt" || lower === "marine") return "Salt";
  // Return as-is if it's already a valid value
  if (["Fresh", "Brackish", "Salt"].includes(input.trim())) return input.trim();
  return input.trim();
}

function normalizeNullLike(input: string | undefined): string | null {
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

function fuzzyMatchList(input: string | undefined, validOptions: string[]): string[] {
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

function normalizeFoods(input: string | undefined): string | null {
  const matched = fuzzyMatchList(input, foodTypes);
  return matched.length > 0 ? JSON.stringify(matched) : null;
}

function normalizeSpawnLocations(input: string | undefined): string | null {
  const matched = fuzzyMatchList(input, spawnLocations);
  return matched.length > 0 ? JSON.stringify(matched) : null;
}

function deriveProgram(speciesType: string): string {
  switch (speciesType) {
    case "Fish":
    case "Invert":
      return "fish";
    case "Plant":
      return "plant";
    case "Coral":
      return "coral";
    default:
      return "fish";
  }
}

async function matchSpecies(
  commonName: string | undefined,
  latinName: string | undefined
): Promise<SpeciesMatch | null> {
  if (!commonName && !latinName) return null;

  // Try exact latin name match first
  if (latinName && latinName.trim()) {
    const byLatin = await query<{
      common_name_id: number;
      scientific_name_id: number;
      group_id: number;
      common_name: string;
      scientific_name: string;
      base_points: number | null;
      program_class: string | null;
    }>(
      `SELECT
        cn.common_name_id,
        scin.scientific_name_id,
        sng.group_id,
        cn.common_name,
        scin.scientific_name,
        sng.base_points,
        sng.program_class
      FROM species_scientific_name scin
      JOIN species_name_group sng ON scin.group_id = sng.group_id
      LEFT JOIN species_common_name cn ON cn.group_id = sng.group_id
      WHERE LOWER(scin.scientific_name) = LOWER(?)
      LIMIT 1`,
      [latinName.trim()]
    );
    if (byLatin.length > 0) {
      return {
        common_name_id: byLatin[0].common_name_id,
        scientific_name_id: byLatin[0].scientific_name_id,
        group_id: byLatin[0].group_id,
        common_name: byLatin[0].common_name,
        scientific_name: byLatin[0].scientific_name,
        base_points: byLatin[0].base_points,
        species_class: byLatin[0].program_class,
      };
    }
  }

  // Try exact common name match
  if (commonName && commonName.trim()) {
    const byCommon = await query<{
      common_name_id: number;
      scientific_name_id: number;
      group_id: number;
      common_name: string;
      scientific_name: string;
      base_points: number | null;
      program_class: string | null;
    }>(
      `SELECT
        cn.common_name_id,
        scin.scientific_name_id,
        sng.group_id,
        cn.common_name,
        scin.scientific_name,
        sng.base_points,
        sng.program_class
      FROM species_common_name cn
      JOIN species_name_group sng ON cn.group_id = sng.group_id
      LEFT JOIN species_scientific_name scin ON scin.group_id = sng.group_id
      WHERE LOWER(cn.common_name) = LOWER(?)
      LIMIT 1`,
      [commonName.trim()]
    );
    if (byCommon.length > 0) {
      return {
        common_name_id: byCommon[0].common_name_id,
        scientific_name_id: byCommon[0].scientific_name_id,
        group_id: byCommon[0].group_id,
        common_name: byCommon[0].common_name,
        scientific_name: byCommon[0].scientific_name,
        base_points: byCommon[0].base_points,
        species_class: byCommon[0].program_class,
      };
    }
  }

  // Try canonical genus + species fallback from latin name
  if (latinName && latinName.trim()) {
    const parts = latinName.trim().split(/\s+/);
    if (parts.length >= 2) {
      const genus = parts[0];
      const species = parts.slice(1).join(" ");
      const byCanonical = await query<{
        common_name_id: number;
        scientific_name_id: number;
        group_id: number;
        common_name: string;
        scientific_name: string;
        base_points: number | null;
        program_class: string | null;
      }>(
        `SELECT
          cn.common_name_id,
          scin.scientific_name_id,
          sng.group_id,
          cn.common_name,
          scin.scientific_name,
          sng.base_points,
          sng.program_class
        FROM species_name_group sng
        LEFT JOIN species_common_name cn ON cn.group_id = sng.group_id
        LEFT JOIN species_scientific_name scin ON scin.group_id = sng.group_id
        WHERE LOWER(sng.canonical_genus) = LOWER(?)
        AND LOWER(sng.canonical_species_name) = LOWER(?)
        LIMIT 1`,
        [genus, species]
      );
      if (byCanonical.length > 0) {
        return {
          common_name_id: byCanonical[0].common_name_id,
          scientific_name_id: byCanonical[0].scientific_name_id,
          group_id: byCanonical[0].group_id,
          common_name: byCanonical[0].common_name,
          scientific_name: byCanonical[0].scientific_name,
          base_points: byCanonical[0].base_points,
          species_class: byCanonical[0].program_class,
        };
      }
    }
  }

  return null;
}

function parseFertilizers(input: string | undefined): Array<{ type: string; regimen: string }> {
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

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleParseCsv(args: ParseCsvArgs) {
  const { file_path, preview_limit } = args;
  const { rows, columns } = await parseCsvFile(file_path);

  const displayRows = preview_limit ? rows.slice(0, preview_limit) : rows;

  // Per-row field presence diagnostics
  const diagnostics = displayRows.map((row, index) => {
    const missing: string[] = [];
    const present: string[] = [];
    for (const col of columns) {
      if (!row[col] || !row[col].trim()) {
        missing.push(col);
      } else {
        present.push(col);
      }
    }
    return { row_index: index, present_count: present.length, missing_fields: missing };
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            file_path,
            total_rows: rows.length,
            columns,
            column_count: columns.length,
            displayed_rows: displayRows.length,
            rows: displayRows,
            diagnostics,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleValidateImport(args: ValidateImportArgs) {
  const { file_path, member_id, admin_id, default_points } = args;
  const { rows } = await parseCsvFile(file_path);

  // Resolve member if member_id provided
  let resolvedMember: { id: number; display_name: string } | null = null;
  if (member_id) {
    const members = await query<{ id: number; display_name: string }>(
      "SELECT id, display_name FROM members WHERE id = ?",
      [member_id]
    );
    if (members.length > 0) {
      resolvedMember = members[0];
    }
  }

  const validations: RowValidation[] = [];
  let readyCount = 0;
  let attentionCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const warnings: string[] = [];

    // Member resolution
    let rowMemberId: number | null = resolvedMember?.id ?? null;
    let rowMemberName: string | null = resolvedMember?.display_name ?? null;

    if (!rowMemberId && row.member_name) {
      const memberMatches = await query<{ id: number; display_name: string }>(
        "SELECT id, display_name FROM members WHERE LOWER(display_name) = LOWER(?)",
        [row.member_name.trim()]
      );
      if (memberMatches.length === 1) {
        rowMemberId = memberMatches[0].id;
        rowMemberName = memberMatches[0].display_name;
      } else if (memberMatches.length > 1) {
        warnings.push(`Multiple members match "${row.member_name}" — provide member_id`);
      } else {
        warnings.push(`No member found matching "${row.member_name}"`);
      }
    }

    if (!rowMemberId) {
      warnings.push("No member_id resolved");
    }

    // Species matching
    const speciesMatch = await matchSpecies(row.species_common_name, row.species_latin_name);
    let commonNameId: number | null = null;
    let scientificNameId: number | null = null;
    let points: number | null = default_points ?? null;
    let speciesClass = row.species_class || "";

    if (speciesMatch) {
      commonNameId = speciesMatch.common_name_id;
      scientificNameId = speciesMatch.scientific_name_id;
      if (speciesMatch.base_points != null) {
        points = speciesMatch.base_points;
      }
      if (!speciesClass && speciesMatch.species_class) {
        speciesClass = speciesMatch.species_class;
      }
    } else {
      warnings.push(
        `No species match for "${row.species_common_name || ""}" / "${row.species_latin_name || ""}"`
      );
    }

    if (points == null) {
      warnings.push("No points resolved (no species base_points and no default_points)");
    }

    // Date normalization
    const normalizedDate = normalizeDateString(row.reproduction_date);
    if (row.reproduction_date && !normalizedDate) {
      warnings.push(`Could not parse date: "${row.reproduction_date}"`);
    }

    // Water type
    const waterType = normalizeWaterType(row.water_type);

    // Species type
    const speciesType = row.species_type || "Fish";
    const program = deriveProgram(speciesType);

    // Species class warning
    if (!speciesClass) {
      warnings.push("No species_class resolved");
    }

    const status = warnings.length === 0 ? "ready" : "needs_attention";
    if (status === "ready") readyCount++;
    else attentionCount++;

    validations.push({
      row_index: i,
      status,
      warnings,
      normalized: {
        member_id: rowMemberId,
        member_name: rowMemberName,
        species_common_name: row.species_common_name || "",
        species_latin_name: row.species_latin_name || "",
        species_type: speciesType,
        species_class: speciesClass,
        program,
        water_type: waterType,
        reproduction_date: normalizedDate,
        count: row.count || null,
        foods: normalizeFoods(row.foods),
        spawn_locations: normalizeSpawnLocations(row.spawn_locations),
        points,
        common_name_id: commonNameId,
        scientific_name_id: scientificNameId,
      },
      original: row,
    });
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            file_path,
            admin_id,
            total_rows: rows.length,
            ready_count: readyCount,
            attention_count: attentionCount,
            resolved_member: resolvedMember,
            validations,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleImportSubmissions(args: ImportSubmissionsArgs) {
  const {
    file_path,
    member_id,
    admin_id,
    default_points,
    skip_rows = [],
    species_overrides = {},
    date_overrides = {},
    dry_run = false,
  } = args;

  // Verify member exists
  const members = await query<{ id: number; display_name: string }>(
    "SELECT id, display_name FROM members WHERE id = ?",
    [member_id]
  );
  if (members.length === 0) {
    throw new Error(`Member ${member_id} not found`);
  }
  const memberName = members[0].display_name;

  // Verify admin exists
  const admins = await query<{ id: number }>(
    "SELECT id FROM members WHERE id = ? AND is_admin = 1",
    [admin_id]
  );
  if (admins.length === 0) {
    throw new Error(`Admin ${admin_id} not found or not an admin`);
  }

  const { rows } = await parseCsvFile(file_path);
  const now = new Date().toISOString();
  const skipSet = new Set(skip_rows);

  const inserted: Array<{
    row_index: number;
    submission_id: number;
    species: string;
    points: number;
  }> = [];
  const skipped: Array<{ row_index: number; reason: string }> = [];
  const errors: Array<{ row_index: number; error: string }> = [];

  const doImport = async (db: Awaited<Parameters<Parameters<typeof withTransaction>[0]>[0]>) => {
    for (let i = 0; i < rows.length; i++) {
      if (skipSet.has(i)) {
        skipped.push({ row_index: i, reason: "Skipped by skip_rows" });
        continue;
      }

      const row = rows[i];

      try {
        // Species matching with overrides
        const overrideKey = String(i);
        let commonNameId: number | null = null;
        let scientificNameId: number | null = null;
        let points: number | null = default_points ?? null;
        let speciesClass = row.species_class || "";

        if (species_overrides[overrideKey]) {
          commonNameId = species_overrides[overrideKey].common_name_id;
          scientificNameId = species_overrides[overrideKey].scientific_name_id;
        } else {
          const speciesMatch = await matchSpecies(row.species_common_name, row.species_latin_name);
          if (speciesMatch) {
            commonNameId = speciesMatch.common_name_id;
            scientificNameId = speciesMatch.scientific_name_id;
            if (speciesMatch.base_points != null) {
              points = speciesMatch.base_points;
            }
            if (!speciesClass && speciesMatch.species_class) {
              speciesClass = speciesMatch.species_class;
            }
          }
        }

        if (points == null) {
          errors.push({ row_index: i, error: "No points resolved" });
          continue;
        }

        // Date handling with overrides
        let reproductionDate: string | null;
        if (date_overrides[overrideKey]) {
          reproductionDate = date_overrides[overrideKey];
        } else {
          reproductionDate = normalizeDateString(row.reproduction_date);
        }

        const speciesType = row.species_type || "Fish";
        const program = deriveProgram(speciesType);
        const waterType = normalizeWaterType(row.water_type);
        const foods = normalizeFoods(row.foods);
        const spawnLocs = normalizeSpawnLocations(row.spawn_locations);

        // Build insert
        const fields = [
          "member_id",
          "program",
          "species_type",
          "species_class",
          "species_common_name",
          "species_latin_name",
          "water_type",
          "reproduction_date",
          "count",
          "foods",
          "spawn_locations",
          "propagation_method",
          "tank_size",
          "filter_type",
          "water_change_volume",
          "water_change_frequency",
          "temperature",
          "ph",
          "gh",
          "specific_gravity",
          "substrate_type",
          "substrate_depth",
          "substrate_color",
          "light_type",
          "light_strength",
          "light_hours",
          "submitted_on",
          "approved_on",
          "approved_by",
          "points",
          "common_name_id",
          "scientific_name_id",
          "witness_verification_status",
          "witnessed_by",
          "witnessed_on",
        ];

        const values = [
          member_id,
          program,
          speciesType,
          speciesClass || null,
          row.species_common_name || "",
          row.species_latin_name || "",
          waterType,
          reproductionDate,
          row.count || null,
          foods,
          spawnLocs,
          row.propagation_method || null,
          row.tank_size || null,
          row.filter_type || null,
          row.water_change_volume || null,
          row.water_change_frequency || null,
          normalizeNullLike(row.temperature),
          normalizeNullLike(row.ph),
          normalizeNullLike(row.gh),
          normalizeNullLike(row.specific_gravity),
          row.substrate_type || null,
          row.substrate_depth || null,
          row.substrate_color || null,
          row.light_type || null,
          row.light_strength || null,
          row.light_hours || null,
          reproductionDate || now, // submitted_on
          now,                     // approved_on
          admin_id,                // approved_by
          points,
          commonNameId,
          scientificNameId,
          "confirmed",             // witness_verification_status
          admin_id,                // witnessed_by
          now,                     // witnessed_on
        ];

        const placeholders = fields.map(() => "?").join(", ");
        const stmt = await db.prepare(
          `INSERT INTO submissions (${fields.join(", ")}) VALUES (${placeholders})`
        );
        const result = await stmt.run(...values);
        await stmt.finalize();

        const submissionId = result.lastID as number;

        // Handle fertilizers → submission_supplements
        const fertilizers = parseFertilizers(row.fertilizers);
        if (fertilizers.length > 0) {
          const suppStmt = await db.prepare(
            `INSERT INTO submission_supplements
             (submission_id, supplement_type, supplement_regimen, display_order)
             VALUES (?, ?, ?, ?)`
          );
          for (let j = 0; j < fertilizers.length; j++) {
            await suppStmt.run(submissionId, fertilizers[j].type, fertilizers[j].regimen, j);
          }
          await suppStmt.finalize();
        }

        inserted.push({
          row_index: i,
          submission_id: submissionId,
          species: row.species_common_name || row.species_latin_name || "Unknown",
          points,
        });
      } catch (err) {
        errors.push({
          row_index: i,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  if (dry_run) {
    // Dry run: start transaction, do the work, then throw to rollback
    try {
      await withTransaction(async (db) => {
        await doImport(db);
        // Force rollback by throwing
        throw new Error("__DRY_RUN_ROLLBACK__");
      });
    } catch (err) {
      if (err instanceof Error && err.message !== "__DRY_RUN_ROLLBACK__") {
        throw err;
      }
    }
  } else {
    await withTransaction(async (db) => {
      await doImport(db);
    });
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            dry_run,
            member_id,
            member_name: memberName,
            admin_id,
            total_rows: rows.length,
            inserted_count: inserted.length,
            skipped_count: skipped.length,
            error_count: errors.length,
            total_points: inserted.reduce((sum, r) => sum + r.points, 0),
            inserted,
            skipped,
            errors,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleSearchMember(args: SearchMemberArgs) {
  const { name, email } = args;

  const conditions: string[] = [];
  const params: string[] = [];

  if (name) {
    conditions.push("LOWER(display_name) LIKE LOWER(?)");
    params.push(`%${name.trim()}%`);
  }

  if (email) {
    conditions.push("LOWER(contact_email) LIKE LOWER(?)");
    params.push(`%${email.trim()}%`);
  }

  if (conditions.length === 0) {
    throw new Error("Provide at least name or email");
  }

  const results = await query<{
    id: number;
    display_name: string;
    contact_email: string;
    is_admin: number;
  }>(
    `SELECT id, display_name, contact_email, is_admin
     FROM members
     WHERE ${conditions.join(" OR ")}
     ORDER BY display_name
     LIMIT 20`,
    params
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            count: results.length,
            members: results.map((m) => ({
              id: m.id,
              display_name: m.display_name,
              email: m.contact_email,
              is_admin: Boolean(m.is_admin),
            })),
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleSearchSpecies(args: SearchSpeciesArgs) {
  const { query: searchQuery, species_type } = args;

  if (!searchQuery || searchQuery.trim().length < 2) {
    throw new Error("Query must be at least 2 characters");
  }

  const pattern = `%${searchQuery.trim()}%`;

  const typeCondition = species_type
    ? "AND sng.species_type = ?"
    : "";
  const typeParams = species_type ? [species_type] : [];

  const results = await query<{
    group_id: number;
    common_name_id: number;
    scientific_name_id: number;
    common_name: string;
    scientific_name: string;
    program_class: string;
    species_type: string;
    base_points: number | null;
  }>(
    `SELECT DISTINCT
      sng.group_id,
      cn.common_name_id,
      scin.scientific_name_id,
      cn.common_name,
      scin.scientific_name,
      sng.program_class,
      sng.species_type,
      sng.base_points
    FROM species_name_group sng
    LEFT JOIN species_common_name cn ON cn.group_id = sng.group_id
    LEFT JOIN species_scientific_name scin ON scin.group_id = sng.group_id
    WHERE (LOWER(cn.common_name) LIKE LOWER(?) OR LOWER(scin.scientific_name) LIKE LOWER(?))
    ${typeCondition}
    ORDER BY cn.common_name
    LIMIT 20`,
    [pattern, pattern, ...typeParams]
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            count: results.length,
            species: results.map((s) => ({
              group_id: s.group_id,
              common_name_id: s.common_name_id,
              scientific_name_id: s.scientific_name_id,
              common_name: s.common_name,
              scientific_name: s.scientific_name,
              species_class: s.program_class,
              species_type: s.species_type,
              base_points: s.base_points,
            })),
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleListCsvFiles(args: ListCsvFilesArgs) {
  const { directory_path } = args;

  const entries = await readdir(directory_path);
  const csvFiles: Array<{ name: string; path: string; size: number }> = [];

  for (const entry of entries) {
    if (extname(entry).toLowerCase() === ".csv") {
      const fullPath = join(directory_path, entry);
      const stats = await stat(fullPath);
      csvFiles.push({
        name: entry,
        path: fullPath,
        size: stats.size,
      });
    }
  }

  csvFiles.sort((a, b) => a.name.localeCompare(b.name));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            directory: directory_path,
            count: csvFiles.length,
            files: csvFiles,
          },
          null,
          2
        ),
      },
    ],
  };
}

// ============================================================================
// Server Initialization
// ============================================================================

export function initializeBackfillServer(server: Server): void {
  /**
   * LIST RESOURCES HANDLER
   */
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "backfill://statistics",
          name: "Backfill Statistics",
          description: "Count of backfilled submissions (approved via backfill tool)",
          mimeType: "application/json",
        },
      ],
    };
  });

  /**
   * READ RESOURCE HANDLER
   */
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    if (uri === "backfill://statistics") {
      // Count submissions where approved_by is an admin and witness = approver
      // (heuristic for backfilled submissions)
      const stats = await query<{ count: number }>(
        `SELECT COUNT(*) as count FROM submissions
         WHERE approved_on IS NOT NULL
         AND witnessed_by = approved_by`
      );

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                backfilled_submission_count: stats[0]?.count ?? 0,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });

  /**
   * LIST TOOLS HANDLER
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "parse_csv",
          description: "Read a CSV file and return structured rows with validation diagnostics",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "Absolute path to the CSV file" },
              preview_limit: {
                type: "number",
                description: "Limit number of rows returned (default: all)",
              },
            },
            required: ["file_path"],
          },
        },
        {
          name: "validate_import",
          description:
            "Preview import: normalize all fields, match members/species, report warnings per row",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "Absolute path to the CSV file" },
              member_id: {
                type: "number",
                description: "Override member_id for all rows (optional, otherwise matched by name)",
              },
              admin_id: {
                type: "number",
                description: "Admin member_id who is performing the import",
              },
              default_points: {
                type: "number",
                description:
                  "Default points if species base_points not found (optional)",
              },
            },
            required: ["file_path", "admin_id"],
          },
        },
        {
          name: "import_submissions",
          description:
            "Execute import: insert fully-approved submissions in a single transaction. Use dry_run=true to test first.",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "Absolute path to the CSV file" },
              member_id: { type: "number", description: "Member ID to assign all submissions to" },
              admin_id: { type: "number", description: "Admin member_id performing the import" },
              default_points: {
                type: "number",
                description: "Default points if species base_points not found",
              },
              skip_rows: {
                type: "array",
                items: { type: "number" },
                description: "Row indices (0-based) to skip",
              },
              species_overrides: {
                type: "object",
                description:
                  "Map of row index (string) to { common_name_id, scientific_name_id } for manual species matching",
              },
              date_overrides: {
                type: "object",
                description: "Map of row index (string) to ISO date string for manual date fixing",
              },
              dry_run: {
                type: "boolean",
                description:
                  "If true, runs all inserts then rolls back (default: false)",
              },
            },
            required: ["file_path", "member_id", "admin_id"],
          },
        },
        {
          name: "list_csv_files",
          description: "List CSV files in a directory with their sizes",
          inputSchema: {
            type: "object",
            properties: {
              directory_path: {
                type: "string",
                description: "Absolute path to the directory to scan",
              },
            },
            required: ["directory_path"],
          },
        },
        {
          name: "search_member_for_import",
          description: "Find a member by name or email for resolving member_id",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Name to search for (partial match)" },
              email: { type: "string", description: "Email to search for (partial match)" },
            },
            required: ["name"],
          },
        },
        {
          name: "search_species_for_import",
          description: "Search species by common or latin name for manual matching",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search text (searches common and scientific names)",
              },
              species_type: {
                type: "string",
                description: "Filter by species type (Fish, Invert, Plant, Coral)",
              },
            },
            required: ["query"],
          },
        },
      ],
    };
  });

  /**
   * CALL TOOL HANDLER
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "parse_csv":
          return await handleParseCsv(args as ParseCsvArgs);
        case "validate_import":
          return await handleValidateImport(args as ValidateImportArgs);
        case "import_submissions":
          return await handleImportSubmissions(args as ImportSubmissionsArgs);
        case "list_csv_files":
          return await handleListCsvFiles(args as ListCsvFilesArgs);
        case "search_member_for_import":
          return await handleSearchMember(args as SearchMemberArgs);
        case "search_species_for_import":
          return await handleSearchSpecies(args as SearchSpeciesArgs);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                error: message,
                error_code: "TOOL_EXECUTION_ERROR",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  });
}
