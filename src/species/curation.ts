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
import { listNames, nameTable } from "./names";
import { admitPointClass } from "./pointClass";
import { countSubmissionsOfSpecies } from "./submissions";
import { canonicalName, isSpeciesType, nameKinds, speciesTypes, type NameKind } from "./types";

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
 * Create a Species, with its Canonical name as its one flagged scientific Name.
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

  let speciesId: number;
  try {
    speciesId = await withTransaction(async (db) => {
      const row = await db.get<{ group_id: number }>(
        `INSERT INTO species_name_group (
          program_class, species_type, canonical_genus, canonical_species_name,
          base_points, is_cares_species
        ) VALUES (?, ?, ?, ?, ?, ?)
        RETURNING group_id`,
        [programClass, speciesType, genus, epithet, pointClass, data.isCaresSpecies ? 1 : 0]
      );
      if (!row) throw new Error("Failed to create species");
      await insertCanonicalName(db, row.group_id, name);
      return row.group_id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CatalogueRefusal(`Species "${name}" already exists`, "duplicate");
    }
    logger.error("Failed to create species", err);
    throw new Error("Failed to create species");
  }
  logger.info("Created species", { speciesId, canonicalName: name, speciesType, programClass });
  return speciesId;
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

const scientific = nameTable.scientific;

/** Add `text` as the Species' flagged scientific Name. */
async function insertCanonicalName(db: Database, speciesId: number, text: string) {
  await db.run(
    `INSERT INTO ${scientific.table} (group_id, ${scientific.text}, ${scientific.canonical}) VALUES (?, ?, 1)`,
    [speciesId, text]
  );
}

/** Remove a Name that duplicates another. Submissions bind to Species, not Names, so none follow it. */
async function deleteDuplicateName(db: Database, kind: NameKind, nameId: number) {
  const t = nameTable[kind];
  await db.run(`DELETE FROM ${t.table} WHERE ${t.id} = ?`, [nameId]);
}

type NameText = { name_id: number; name: string };

/**
 * Move the Canonical flag to `next`, inside a rename's transaction. The
 * Species' scientific Name with that text becomes the flagged one - exact
 * spelling first, else one differing only in case, whose spelling is
 * corrected - or `next` is added. The previously flagged Name stays as an
 * unflagged scientific Name, unless it differs from `next` only in case: a
 * spelling fix keeps nothing, so it folds into the new one.
 */
async function moveCanonicalFlag(db: Database, speciesId: number, next: string) {
  const flagged = await db.get<NameText>(
    `SELECT ${scientific.id} AS name_id, ${scientific.text} AS name FROM ${scientific.table}
     WHERE group_id = ? AND ${scientific.canonical} = 1`,
    [speciesId]
  );
  const target = await db.get<NameText>(
    `SELECT ${scientific.id} AS name_id, ${scientific.text} AS name FROM ${scientific.table}
     WHERE group_id = ? AND LOWER(${scientific.text}) = LOWER(?)
     ORDER BY ${scientific.text} = ? DESC, ${scientific.canonical} DESC, ${scientific.id}
     LIMIT 1`,
    [speciesId, next, next]
  );

  if (flagged && flagged.name_id !== target?.name_id) {
    await db.run(`UPDATE ${scientific.table} SET ${scientific.canonical} = 0 WHERE ${scientific.id} = ?`, [
      flagged.name_id,
    ]);
    if (target && flagged.name.toLowerCase() === next.toLowerCase()) {
      await deleteDuplicateName(db, "scientific", flagged.name_id);
    }
  }
  if (!target) {
    await insertCanonicalName(db, speciesId, next);
    return;
  }
  await db.run(
    `UPDATE ${scientific.table} SET ${scientific.text} = ?, ${scientific.canonical} = 1 WHERE ${scientific.id} = ?`,
    [next, target.name_id]
  );
}

/**
 * Change a Species' Canonical name: the flag moves to the new name's
 * scientific Name (added, or one the Species already has) and the cached
 * genus and epithet follow. The previous Canonical name stays findable as an
 * unflagged scientific Name of the Species - never a common Name (ADR-0002).
 * A change of case only is a spelling fix and keeps no old name.
 *
 * `alongside` runs in the same transaction, for a caller whose own record of
 * the rename must commit or roll back with it (accepting an IUCN
 * recommendation marks the recommendation accepted).
 * @throws CatalogueRefusal if the Species is missing, a part is empty, or
 *   another Species already has this Canonical name
 */
export async function renameCanonical(
  speciesId: number,
  genus: string,
  epithet: string,
  { alongside }: { alongside?: (db: Database) => Promise<void> } = {}
): Promise<void> {
  const newGenus = requireText(genus, "Canonical genus");
  const newEpithet = requireText(epithet, "Canonical species name");

  const species = await findSpeciesById(speciesId);
  if (!species) throw speciesNotFound(speciesId);

  const previous = canonicalName(species);
  const next = canonicalName({ canonical_genus: newGenus, canonical_species_name: newEpithet });
  if (previous === next && !alongside) return;

  try {
    await withTransaction(async (db) => {
      if (previous !== next) {
        await db.run(
          `UPDATE species_name_group SET canonical_genus = ?, canonical_species_name = ? WHERE group_id = ?`,
          [newGenus, newEpithet, speciesId]
        );
        await moveCanonicalFlag(db, speciesId, next);
      }
      if (alongside) await alongside(db);
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
 * has (any case) is not duplicated: it folds into the winner's copy. The
 * caller clears the loser's Canonical flag first, or the index refuses the move.
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
      await deleteDuplicateName(db, kind, name.name_id);
    } else {
      await db.run(`UPDATE ${t.table} SET group_id = ? WHERE ${t.id} = ?`, [
        winnerId,
        name.name_id,
      ]);
    }
  }
}

export type MergePreview = {
  winnerCanonicalName: string;
  loserCanonicalName: string;
  /** The loser's Names the winner lacks, by kind: these move. */
  moving: Record<NameKind, string[]>;
  /** The loser's Names the winner already has (any case), by kind: these fold into the winner's. */
  folding: Record<NameKind, string[]>;
  /**
   * Whether the loser's Canonical name moves to the winner as a new
   * (unflagged) scientific Name; false when the winner already has it.
   */
  keepsLoserCanonicalName: boolean;
  /** Submissions of the loser, which are rebound to the winner. */
  submissions: { total: number; approved: number };
};

/**
 * What `mergeSpecies(winnerId, loserId)` would do, without doing it.
 * @throws CatalogueRefusal as `mergeSpecies` would
 */
export async function previewMerge(winnerId: number, loserId: number): Promise<MergePreview> {
  if (winnerId === loserId) {
    throw new CatalogueRefusal("Cannot merge a species into itself", "invalid");
  }
  const [winner, loser] = await Promise.all([findSpeciesById(winnerId), findSpeciesById(loserId)]);
  if (!winner) throw speciesNotFound(winnerId);
  if (!loser) throw speciesNotFound(loserId);

  const [winnerNames, loserNames, submissions] = await Promise.all([
    listNames(winnerId),
    listNames(loserId),
    countSubmissionsOfSpecies(loserId),
  ]);
  const moving: Record<NameKind, string[]> = { common: [], scientific: [] };
  const folding: Record<NameKind, string[]> = { common: [], scientific: [] };
  for (const kind of nameKinds) {
    const held = new Set(winnerNames[kind].map((n) => n.name.toLowerCase()));
    for (const name of loserNames[kind]) {
      (held.has(name.name.toLowerCase()) ? folding : moving)[kind].push(name.name);
    }
  }

  const loserCanonical = canonicalName(loser);
  return {
    winnerCanonicalName: canonicalName(winner),
    loserCanonicalName: loserCanonical,
    moving,
    folding,
    // The loser's flagged Name has exactly the cache's text, so it is among
    // `moving` unless the winner already has it in some case.
    keepsLoserCanonicalName: moving.scientific.includes(loserCanonical),
    submissions,
  };
}

/**
 * Merge the loser into the winner: every Name of the loser moves to the
 * winner, deduplicated without regard to case; the winner keeps its Canonical
 * name, and the loser's comes along as an unflagged scientific Name; the
 * loser's Submissions are rebound to the winner, so approved Submissions and
 * their Points are untouched; then the loser is deleted.
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
      // The winner keeps its Canonical name; the loser's moves as a plain scientific Name.
      await db.run(
        `UPDATE ${scientific.table} SET ${scientific.canonical} = 0 WHERE group_id = ?`,
        [loserId]
      );
      await moveNames(db, "common", winnerId, loserId);
      await moveNames(db, "scientific", winnerId, loserId);
      await db.run("UPDATE submissions SET species_id = ? WHERE species_id = ?", [winnerId, loserId]);

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
      `Species is referenced by ${submissions.total} submission(s), ${submissions.approved} of them approved. ` +
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

