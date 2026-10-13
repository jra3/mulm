import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** The run owns the parent; workers own independent databases and listeners. */
export default async function globalSetup() {
  const directory = await mkdtemp(join(tmpdir(), "mulm-e2e-"));
  process.env.MULM_E2E_RUN = randomUUID();
  process.env.MULM_E2E_DIRECTORY = directory;
  process.env.NODE_ENV = "test";
  await writeFile(join(directory, "owner"), process.env.MULM_E2E_RUN);
  return async () => rm(directory, { recursive: true, force: true });
}
