import { query, writeConn, withTransaction } from "@/db/conn";
import { logger } from "@/utils/logger";
import { CatalogueRefusal, isUniqueViolation, speciesNotFound } from "./errors";
import { nameKinds, type Name, type NameKind, type SpeciesNames } from "./types";

/**
 * Where each kind of Name is stored. The two kinds are independent lists per
 * Species; nothing in the data pairs a common Name with a scientific one.
 */
export const nameTable = {
  common: {
    table: "species_common_name",
    id: "common_name_id",
    text: "common_name",
    canonical: "0",
  },
  scientific: {
    table: "species_scientific_name",
    id: "scientific_name_id",
    text: "scientific_name",
    canonical: "is_canonical",
  },
} as const satisfies Record<
  NameKind,
  { table: string; id: string; text: string; /** SQL for "is this the Canonical name" */ canonical: string }
>;

type NameRow = { name_id: number; species_id: number; name: string; canonical: number };

const toName =
  (kind: NameKind) =>
  (row: NameRow): Name => ({ ...row, kind, canonical: row.canonical === 1 });

/** The select list that reads a row of a name table as a `NameRow`. */
function nameColumns(kind: NameKind): string {
  const t = nameTable[kind];
  return `${t.id} AS name_id, group_id AS species_id, ${t.text} AS name, ${t.canonical} AS canonical`;
}

/**
 * The Canonical name is a flagged scientific Name whose text the Species row
 * caches; editing or removing it as a plain Name would let the two drift.
 */
function canonicalNameRefusal(action: string): CatalogueRefusal {
  return new CatalogueRefusal(
    `The Canonical name cannot be ${action} as a Name; rename the Species instead`,
    "canonical"
  );
}

const nameLabel = (kind: NameKind) => (kind === "common" ? "Common name" : "Scientific name");

/** A Name's text, trimmed; refused when empty. */
function requireNameText(kind: NameKind, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new CatalogueRefusal(`${nameLabel(kind)} cannot be empty`, "invalid");
  }
  return trimmed;
}

function duplicateName(kind: NameKind, text: string): CatalogueRefusal {
  return new CatalogueRefusal(`${nameLabel(kind)} "${text}" already exists for this species`, "duplicate");
}

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
      return query<NameRow>(
        `SELECT ${nameColumns(kind)} FROM ${t.table} WHERE group_id = ? ORDER BY ${t.text}`,
        [speciesId]
      ).then((rows) => rows.map(toName(kind)));
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
  const trimmed = requireNameText(kind, text);
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
    if (isUniqueViolation(err)) throw duplicateName(kind, trimmed);
    logger.error(`Failed to add ${kind} Name`, err);
    throw new Error(`Failed to add ${kind} name`);
  }
}

/**
 * Remove Names of one kind: one id, or several at once in one transaction.
 * @returns how many were removed (ids that do not exist are skipped)
 * @throws CatalogueRefusal if any of them is a Canonical name; then none is removed
 */
export async function removeName(kind: NameKind, nameIds: number | number[]): Promise<number> {
  const ids = Array.isArray(nameIds) ? nameIds : [nameIds];
  if (ids.length === 0) return 0;
  const t = nameTable[kind];
  try {
    return await withTransaction(async (db) => {
      const canonical = await db.get<{ name_id: number }>(
        `SELECT ${t.id} AS name_id FROM ${t.table}
         WHERE ${t.canonical} = 1 AND ${t.id} IN (${ids.map(() => "?").join(", ")})`,
        ids
      );
      if (canonical) throw canonicalNameRefusal("removed");

      const stmt = await db.prepare(`DELETE FROM ${t.table} WHERE ${t.id} = ?`);
      try {
        let removed = 0;
        for (const id of ids) {
          removed += (await stmt.run(id)).changes || 0;
        }
        return removed;
      } finally {
        await stmt.finalize();
      }
    });
  } catch (err) {
    if (err instanceof CatalogueRefusal) throw err;
    logger.error(`Failed to remove ${kind} Name`, err);
    throw new Error(`Failed to delete ${kind} name`);
  }
}

/**
 * Correct the text of one Name in place, keeping its id, so Submissions that
 * reference it keep referencing it.
 *
 * The Canonical name is refused: it changes only through `renameCanonical`,
 * which also keeps the cached genus and epithet and the previous name.
 * @returns 1 if updated, 0 if there was no such Name
 * @throws CatalogueRefusal if the text is empty, the Species already has it,
 *   or the Name is the Canonical name
 */
export async function updateName(kind: NameKind, nameId: number, text: string): Promise<number> {
  const trimmed = requireNameText(kind, text);
  const t = nameTable[kind];
  const canonical = await query<{ name_id: number }>(
    `SELECT ${t.id} AS name_id FROM ${t.table} WHERE ${t.id} = ? AND ${t.canonical} = 1`,
    [nameId]
  );
  if (canonical.length > 0) throw canonicalNameRefusal("edited");
  try {
    const stmt = await writeConn.prepare(
      `UPDATE ${t.table} SET ${t.text} = ? WHERE ${t.id} = ? AND ${t.canonical} = 0`
    );
    try {
      return (await stmt.run(trimmed, nameId)).changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateName(kind, trimmed);
    logger.error(`Failed to update ${kind} Name`, err);
    throw new Error(`Failed to update ${kind} name`);
  }
}

/**
 * The id of the Species' Name of this kind with exactly this text, adding the
 * Name first if the Species lacks it. This is how approval turns a
 * Submission's spellings into Name references today; it goes when
 * Submissions bind to their Species by id.
 */
export async function ensureName(speciesId: number, kind: NameKind, text: string): Promise<number> {
  const t = nameTable[kind];
  const rows = await query<{ name_id: number }>(
    `SELECT ${t.id} AS name_id FROM ${t.table} WHERE group_id = ? AND ${t.text} = ?`,
    [speciesId, text.trim()]
  );
  return rows[0]?.name_id ?? addName(speciesId, kind, text);
}

/**
 * Every Name with this text, whole and ignoring case, across all Species.
 * Pass a kind to search only common or only scientific Names.
 */
export async function findNames(text: string, kind?: NameKind): Promise<Name[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const kinds = kind ? [kind] : nameKinds;
  const found = await Promise.all(
    kinds.map((k) => {
      const t = nameTable[k];
      return query<NameRow>(
        `SELECT ${nameColumns(k)}
         FROM ${t.table} WHERE LOWER(${t.text}) = LOWER(?) ORDER BY group_id, ${t.id}`,
        [trimmed]
      ).then((rows) => rows.map(toName(k)));
    })
  );
  return found.flat();
}
