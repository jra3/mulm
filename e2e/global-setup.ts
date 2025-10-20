import { ensureTestUserExists, TEST_USER } from "./helpers/testData";

/**
 * Global setup runs once before all tests
 * Creates necessary test data in the database
 */
async function globalSetup() {
	console.log("Running global setup for E2E tests...");

	// Ensure test user exists
	await ensureTestUserExists(TEST_USER.email, TEST_USER.password, TEST_USER.displayName || "E2E Test User");

	console.log("Global setup complete ✓");
}

export default globalSetup;
