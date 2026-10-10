import { isStaging } from "../utils/environment";

// Imported first by seed.ts: importing the DB module opens the database and
// runs migrations, so a non-staging machine must stop before that happens.
// environment.ts has no imports of its own, so nothing else is loaded yet,
// hence console rather than logger.
if (!isStaging()) {
  console.error("Refusing to seed: STAGING is not 1, so this is not staging");
  process.exit(3);
}
