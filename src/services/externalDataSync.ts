import { writeConn } from "@/db/conn";
import { logger } from "@/utils/logger";
import {
  getSpeciesNeedingExternalSync,
  recordExternalDataSync,
} from "@/db/external-data-sync";
import {
  getSpeciesExternalReferences,
  setSpeciesExternalReferences,
  getSpeciesImages,
  setSpeciesImages,
} from "@/db/species";
import { getWikipediaClient } from "@/integrations/wikipedia";
import { getGBIFClient } from "@/integrations/gbif";

/**
 * Production-runnable external-data sync, extracted from the standalone
 * scripts/sync-*-all-species.ts so it can run inside the app (the prod image
 * has no ts-node and doesn't ship scripts/).
 *
 * v1 scope: Wikipedia + GBIF reference links and (external) image URLs, over
 * species whose data is stale (>90 days) or never synced. FishBase (DuckDB +
 * parquet) and R2 image download/transcode are intentionally deferred — see
 * the per-source scripts for those, which remain available for CLI backfill.
 */

// Only the method we call, so tests can inject fakes without real HTTP.
interface SourceClient<T> {
  getExternalData(genus: string, species: string): Promise<T | null>;
}
interface WikipediaData {
  wikidataUrl: string;
  wikipediaUrls: Record<string, string>;
  imageUrls: string[];
}
interface GBIFData {
  gbifUrl: string;
  occurrenceMapUrl: string;
  imageUrls: string[];
}
export interface EnrichmentClients {
  wikipedia: SourceClient<WikipediaData>;
  gbif: SourceClient<GBIFData>;
}

export interface SyncOptions {
  /** Max species processed per run (bounds a manual run). Default 50. */
  limit?: number;
  /** Staleness threshold in days. Default 90. */
  daysOld?: number;
  /** Also store external image URLs (no R2 download in v1). Default true. */
  withImages?: boolean;
}

export interface SyncSummary {
  processed: number;
  linksAdded: number;
  imagesAdded: number;
  notFound: number;
  errors: number;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_DAYS_OLD = 90;
const WIKIPEDIA_DELAY_MS = 150;
const GBIF_DELAY_MS = 120;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const defaultClients = (): EnrichmentClients => ({
  wikipedia: getWikipediaClient(),
  gbif: getGBIFClient(),
});

/** Add only URLs not already present (the set* helpers replace, so we merge). */
async function addReferences(groupId: number, urls: string[]): Promise<number> {
  const candidates = urls.filter((u) => u && u.length > 0);
  if (candidates.length === 0) return 0;
  const existing = await getSpeciesExternalReferences(groupId);
  const existingUrls = existing.map((r) => r.reference_url);
  const existingSet = new Set(existingUrls);
  const toAdd = candidates.filter((u) => !existingSet.has(u));
  if (toAdd.length === 0) return 0;
  await setSpeciesExternalReferences(groupId, [...existingUrls, ...toAdd]);
  return toAdd.length;
}

async function addImages(groupId: number, urls: string[]): Promise<number> {
  const candidates = urls.filter((u) => u && u.length > 0);
  if (candidates.length === 0) return 0;
  const existing = await getSpeciesImages(groupId);
  const existingUrls = existing.map((i) => i.image_url);
  const existingSet = new Set(existingUrls);
  const toAdd = candidates.filter((u) => !existingSet.has(u));
  if (toAdd.length === 0) return 0;
  await setSpeciesImages(groupId, [...existingUrls, ...toAdd]);
  return toAdd.length;
}

/**
 * Run one sync pass. Returns a summary. Safe to call directly (tests inject
 * fake clients) or via startExternalDataSync() for fire-and-forget.
 */
export async function runExternalDataSync(
  options: SyncOptions = {},
  clients: EnrichmentClients = defaultClients()
): Promise<SyncSummary> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const daysOld = options.daysOld ?? DEFAULT_DAYS_OLD;
  const withImages = options.withImages ?? true;

  const summary: SyncSummary = {
    processed: 0,
    linksAdded: 0,
    imagesAdded: 0,
    notFound: 0,
    errors: 0,
  };

  const candidates = (await getSpeciesNeedingExternalSync(writeConn, daysOld)).slice(0, limit);
  logger.info(`External data sync starting: ${candidates.length} species (limit ${limit})`);

  for (const sp of candidates) {
    const groupId = sp.group_id;
    const genus = sp.canonical_genus;
    const species = sp.canonical_species_name;
    summary.processed++;

    // --- Wikipedia / Wikidata ---
    try {
      const wiki = await clients.wikipedia.getExternalData(genus, species);
      if (wiki) {
        const links = await addReferences(groupId, [
          wiki.wikidataUrl,
          ...Object.values(wiki.wikipediaUrls),
        ]);
        const images = withImages ? await addImages(groupId, wiki.imageUrls) : 0;
        summary.linksAdded += links;
        summary.imagesAdded += images;
        await recordExternalDataSync(writeConn, groupId, "wikipedia", "success", links, images);
      } else {
        summary.notFound++;
        await recordExternalDataSync(writeConn, groupId, "wikipedia", "not_found");
      }
    } catch (err) {
      summary.errors++;
      logger.warn("Wikipedia sync failed", { groupId, error: errMessage(err) });
      await recordExternalDataSync(writeConn, groupId, "wikipedia", "error", 0, 0, errMessage(err));
    }
    await sleep(WIKIPEDIA_DELAY_MS);

    // --- GBIF ---
    try {
      const gbif = await clients.gbif.getExternalData(genus, species);
      if (gbif) {
        const links = await addReferences(groupId, [gbif.gbifUrl, gbif.occurrenceMapUrl]);
        const images = withImages ? await addImages(groupId, gbif.imageUrls) : 0;
        summary.linksAdded += links;
        summary.imagesAdded += images;
        await recordExternalDataSync(writeConn, groupId, "gbif", "success", links, images);
      } else {
        summary.notFound++;
        await recordExternalDataSync(writeConn, groupId, "gbif", "not_found");
      }
    } catch (err) {
      summary.errors++;
      logger.warn("GBIF sync failed", { groupId, error: errMessage(err) });
      await recordExternalDataSync(writeConn, groupId, "gbif", "error", 0, 0, errMessage(err));
    }
    await sleep(GBIF_DELAY_MS);
  }

  logger.info("External data sync complete", { ...summary });
  return summary;
}

// --- Fire-and-forget background runner (for the admin "Sync now" button) ---

export interface SyncState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastSummary: SyncSummary | null;
  lastError: string | null;
}

let state: SyncState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastSummary: null,
  lastError: null,
};

export function getExternalDataSyncState(): SyncState {
  return { ...state };
}

/**
 * Start a sync in the background and return immediately. Returns false if a
 * sync is already running (single-flight). A run can take many minutes, so the
 * caller must not await it — poll getExternalDataSyncState() instead.
 */
export function startExternalDataSync(options: SyncOptions = {}): boolean {
  if (state.running) return false;

  state = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastSummary: null,
    lastError: null,
  };

  void (async () => {
    try {
      const summary = await runExternalDataSync(options);
      state = { ...state, running: false, finishedAt: new Date().toISOString(), lastSummary: summary };
    } catch (err) {
      logger.error("Background external data sync failed", err);
      state = { ...state, running: false, finishedAt: new Date().toISOString(), lastError: errMessage(err) };
    }
  })();

  return true;
}
