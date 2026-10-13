import { query, withTransaction } from "../db/conn";
import * as catalogue from "../species";
import type { Species } from "../species";
import { programOfSpeciesType } from "../points";
import {
  type CsvRow,
  normalizeDateString,
  normalizeWaterType,
  normalizeNullLike,
  normalizeFoods,
  normalizeSpawnLocations,
  parseFertilizers,
} from "./normalization";

export type ValidateHistoricalInput = {
  member_id?: number;
  admin_id: number;
  default_points?: number;
};
export type ImportHistoricalInput = ValidateHistoricalInput & {
  member_id: number;
  skip_rows?: number[];
  species_overrides?: Record<string, { group_id: number }>;
  date_overrides?: Record<string, string>;
  dry_run?: boolean;
};

type SpeciesMatch = {
  group_id: number;
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
    program: string | null;
    water_type: string | null;
    reproduction_date: string | null;
    count: string | null;
    foods: string | null;
    spawn_locations: string | null;
    points: number | null;
    /** The Species the Submission will be bound to. */
    species_id: number | null;
  };
  original: CsvRow;
};

/** The row's Program, or null when its species type is not one we know. */
function programOfRow(speciesType: string): string | null {
  return catalogue.isSpeciesType(speciesType) ? programOfSpeciesType(speciesType) : null;
}

/** What an import takes from the Species a row binds to. */
function speciesMatchOf(species: Species): SpeciesMatch {
  return {
    group_id: species.group_id,
    base_points: species.base_points,
    species_class: species.program_class,
  };
}

/** Resolve a row's spellings to a Species through the catalogue's lookup. */
async function matchSpecies(
  commonName: string | undefined,
  latinName: string | undefined
): Promise<SpeciesMatch | null> {
  const resolution = await catalogue.resolveSpecies({ commonName, latinName });
  return resolution ? speciesMatchOf(resolution.species) : null;
}

/** Historical records are imported as already approved; ordinary lifecycle transitions do not apply. */
export async function validateHistoricalRows(rows: CsvRow[], args: ValidateHistoricalInput) {
  const { member_id, admin_id, default_points } = args;

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
    let speciesId: number | null = null;
    let points: number | null = default_points ?? null;
    let speciesClass = row.species_class || "";

    if (speciesMatch) {
      speciesId = speciesMatch.group_id;
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
    const program = programOfRow(speciesType);
    if (!program) {
      warnings.push(`Unknown species type: "${speciesType}"`);
    }

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
        species_id: speciesId,
      },
      original: row,
    });
  }

  return {
    success: true,
    admin_id,
    total_rows: rows.length,
    ready_count: readyCount,
    attention_count: attentionCount,
    resolved_member: resolvedMember,
    validations,
  };
}

export async function importHistoricalRows(rows: CsvRow[], args: ImportHistoricalInput) {
  const {
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
        let speciesId: number | null = null;
        let points: number | null = default_points ?? null;
        let speciesClass = row.species_class || "";

        const override = species_overrides[overrideKey];
        const overrideSpecies = override
          ? await catalogue.findSpeciesById(override.group_id)
          : undefined;
        if (override && !overrideSpecies) {
          errors.push({ row_index: i, error: `Override species ${override.group_id} not found` });
          continue;
        }
        const speciesMatch = overrideSpecies
          ? speciesMatchOf(overrideSpecies)
          : await matchSpecies(row.species_common_name, row.species_latin_name);
        if (speciesMatch) {
          speciesId = speciesMatch.group_id;
          if (speciesMatch.base_points != null) {
            points = speciesMatch.base_points;
          }
          if (!speciesClass && speciesMatch.species_class) {
            speciesClass = speciesMatch.species_class;
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
        const program = programOfRow(speciesType);
        if (!program) {
          errors.push({ row_index: i, error: `Unknown species type: "${speciesType}"` });
          continue;
        }
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
          "species_id",
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
          now, // approved_on
          admin_id, // approved_by
          points,
          speciesId,
          "confirmed", // witness_verification_status
          admin_id, // witnessed_by
          now, // witnessed_on
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
  };
}
