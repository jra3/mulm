/**
 * Backfill MCP Server - Core Logic
 *
 * Provides tools for importing legacy CSV submission data into the database.
 * Handles CSV parsing, field normalization, member/species matching,
 * and bulk insertion of fully-approved historical submissions.
 */

import { z } from "zod";
import { defineTool, registerTools, positiveId } from "./tools";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { query } from "../db/conn";
import { containsPattern, containsSql } from "../db/likePattern";
import { parseCsv } from "../backfill/normalization";
import { validateHistoricalRows, importHistoricalRows } from "../backfill/import";
import { readFile, readdir, stat } from "fs/promises";
import { join, extname } from "path";
import * as catalogue from "../species";

const parseCsvSchema = z.object({
  file_path: z.string().describe("Absolute path to the CSV file"),
  preview_limit: z
    .number()
    .int()
    .nonnegative()
    .describe("Limit number of rows returned (default: all)")
    .optional(),
});

const validateImportSchema = z.object({
  file_path: z.string().describe("Absolute path to the CSV file"),
  member_id: positiveId
    .describe("Override member_id for all rows (optional, otherwise matched by name)")
    .optional(),
  admin_id: positiveId.describe("Admin member_id who is performing the import"),
  default_points: z
    .number()
    .describe("Default points if species base_points not found (optional)")
    .optional(),
});

const importSubmissionsSchema = z.object({
  file_path: z.string().describe("Absolute path to the CSV file"),
  member_id: positiveId.describe("Member ID to assign all submissions to"),
  admin_id: positiveId.describe("Admin member_id performing the import"),
  default_points: z.number().describe("Default points if species base_points not found").optional(),
  skip_rows: z
    .array(z.number().int().nonnegative())
    .describe("Row indices (0-based) to skip")
    .optional(),
  species_overrides: z
    .record(z.string().regex(/^(0|[1-9]\d*)$/), z.object({ group_id: positiveId }))
    .describe(
      "Map of row index (string) to { group_id } for manual Species matching (group_id from search_species_for_import)"
    )
    .optional(),
  date_overrides: z
    .record(z.string().regex(/^(0|[1-9]\d*)$/), z.iso.date())
    .describe("Map of row index (string) to ISO date string for manual date fixing")
    .optional(),
  dry_run: z
    .boolean()
    .describe("If true, runs all inserts then rolls back (default: false)")
    .optional(),
});

const listCsvFilesSchema = z.object({
  directory_path: z.string().describe("Absolute path to the directory to scan"),
});

const searchMemberForImportSchema = z.object({
  name: z.string().describe("Name to search for (partial match)"),
  email: z.string().describe("Email to search for (partial match)").optional(),
});

const searchSpeciesForImportSchema = z.object({
  query: z.string().describe("Search text (searches common and scientific names)"),
  species_type: z
    .string()
    .describe("Filter by species type (Fish, Invert, Plant, Coral)")
    .optional(),
});

async function parseCsvFile(filePath: string) {
  return parseCsv(await readFile(filePath, "utf-8"));
}

async function handleParseCsv(args: z.infer<typeof parseCsvSchema>) {
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

async function handleValidateImport(args: z.infer<typeof validateImportSchema>) {
  const { rows } = await parseCsvFile(args.file_path);
  const result = await validateHistoricalRows(rows, args);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ...result, file_path: args.file_path }, null, 2),
      },
    ],
  };
}

async function handleImportSubmissions(args: z.infer<typeof importSubmissionsSchema>) {
  const { rows } = await parseCsvFile(args.file_path);
  const result = await importHistoricalRows(rows, args);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

async function handleSearchMember(args: z.infer<typeof searchMemberForImportSchema>) {
  const { name, email } = args;

  const conditions: string[] = [];
  const params: string[] = [];

  if (name) {
    conditions.push(containsSql("display_name"));
    params.push(containsPattern(name));
  }

  if (email) {
    conditions.push(containsSql("contact_email"));
    params.push(containsPattern(email));
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

async function handleSearchSpecies(args: z.infer<typeof searchSpeciesForImportSchema>) {
  const { query: searchQuery, species_type } = args;

  if (!searchQuery || searchQuery.trim().length < 2) {
    throw new Error("Query must be at least 2 characters");
  }

  const { species } = await catalogue.getSpeciesForAdmin(
    { search: searchQuery, species_type },
    "name",
    20,
    0
  );
  const withNames = await Promise.all(
    species.map(async (s) => ({ species: s, names: await catalogue.listNames(s.group_id) }))
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            count: withNames.length,
            species: withNames.map(({ species: s, names }) => ({
              group_id: s.group_id,
              canonical_name: catalogue.canonicalName(s),
              common_names: names.common.map((n) => n.name),
              scientific_names: names.scientific.map((n) => n.name),
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

async function handleListCsvFiles(args: z.infer<typeof listCsvFilesSchema>) {
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

  registerTools(server, [
    defineTool(
      "parse_csv",
      "Read a CSV file and return structured rows with validation diagnostics",
      parseCsvSchema,
      handleParseCsv
    ),
    defineTool(
      "validate_import",
      "Preview import: normalize all fields, match members/species, report warnings per row",
      validateImportSchema,
      handleValidateImport
    ),
    defineTool(
      "import_submissions",
      "Execute import: insert fully-approved submissions in a single transaction. Use dry_run=true to test first.",
      importSubmissionsSchema,
      handleImportSubmissions
    ),
    defineTool(
      "list_csv_files",
      "List CSV files in a directory with their sizes",
      listCsvFilesSchema,
      handleListCsvFiles
    ),
    defineTool(
      "search_member_for_import",
      "Find a member by name or email for resolving member_id",
      searchMemberForImportSchema,
      handleSearchMember
    ),
    defineTool(
      "search_species_for_import",
      "Search Species by any Name or the Canonical name, for manual matching. Pass a result's group_id in import_submissions' species_overrides.",
      searchSpeciesForImportSchema,
      handleSearchSpecies
    ),
  ]);
}
