/**
 * Rows in other tables that belong to a Species, and what merge and delete do
 * with them (#420).
 *
 * Production runs with foreign keys off, so no ON DELETE clause ever fires
 * there: a row the catalogue does not move or remove is left pointing at a
 * Species that no longer exists. Every table that holds a Species' id is
 * listed here, in one of three kinds.
 */
import type { Database } from "sqlite";
import { query } from "@/db/conn";

/**
 * A member's own records of a Species. Merge moves them to the winner;
 * delete is refused while any exist, whatever their state.
 */
const memberRecords = [
  { key: "collection", table: "species_collection", column: "group_id" },
  { key: "caresArticles", table: "cares_article", column: "species_group_id" },
  { key: "caresFryShares", table: "cares_fry_share", column: "species_group_id" },
] as const;

/**
 * The Species' own gallery and links. Merge moves the loser's after the
 * winner's, dropping any URL the winner already has; delete removes them.
 */
const enrichment = [
  { key: "images", table: "species_images", url: "image_url" },
  { key: "externalReferences", table: "species_external_references", url: "reference_url" },
] as const;

/**
 * Records of past syncs and IUCN suggestions about one Species' names. They
 * describe the loser, not the winner, so merge and delete both remove them.
 */
const syncRecords = ["external_data_sync_log", "iucn_sync_log", "iucn_canonical_recommendations"];

export type SpeciesReferences = Record<
  (typeof memberRecords)[number]["key"] | (typeof enrichment)[number]["key"],
  number
>;

/** How many rows elsewhere belong to this Species, by kind. */
export async function countReferencesOfSpecies(speciesId: number): Promise<SpeciesReferences> {
  const tables = [
    ...memberRecords,
    ...enrichment.map((e) => ({ key: e.key, table: e.table, column: "group_id" })),
  ];
  const [row] = await query<SpeciesReferences>(
    `SELECT ${tables
      .map((t) => `(SELECT COUNT(*) FROM ${t.table} WHERE ${t.column} = ?) AS ${t.key}`)
      .join(", ")}`,
    tables.map(() => speciesId)
  );
  return row;
}

export type CollectionConflict = { memberId: number; displayName: string };

const collectionConflictsSql = `
  SELECT DISTINCT m.id AS memberId, m.display_name AS displayName
  FROM species_collection w
  JOIN species_collection l ON l.member_id = w.member_id
  JOIN members m ON m.id = w.member_id
  WHERE w.group_id = ? AND l.group_id = ?
    AND w.removed_date IS NULL AND l.removed_date IS NULL
  ORDER BY m.display_name`;

/**
 * Members who keep both Species now. A member has one current collection
 * entry per Species, and its notes, photos and CARES registration are theirs,
 * so merge does not fold two into one: it refuses, and the member (or an
 * admin) removes one first.
 * @param db the transaction to read in; the read connection when omitted
 */
export async function findCollectionConflicts(
  winnerId: number,
  loserId: number,
  db?: Database
): Promise<CollectionConflict[]> {
  const params = [winnerId, loserId];
  return db
    ? db.all<CollectionConflict[]>(collectionConflictsSql, params)
    : query<CollectionConflict>(collectionConflictsSql, params);
}

/** In merge's transaction: every row of the loser's moves to the winner or goes. */
export async function moveReferences(db: Database, winnerId: number, loserId: number) {
  for (const t of memberRecords) {
    await db.run(`UPDATE ${t.table} SET ${t.column} = ? WHERE ${t.column} = ?`, [winnerId, loserId]);
  }
  for (const t of enrichment) {
    await db.run(
      `DELETE FROM ${t.table} WHERE group_id = ? AND ${t.url} IN (SELECT ${t.url} FROM ${t.table} WHERE group_id = ?)`,
      [loserId, winnerId]
    );
    await db.run(
      `UPDATE ${t.table}
       SET group_id = ?,
           display_order = display_order + (SELECT COALESCE(MAX(display_order) + 1, 0) FROM ${t.table} WHERE group_id = ?)
       WHERE group_id = ?`,
      [winnerId, winnerId, loserId]
    );
  }
  await deleteSyncRecords(db, loserId);
}

/** In delete's transaction: the Species' gallery, links and sync records go with it. */
export async function deleteOwnedRows(db: Database, speciesId: number) {
  for (const t of enrichment) {
    await db.run(`DELETE FROM ${t.table} WHERE group_id = ?`, [speciesId]);
  }
  await deleteSyncRecords(db, speciesId);
}

async function deleteSyncRecords(db: Database, speciesId: number) {
  for (const table of syncRecords) {
    await db.run(`DELETE FROM ${table} WHERE group_id = ?`, [speciesId]);
  }
}

/** Every table, other than the catalogue's own, that holds a Species id. */
export const speciesReferenceTables: string[] = [
  ...memberRecords.map((t) => t.table),
  ...enrichment.map((t) => t.table),
  ...syncRecords,
];
