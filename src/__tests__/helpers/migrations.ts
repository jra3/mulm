import fs from "fs";
import os from "os";
import path from "path";

export const allMigrations = "./db/migrations";

/**
 * A directory holding the migrations up to and including `lastId`, linked to
 * the real files, so the migrator (and its own parsing) runs them exactly as
 * it runs the rest. Migrating a newer database with it rolls the later ones
 * back. Remove it with `fs.rmSync(dir, { recursive: true, force: true })`.
 */
export function migrationsUpTo(lastId: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mulm-migrations-"));
  for (const file of fs.readdirSync(allMigrations)) {
    const id = Number(/^(\d+)/.exec(file)?.[1]);
    if (file.endsWith(".sql") && id <= lastId) {
      fs.symlinkSync(path.resolve(allMigrations, file), path.join(dir, file));
    }
  }
  return dir;
}
