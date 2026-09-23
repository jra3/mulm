/**
 * Columns on the Species row whose meaning belongs to other modules: the IUCN
 * Red List status and the date of the last external-data sync. Those modules
 * decide what to write; the catalogue writes it, so it stays the only writer
 * of the species tables.
 */
import { writeConn } from "@/db/conn";
import type { IUCNCategory, PopulationTrend } from "@/integrations/iucn";
import { logger } from "@/utils/logger";
import { CatalogueRefusal, speciesNotFound } from "./errors";

export type IucnStatus = {
  category: IUCNCategory;
  taxonId?: number;
  populationTrend?: PopulationTrend;
  url?: string;
};

/**
 * Record a Species' IUCN status, stamped now. Fields left undefined keep
 * their current value.
 * @throws CatalogueRefusal if the Species is missing or a value is not an
 *   IUCN category or population trend
 */
export async function updateIucnStatus(speciesId: number, status: IucnStatus): Promise<void> {
  const fields = ["iucn_redlist_category = ?", "iucn_last_updated = ?"];
  const values: unknown[] = [status.category, new Date().toISOString()];
  if (status.taxonId !== undefined) {
    fields.push("iucn_redlist_id = ?");
    values.push(status.taxonId);
  }
  if (status.populationTrend !== undefined) {
    fields.push("iucn_population_trend = ?");
    values.push(status.populationTrend);
  }
  if (status.url !== undefined) {
    fields.push("iucn_redlist_url = ?");
    values.push(status.url);
  }

  let changes = 0;
  try {
    const stmt = await writeConn.prepare(
      `UPDATE species_name_group SET ${fields.join(", ")} WHERE group_id = ?`
    );
    try {
      changes = (await stmt.run(...values, speciesId)).changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("CHECK constraint")) {
      throw new CatalogueRefusal("Invalid IUCN category or population trend", "invalid");
    }
    logger.error(`Failed to update IUCN status of Species ${speciesId}`, err);
    throw new Error("Failed to update IUCN status");
  }
  if (changes === 0) throw speciesNotFound(speciesId);
}

/** Record that a Species' external data (links, images) was last synced at `when`. */
export async function updateLastExternalSync(speciesId: number, when: Date): Promise<void> {
  let changes = 0;
  try {
    const stmt = await writeConn.prepare(
      "UPDATE species_name_group SET last_external_sync = ? WHERE group_id = ?"
    );
    try {
      changes = (await stmt.run(when.toISOString(), speciesId)).changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error(`Failed to record external sync of Species ${speciesId}`, err);
    throw new Error("Failed to record external sync");
  }
  if (changes === 0) throw speciesNotFound(speciesId);
}
