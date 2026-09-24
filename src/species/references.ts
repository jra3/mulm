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
 * A member's own records of a Species. Merge moves them to the winner (a
 * member keeping both Species keeps one current entry: see
 * `retireDuplicateEntries`); delete is refused while any exist, whatever
 * their state.
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
  { key: "images", table: "species_images", column: "group_id", url: "image_url" },
  {
    key: "externalReferences",
    table: "species_external_references",
    column: "group_id",
    url: "reference_url",
  },
] as const;

/**
 * Records of past syncs and IUCN suggestions about one Species' names. They
 * describe the loser, not the winner, so merge and delete both remove them.
 */
const syncRecords = [
  { table: "external_data_sync_log", column: "group_id" },
  { table: "iucn_sync_log", column: "group_id" },
  { table: "iucn_canonical_recommendations", column: "group_id" },
] as const;

export type SpeciesReferences = Record<
  (typeof memberRecords)[number]["key"] | (typeof enrichment)[number]["key"],
  number
>;

/** How many rows elsewhere belong to this Species, by kind. */
export async function countReferencesOfSpecies(speciesId: number): Promise<SpeciesReferences> {
  const tables = [...memberRecords, ...enrichment];
  const [row] = await query<SpeciesReferences>(
    `SELECT ${tables
      .map((t) => `(SELECT COUNT(*) FROM ${t.table} WHERE ${t.column} = ?) AS ${t.key}`)
      .join(", ")}`,
    tables.map(() => speciesId)
  );
  return row;
}

export type MemberKeepingBoth = { memberId: number; displayName: string };

/** Members with a current collection entry for both Species. */
export async function findMembersKeepingBoth(
  winnerId: number,
  loserId: number
): Promise<MemberKeepingBoth[]> {
  return query<MemberKeepingBoth>(
    `SELECT DISTINCT m.id AS memberId, m.display_name AS displayName
     FROM species_collection w
     JOIN species_collection l ON l.member_id = w.member_id
     JOIN members m ON m.id = w.member_id
     WHERE w.group_id = ? AND l.group_id = ?
       AND w.removed_date IS NULL AND l.removed_date IS NULL
     ORDER BY m.display_name`,
    [winnerId, loserId]
  );
}

type CaresRegistration = {
  registered: string | null;
  confirmed: string | null;
  photoKey: string | null;
  photoUrl: string | null;
};

/**
 * A member keeps one current collection entry per Species. Where a member
 * keeps both, the winner's entry stays current and the loser's is marked
 * removed today, keeping its notes and photos as history. The kept entry
 * carries the member's CARES standing: the earlier registration (with its
 * photo) and the later confirmation of the two.
 */
async function retireDuplicateEntries(db: Database, winnerId: number, loserId: number) {
  const pairs = await db.all<
    Array<{ kept: number; retired: number } & { [K in `${"w" | "l"}_${keyof CaresRegistration}`]: string | null }>
  >(
    `SELECT w.id AS kept, l.id AS retired,
       w.cares_registered_at AS w_registered, w.cares_last_confirmed AS w_confirmed,
       w.cares_photo_key AS w_photoKey, w.cares_photo_url AS w_photoUrl,
       l.cares_registered_at AS l_registered, l.cares_last_confirmed AS l_confirmed,
       l.cares_photo_key AS l_photoKey, l.cares_photo_url AS l_photoUrl
     FROM species_collection w
     JOIN species_collection l ON l.member_id = w.member_id
     WHERE w.group_id = ? AND l.group_id = ?
       AND w.removed_date IS NULL AND l.removed_date IS NULL`,
    [winnerId, loserId]
  );
  for (const p of pairs) {
    const loserEarlier =
      p.l_registered !== null && (p.w_registered === null || p.l_registered < p.w_registered);
    const from = loserEarlier ? "l" : "w";
    const confirmed = [p.w_confirmed, p.l_confirmed].filter((d) => d !== null).sort().pop() ?? null;
    await db.run(
      `UPDATE species_collection
       SET cares_registered_at = ?, cares_photo_key = ?, cares_photo_url = ?,
           cares_last_confirmed = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [p[`${from}_registered`], p[`${from}_photoKey`], p[`${from}_photoUrl`], confirmed, p.kept]
    );
    await db.run(
      `UPDATE species_collection SET removed_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [p.retired]
    );
  }
}

/** In merge's transaction: every row of the loser's moves to the winner or goes. */
export async function moveReferences(db: Database, winnerId: number, loserId: number) {
  await retireDuplicateEntries(db, winnerId, loserId);
  for (const t of memberRecords) {
    await db.run(`UPDATE ${t.table} SET ${t.column} = ? WHERE ${t.column} = ?`, [winnerId, loserId]);
  }
  for (const t of enrichment) {
    const c = t.column;
    await db.run(
      `DELETE FROM ${t.table} WHERE ${c} = ? AND ${t.url} IN (SELECT ${t.url} FROM ${t.table} WHERE ${c} = ?)`,
      [loserId, winnerId]
    );
    await db.run(
      `UPDATE ${t.table}
       SET ${c} = ?,
           display_order = display_order + (SELECT COALESCE(MAX(display_order) + 1, 0) FROM ${t.table} WHERE ${c} = ?)
       WHERE ${c} = ?`,
      [winnerId, winnerId, loserId]
    );
  }
  await deleteSyncRecords(db, loserId);
}

/** In delete's transaction: the Species' gallery, links and sync records go with it. */
export async function deleteEnrichmentAndSyncRecords(db: Database, speciesId: number) {
  for (const t of enrichment) {
    await db.run(`DELETE FROM ${t.table} WHERE ${t.column} = ?`, [speciesId]);
  }
  await deleteSyncRecords(db, speciesId);
}

async function deleteSyncRecords(db: Database, speciesId: number) {
  for (const t of syncRecords) {
    await db.run(`DELETE FROM ${t.table} WHERE ${t.column} = ?`, [speciesId]);
  }
}

/** Every table, other than the catalogue's own, that holds a Species id. */
export const speciesReferenceTables: string[] = [
  ...memberRecords.map((t) => t.table),
  ...enrichment.map((t) => t.table),
  ...syncRecords.map((t) => t.table),
];
