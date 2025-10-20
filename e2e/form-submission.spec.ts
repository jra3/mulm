import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers/auth";
import { TEST_USER, cleanupTestUserSubmissions, getSubmissionsForMember, getTestDatabase } from "./helpers/testData";

test.describe("Form Submission Flow", () => {
	// Clean up before each test
	test.beforeEach(async () => {
		await cleanupTestUserSubmissions(TEST_USER.email);
	});

	test("should create and save a draft submission", async ({ page }) => {
		// Login
		await login(page);

		// Navigate to new submission form
		await page.goto("/submissions/new");

		// Wait for form to load
		await page.waitForSelector("#bapForm");

		// Fill in basic fields
		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");

		// Wait for form to reload (HTMX swap after species type change)
		await page.waitForSelector('select[name="species_class"]');

		// Select species class
		await page.selectOption('select[name="species_class"]', "Livebearers");

		// Fill in reproduction date
		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		// Fill in species common name (freeform text for now)
		// We'll test the typeahead linking separately
		await page.fill('input[name="species_common_name"]', "Guppy");
		await page.fill('input[name="species_latin_name"]', "Poecilia reticulata");

		// Fill in tank details
		await page.fill('input[name="temperature"]', "75");
		await page.fill('input[name="ph"]', "7.2");
		await page.fill('input[name="gh"]', "150");

		// Fill in fry count (for fish)
		await page.fill('input[name="count"]', "25");

		// Save as draft
		await page.click('button[name="draft"]');

		// Wait for success (form should reload or redirect)
		await page.waitForLoadState("networkidle");

		// Verify the submission was created in the database
		const db = await getTestDatabase();
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			expect(user).toBeTruthy();

			const submissions = await db.all(
				"SELECT * FROM submissions WHERE member_id = ? AND submitted_on IS NULL",
				user!.id
			);

			expect(submissions.length).toBeGreaterThan(0);
			expect(submissions[0].species_common_name).toBe("Guppy");
			expect(submissions[0].species_latin_name).toBe("Poecilia reticulata");
			expect(submissions[0].temperature).toBe("75");
		} finally {
			await db.close();
		}
	});

	test("should submit a complete form for review", async ({ page }) => {
		// Login
		await login(page);

		// Navigate to new submission form
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		// Fill in all required fields
		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");

		// Wait for HTMX swap
		await page.waitForSelector('select[name="species_class"]');

		await page.selectOption('select[name="species_class"]', "Livebearers");

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		await page.fill('input[name="species_common_name"]', "Fancy Guppy");
		await page.fill('input[name="species_latin_name"]', "Poecilia reticulata");

		// Tank details
		await page.fill('input[name="temperature"]', "76");
		await page.fill('input[name="ph"]', "7.4");
		await page.fill('input[name="gh"]', "180");

		// Fry count
		await page.fill('input[name="count"]', "30");

		// Submit (not draft)
		await page.click('button[type="submit"]:has-text("Submit")');

		// Wait for submission to complete
		await page.waitForLoadState("networkidle");

		// Verify submission in database
		const db = await getTestDatabase();
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			expect(user).toBeTruthy();

			const submissions = await db.all(
				"SELECT * FROM submissions WHERE member_id = ? AND submitted_on IS NOT NULL",
				user!.id
			);

			expect(submissions.length).toBeGreaterThan(0);
			const submission = submissions[0];

			// Verify submitted_on is set
			expect(submission.submitted_on).toBeTruthy();

			// Verify witness status is pending
			expect(submission.witness_verification_status).toBe("pending");

			// Verify data is correct
			expect(submission.species_common_name).toBe("Fancy Guppy");
			expect(submission.temperature).toBe("76");
		} finally {
			await db.close();
		}
	});

	test("should allow editing a draft submission", async ({ page }) => {
		// Login
		await login(page);

		// Create a draft first
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");
		await page.waitForSelector('select[name="species_class"]');

		await page.selectOption('select[name="species_class"]', "Livebearers");

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);
		await page.fill('input[name="species_common_name"]', "Original Guppy");
		await page.fill('input[name="species_latin_name"]', "Poecilia reticulata");
		await page.fill('input[name="temperature"]', "74");
		await page.fill('input[name="ph"]', "7.0");
		await page.fill('input[name="gh"]', "150");
		await page.fill('input[name="count"]', "20");

		// Save draft
		await page.click('button[name="draft"]');
		await page.waitForLoadState("networkidle");

		// Get the submission ID from the URL or page
		const url = page.url();
		const submissionIdMatch = url.match(/submissions\/(\d+)/);
		expect(submissionIdMatch).toBeTruthy();
		const submissionId = submissionIdMatch![1];

		// Edit the draft
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		// Change some fields
		await page.fill('input[name="species_common_name"]', "Updated Guppy");
		await page.fill('input[name="temperature"]', "78");

		// Save edits
		await page.click('button[type="submit"]:has-text("Save Edits")');
		await page.waitForLoadState("networkidle");

		// Verify changes in database
		const db = await getTestDatabase();
		try {
			const submission = await db.get(
				"SELECT * FROM submissions WHERE id = ?",
				parseInt(submissionId)
			);

			expect(submission.species_common_name).toBe("Updated Guppy");
			expect(submission.temperature).toBe("78");
			// Should still be a draft
			expect(submission.submitted_on).toBeNull();
		} finally {
			await db.close();
		}
	});

	test("should delete a draft submission", async ({ page }) => {
		// Login
		await login(page);

		// Create a draft
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");
		await page.waitForSelector('select[name="species_class"]');

		await page.selectOption('select[name="species_class"]', "Livebearers");

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);
		await page.fill('input[name="species_common_name"]', "To Delete");
		await page.fill('input[name="species_latin_name"]', "Deletis fishus");
		await page.fill('input[name="temperature"]', "75");
		await page.fill('input[name="ph"]', "7.0");
		await page.fill('input[name="gh"]', "150");
		await page.fill('input[name="count"]', "10");

		// Save draft
		await page.click('button[name="draft"]');
		await page.waitForLoadState("networkidle");

		// Get submission ID
		const url = page.url();
		const submissionIdMatch = url.match(/submissions\/(\d+)/);
		expect(submissionIdMatch).toBeTruthy();
		const submissionId = parseInt(submissionIdMatch![1]);

		// Listen for confirm dialog and accept it
		page.on("dialog", (dialog) => dialog.accept());

		// Delete the draft
		await page.click('button:has-text("Delete Draft")');

		// Wait for redirect
		await page.waitForLoadState("networkidle");

		// Verify deletion in database
		const db = await getTestDatabase();
		try {
			const submission = await db.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission).toBeUndefined();
		} finally {
			await db.close();
		}
	});
});
