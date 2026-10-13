// Playwright now owns database creation, seeding and teardown.
console.error("Run npm run test:e2e; standalone E2E database setup is no longer needed.");
process.exitCode = 1;
