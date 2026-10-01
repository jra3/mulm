// Seeds the staging test logins. Runs inside the staging container, where
// scripts/staging.sh calls it:  cd /app && node src/staging/seed.js
// Prints the credentials as one JSON line on stdout (the only line starting
// with "{"); everything else it logs is diagnostics.
import "./requireStaging";
import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, ".."));

import { ready, readOnlyConn, writeConn } from "../db/conn";
import { seedStagingUsers } from "./seedUsers";

async function main() {
  await ready;
  const credentials = await seedStagingUsers(process.env);
  console.log(JSON.stringify(credentials));
  await readOnlyConn.close();
  await writeConn.close();
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("Seed failed:", error);
    process.exit(1);
  }
);
