import { Response } from "express";
import { MulmRequest } from "@/sessions";
import { writeConn } from "@/db/conn";
import { getExternalDataSyncStats, getAllSyncLog } from "@/db/external-data-sync";
import { startExternalDataSync, getExternalDataSyncState } from "@/services/externalDataSync";

// Bound a manually-triggered run so an admin can watch it finish in a few minutes.
const MANUAL_SYNC_LIMIT = 25;

async function panelData() {
  const [stats, recentLog] = await Promise.all([
    getExternalDataSyncStats(writeConn),
    getAllSyncLog(writeConn, undefined, undefined, 15),
  ]);
  return { state: getExternalDataSyncState(), stats, recentLog };
}

/** Full page: GET /admin/external-data */
export const externalDataPage = async (_req: MulmRequest, res: Response) => {
  res.render("admin/externalData", { title: "External Data Sync", ...(await panelData()) });
};

/** Status partial for HTMX polling: GET /admin/external-data/status */
export const externalDataStatus = async (_req: MulmRequest, res: Response) => {
  res.render("admin/externalDataStatus", await panelData());
};

/** Fire-and-forget trigger: POST /admin/external-data/sync */
export const triggerExternalDataSync = async (_req: MulmRequest, res: Response) => {
  startExternalDataSync({ limit: MANUAL_SYNC_LIMIT });
  res.render("admin/externalDataStatus", await panelData());
};
