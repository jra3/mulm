/**
 * The catalogue's writes to Species identity: create, classify, rename, merge,
 * delete. Each one reads, guards, then writes; the multi-row ones write in one
 * transaction.
 */
import type { Database } from "sqlite";
import { writeConn, withTransaction } from "@/db/conn";
import { logger } from "@/utils/logger";
import { CatalogueRefusal, isUniqueViolation, speciesNotFound } from "./errors";
import { findSpeciesById } from "./lookup";
import { nameTable } from "./names";
import { admitPointClass } from "./pointClass";
import { countSubmissionsOfSpecies } from "./submissions";
import { canonicalName, isSpeciesType, speciesTypes, type NameKind } from "./types";

function admitSpeciesType(value: string): string {
  if (!isSpeciesType(value)) {
    throw new CatalogueRefusal(
      `Species type must be one of ${speciesTypes.join(", ")}`,
      "invalid"
    );
  }
  return value;
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new CatalogueRefusal(`${label} cannot be empty`, "invalid");
  return trimmed;
}

export type NewSpecies = {
  canonicalGenus: string;
  canonicalSpeciesName: string;
  programClass: string;
  speciesType: string;
  pointClass?: number | null;
  isCaresSpecies?: boolean;
};

/**
 * Create a Species.
 * @returns the new Species' id
 * @throws CatalogueRefusal on empty or invalid fields, a Point class outside
 *   the tally keys, or a Canonical name another Species already has
 */
