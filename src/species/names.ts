import { query, writeConn } from "@/db/conn";
import { logger } from "@/utils/logger";
import { CatalogueRefusal, isUniqueViolation, speciesNotFound } from "./errors";
import { nameKinds, type Name, type NameKind, type SpeciesNames } from "./types";

/**
 * Where each kind of Name is stored. The two kinds are independent lists per
 * Species; nothing in the data pairs a common Name with a scientific one.
 */
export const nameTable = {
  common: { table: "species_common_name", id: "common_name_id", text: "common_name" },
  scientific: {
    table: "species_scientific_name",
    id: "scientific_name_id",
    text: "scientific_name",
  },
} as const satisfies Record<NameKind, { table: string; id: string; text: string }>;

export async function speciesExists(speciesId: number): Promise<boolean> {
  const rows = await query<{ group_id: number }>(
    "SELECT group_id FROM species_name_group WHERE group_id = ?",
    [speciesId]
  );
  return rows.length > 0;
}

/** A Species' Names, by kind, each list alphabetical. */
export async function listNames(speciesId: number): Promise<SpeciesNames> {
  const [common, scientific] = await Promise.all(
    nameKinds.map((kind) => {
      const t = nameTable[kind];
      return query<{ name_id: number; species_id: number; name: string }>(
        `SELECT ${t.id} AS name_id, group_id AS species_id, ${t.text} AS name
         FROM ${t.table} WHERE group_id = ? ORDER BY ${t.text}`,
        [speciesId]
      ).then((rows) => rows.map((row): Name => ({ ...row, kind })));
    })
  );
  return { common, scientific };
}

/**
 * Add a Name of the given kind to a Species.
 * @returns the new Name's id
 * @throws CatalogueRefusal if the text is empty, the Species is missing, or the
 *   Species already has this Name of this kind
 */
export async function addName(speciesId: number, kind: NameKind, text: string): Promise<number> {
  const trimmed = text.trim();
  const label = kind === "common" ? "Common name" : "Scientific name";
  if (!trimmed) {
    throw new CatalogueRefusal(`${label} cannot be empty`, "invalid");
  }
  if (!(await speciesExists(speciesId))) {
    throw speciesNotFound(speciesId);
  }

  const t = nameTable[kind];
  try {
    const stmt = await writeConn.prepare(
      `INSERT INTO ${t.table} (group_id, ${t.text}) VALUES (?, ?) RETURNING ${t.id} AS name_id`
    );
    try {
      const row = await stmt.get<{ name_id: number }>(speciesId, trimmed);
      if (!row) throw new Error(`Failed to insert ${kind} Name`);
      return row.name_id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CatalogueRefusal(
        `${label} "${trimmed}" already exists for this species`,
        "duplicate"
      );
    }
    logger.error(`Failed to add ${kind} Name`, err);
    throw new Error(`Failed to add ${kind} name`);
  }
}

/**
 * Remove one Name.
 * @returns 1 if removed, 0 if there was no such Name
 */
export async function removeName(kind: NameKind, nameId: number): Promise<number> {
  const t = nameTable[kind];
  try {
    const stmt = await writeConn.prepare(`DELETE FROM ${t.table} WHERE ${t.id} = ?`);
    try {
      const result = await stmt.run(nameId);
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error(`Failed to remove ${kind} Name`, err);
    throw new Error(`Failed to delete ${kind} name`);
  }
}
