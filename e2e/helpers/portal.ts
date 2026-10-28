import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { bootstrap } from "../../src/bootstrap";
import { db, ensureReady, closeConnections } from "../../src/db/conn";
import { configureE2EDatabase } from "./database";
import { seedTestSpecies } from "./referenceSpecies";

/** A worker never shares mutable SQLite state or a listener with another worker. */
export async function startWorkerPortal() {
  const parent = process.env.MULM_E2E_DIRECTORY;
  const token = process.env.MULM_E2E_RUN;
  if (!parent || !token || (await readFile(join(parent, "owner"), "utf8")) !== token) {
    throw new Error("Missing Playwright-owned run directory");
  }
  const directory = await mkdtemp(join(parent, "worker-"));
  process.env.MULM_E2E_DATABASE = join(directory, "database.db");
  await writeFile(join(directory, "owner"), token);
  configureE2EDatabase();
  const inert = { start() {}, stop() {} };
  try {
    const running = await bootstrap({
      port: 0,
      host: "127.0.0.1",
      effects: {
        database: {
          async start() {
            await ensureReady();
            await seedTestSpecies(db(true));
          },
          stop: closeConnections,
        },
        storage: inert,
        jobs: [],
      },
    });
    const address = running.server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP E2E listener");
    return {
      baseURL: `http://127.0.0.1:${address.port}`,
      async stop() {
        try {
          await running.stop();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