export async function createSpecies(data: NewSpecies): Promise<number> {
  const genus = requireText(data.canonicalGenus, "Canonical genus");
  const epithet = requireText(data.canonicalSpeciesName, "Canonical species name");
  const name = canonicalName({ canonical_genus: genus, canonical_species_name: epithet });
  const programClass = requireText(data.programClass, "Program class");
  const speciesType = admitSpeciesType(data.speciesType);
  const pointClass = admitPointClass(data.pointClass ?? null);

  try {
    const stmt = await writeConn.prepare(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING group_id
    `);
    try {
      const row = await stmt.get<{ group_id: number }>(
        programClass,
        speciesType,
        genus,
        epithet,
        pointClass,
        data.isCaresSpecies ? 1 : 0
      );
      if (!row) throw new Error("Failed to create species");
      logger.info("Created species", {
        speciesId: row.group_id,
        canonicalName: name,
        speciesType,
        programClass,
      });
      return row.group_id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CatalogueRefusal(`Species "${name}" already exists`, "duplicate");
    }
    logger.error("Failed to create species", err);
    throw new Error("Failed to create species");
  }
}

export type SpeciesUpdate = {
  programClass?: string;
  speciesType?: string;
  pointClass?: number | null;
  isCaresSpecies?: boolean;
};

/**
 * Update a Species' Program class, Species type, Point class and CARES flag.
 * The Canonical name changes only through `renameCanonical`.
 * @returns 1 if the Species was updated, 0 if it does not exist
 * @throws CatalogueRefusal on an empty update or an invalid field
 */
export async function updateSpecies(speciesId: number, update: SpeciesUpdate): Promise<number> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (update.programClass !== undefined) {
    fields.push("program_class = ?");
    values.push(requireText(update.programClass, "Program class"));
  }
  if (update.speciesType !== undefined) {
    fields.push("species_type = ?");
    values.push(admitSpeciesType(update.speciesType));
  }
  if (update.pointClass !== undefined) {
    fields.push("base_points = ?");
    values.push(admitPointClass(update.pointClass));
  }
  if (update.isCaresSpecies !== undefined) {
    fields.push("is_cares_species = ?");
    values.push(update.isCaresSpecies ? 1 : 0);
  }
  if (fields.length === 0) {
    throw new CatalogueRefusal("At least one field must be provided", "invalid");
  }

  try {
    const stmt = await writeConn.prepare(
      `UPDATE species_name_group SET ${fields.join(", ")} WHERE group_id = ?`
    );
    try {
      const result = await stmt.run(...values, speciesId);
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error("Failed to update species", err);
    throw new Error("Failed to update species");
  }
}

/**
 * Set the Point class of several Species at once.
 * @returns how many Species were updated
 */
export async function setPointClass(speciesIds: number[], pointClass: number | null): Promise<number> {
  if (speciesIds.length === 0) {
    throw new CatalogueRefusal("At least one species must be provided", "invalid");
  }
  const value = admitPointClass(pointClass);

  try {
    const placeholders = speciesIds.map(() => "?").join(", ");
    const stmt = await writeConn.prepare(
      `UPDATE species_name_group SET base_points = ? WHERE group_id IN (${placeholders})`
    );
    try {
      const result = await stmt.run(value, ...speciesIds);
      logger.info("Set Point class", { speciesIds, pointClass: value, updated: result.changes });
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error("Failed to set Point class", err);
    throw new Error("Failed to set point class");
  }
}

/** Add `text` as a scientific Name of the Species unless it already has it (any case). */
async function ensureScientificName(db: Database, speciesId: number, text: string) {
  const t = nameTable.scientific;
  const existing = await db.get<{ name_id: number }>(
    `SELECT ${t.id} AS name_id FROM ${t.table} WHERE group_id = ? AND LOWER(${t.text}) = LOWER(?)`,
    [speciesId, text]
  );
  if (!existing) {
    await db.run(`INSERT INTO ${t.table} (group_id, ${t.text}) VALUES (?, ?)`, [speciesId, text]);
  }
}

/**
 * Change a Species' Canonical name. The previous Canonical name stays findable
 * as a scientific Name of the Species - never a common Name (ADR-0002). A
 * change of case only is a spelling fix and keeps no old name.
 * @throws CatalogueRefusal if the Species is missing, a part is empty, or
 *   another Species already has this Canonical name
 */
export async function renameCanonical(
  speciesId: number,
  genus: string,
  epithet: string
): Promise<void> {
  const newGenus = requireText(genus, "Canonical genus");
  const newEpithet = requireText(epithet, "Canonical species name");

  const species = await findSpeciesById(speciesId);
  if (!species) throw speciesNotFound(speciesId);

  const previous = canonicalName(species);
  const next = canonicalName({ canonical_genus: newGenus, canonical_species_name: newEpithet });
  if (previous === next) return;

  try {
    await withTransaction(async (db) => {
      await db.run(
        `UPDATE species_name_group SET canonical_genus = ?, canonical_species_name = ? WHERE group_id = ?`,
        [newGenus, newEpithet, speciesId]
      );
      if (previous.toLowerCase() !== next.toLowerCase()) {
        await ensureScientificName(db, speciesId, previous);
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CatalogueRefusal("A species with this canonical name already exists", "duplicate");
    }
    logger.error("Failed to rename species", err);
    throw new Error("Failed to rename species");
  }
  logger.info("Renamed species", { speciesId, from: previous, to: next });
}

/**
 * Move one kind of the loser's Names to the winner. A Name the winner already
 * has (any case) is not duplicated: the loser's Submissions are repointed to
 * the winner's copy and the loser's row goes.
 */
async function moveNames(db: Database, kind: NameKind, winnerId: number, loserId: number) {
  const t = nameTable[kind];
  const loserNames = await db.all<Array<{ name_id: number; name: string }>>(
    `SELECT ${t.id} AS name_id, ${t.text} AS name FROM ${t.table} WHERE group_id = ?`,
    [loserId]
  );
  for (const name of loserNames) {
    const winnerCopy = await db.get<{ name_id: number }>(
      `SELECT ${t.id} AS name_id FROM ${t.table}
       WHERE group_id = ? AND LOWER(${t.text}) = LOWER(?)
       ORDER BY ${t.text} = ? DESC LIMIT 1`,
      [winnerId, name.name, name.name]
    );
    if (winnerCopy) {
      await db.run(`UPDATE submissions SET ${t.id} = ? WHERE ${t.id} = ?`, [
        winnerCopy.name_id,
        name.name_id,
      ]);
      await db.run(`DELETE FROM ${t.table} WHERE ${t.id} = ?`, [name.name_id]);
    } else {
      await db.run(`UPDATE ${t.table} SET group_id = ? WHERE ${t.id} = ?`, [
        winnerId,
        name.name_id,
      ]);
    }
  }
}

/**
 * Merge the loser into the winner: every Name of the loser moves to the
 * winner, deduplicated; the loser's Canonical name becomes a scientific Name of
 * the winner; the loser's Submissions follow their Names to the winner, so
 * approved Submissions and their Points are untouched; then the loser is
 * deleted.
 * @throws CatalogueRefusal if either Species is missing or they are the same
 */
export async function mergeSpecies(winnerId: number, loserId: number): Promise<void> {
  if (winnerId === loserId) {
    throw new CatalogueRefusal("Cannot merge a species into itself", "invalid");
  }
  const [winner, loser] = await Promise.all([findSpeciesById(winnerId), findSpeciesById(loserId)]);
  if (!winner) throw speciesNotFound(winnerId);
  if (!loser) throw speciesNotFound(loserId);

  try {
    await withTransaction(async (db) => {
      await moveNames(db, "common", winnerId, loserId);
      await moveNames(db, "scientific", winnerId, loserId);

      const loserCanonical = canonicalName(loser);
      if (loserCanonical.toLowerCase() !== canonicalName(winner).toLowerCase()) {
        await ensureScientificName(db, winnerId, loserCanonical);
      }

      await db.run("DELETE FROM species_name_group WHERE group_id = ?", [loserId]);
    });
  } catch (err) {
    logger.error("Failed to merge species", err);
    throw new Error("Failed to merge species");
  }
  logger.info("Merged species", {
    winnerId,
    loserId,
    loserCanonicalName: canonicalName(loser),
  });
}

/**
 * Delete a Species and its Names. Refused while any Submission, in any state,
 * references it: merge it into the Species it duplicates instead.
 * @returns 1 when deleted
 * @throws CatalogueRefusal if the Species is missing or referenced
 */
export async function deleteSpecies(speciesId: number): Promise<number> {
  const species = await findSpeciesById(speciesId);
  if (!species) throw speciesNotFound(speciesId);

  const submissions = await countSubmissionsOfSpecies(speciesId);
  if (submissions.total > 0) {
    throw new CatalogueRefusal(
      `Species is referenced by ${submissions.total} submission(s) (approved submissions: ${submissions.approved}). ` +
        "Merge it into another species instead of deleting it.",
      "referenced"
    );
  }

  let changes = 0;
  try {
    await withTransaction(async (db) => {
      for (const t of Object.values(nameTable)) {
        await db.run(`DELETE FROM ${t.table} WHERE group_id = ?`, [speciesId]);
      }
      const result = await db.run("DELETE FROM species_name_group WHERE group_id = ?", [speciesId]);
      changes = result.changes || 0;
    });
  } catch (err) {
    logger.error("Failed to delete species", err);
    throw new Error("Failed to delete species");
  }
  logger.info("Deleted species", { speciesId, canonicalName: canonicalName(species) });
  return changes;
}

