// Imported first by seed.ts: importing the DB module opens the database and
// runs migrations, so a non-staging machine must stop before that happens.
if (process.env.STAGING !== "1") {
  console.error("Refusing to seed: STAGING is not 1, so this is not staging");
  process.exit(3);
}
