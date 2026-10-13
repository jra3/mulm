import { test, expect, type Page } from "./fixtures";
import { login, logout } from "./helpers/auth";
import { TEST_USER as MEMBER, TEST_ADMIN, cleanupTestUserSubmissions, getTestDatabase, ensureTestUserExists } from "./helpers/testData";
import { createTestSubmission } from "./helpers/submissions";
import { fillTomSelectTypeahead } from "./helpers/tomSelect";

/**
 * Points are set at the Witness; approval records presentation (ADR-0003,
 * spec #520). The witness panel settles the Species and sets every bonus but
 * first-time; the member sees those points as pending; the approval queue
 * approves with two taps and computes first-time; a correction changes the
 * Species and points together, with a reason.
 *
 * Each test receives its own member and committee accounts from the fixture.
 */

test.describe.configure({ mode: "serial" });

/** Letters only: a scientific name is Genus species, no digits. */
function uniqueEpithet(): string {
	return Date.now()
		.toString()
		.split("")
		.map((digit) => "abcdefghij"[Number(digit)])
		.join("");
}

/**
 * A Species no one has had approved, so the first-time bonus is still to
 * win. The e2e seed's Species are shared with the other specs, which approve
 * some of them.
 */
async function createFreshSpecies(pointClass: number | null): Promise<{ id: number; latin: string; common: string }> {
	const epithet = uniqueEpithet();
	const latin = `Poecilia ${epithet}`;
	const common = `Witness Molly ${epithet}`;
	const db = await getTestDatabase();
	try {
		const result = await db.run(
			`INSERT INTO species_name_group (canonical_genus, canonical_species_name, program_class, species_type, base_points)
			 VALUES ('Poecilia', ?, 'Livebearers', 'Fish', ?)`,
			epithet,
			pointClass
		);
		const id = result.lastID as number;
		await db.run(`INSERT INTO species_scientific_name (group_id, scientific_name, is_canonical) VALUES (?, ?, 1)`, id, latin);
		await db.run(`INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)`, id, common);
		return { id, latin, common };
	} finally {
		await db.close();
	}
}

async function memberIds(): Promise<{ memberId: number; adminId: number }> {
	const db = await getTestDatabase();
	try {
		const member = await db.get<{ id: number }>("SELECT id FROM members WHERE contact_email = ?", MEMBER.email);
		const admin = await db.get<{ id: number }>("SELECT id FROM members WHERE contact_email = ?", TEST_ADMIN.email);
		if (!member || !admin) throw new Error("Test users not found in database");
		return { memberId: member.id, adminId: admin.id };
	} finally {
		await db.close();
	}
}

async function readSubmission(id: number) {
	const db = await getTestDatabase();
	try {
		return await db.get("SELECT * FROM submissions WHERE id = ?", id);
	} finally {
		await db.close();
	}
}

/** A ready row, witnessed past its waiting period at 10 points. */
async function readyRow(memberId: number, adminId: number, latin: string, common: string): Promise<number> {
	return createTestSubmission({
		memberId,
		submitted: true,
		witnessed: true,
		witnessedBy: adminId,
		witnessedDaysAgo: 70,
		bound: true,
		speciesLatinName: latin,
		speciesCommonName: common,
	});
}

/** Open a queue row, tap Approve to arm it, tap again to post. */
async function armAndConfirm(page: Page, submissionId: number): Promise<void> {
	await page.locator(`#queue-row-${submissionId} summary`).click();
	const arm = page.locator(`#queue-approve-${submissionId}`);
	await arm.scrollIntoViewIfNeeded();
	await arm.click();
	await page.locator(`#queue-confirm-${submissionId}`).click();
}

async function confirmWitness(page: Page, label: string): Promise<void> {
	const confirm = page.locator("#witness-confirm");
	await expect(confirm).toBeEnabled({ timeout: 10000 });
	await expect(confirm).toHaveText(label);
	await confirm.scrollIntoViewIfNeeded();
	await confirm.click();
	await page.waitForURL(/\/admin\/witness-queue\//, { timeout: 10000 });
}

test.describe("Points are set at the Witness", () => {
	test.beforeEach(async () => {
		await ensureTestUserExists(MEMBER.email, MEMBER.password, MEMBER.displayName, false);
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);
		await cleanupTestUserSubmissions(MEMBER.email);
	});

	test("the witness sets the base points and bonuses, and only the member sees them pending", async ({ page }) => {
		const { memberId } = await memberIds();
		const species = await createFreshSpecies(10);
		const submissionId = await createTestSubmission({
			memberId,
			submitted: true,
			witnessed: false,
			bound: true,
			speciesLatinName: species.latin,
			speciesCommonName: species.common,
		});

		await login(page, TEST_ADMIN);
		await page.goto(`/submissions/${submissionId}`);

		// The member picked the Species; the witness answers whether it is right
		await expect(page.locator("#witness-species")).toContainText("The member says it's");
		await expect(page.locator("#witness-bound-species")).toHaveText(species.latin);
		await expect(page.locator("#witness-confirm")).toBeDisabled();

		await page.locator("label:has(#witness-species-yes)").click();
		// Prefilled from the Species' Point class
		await expect(page.locator("#witness-points-10")).toBeChecked();
		await expect(page.locator("#witness-first-time")).toContainText("No one has had this species approved yet");
		await expect(page.locator("#witness-confirm")).toHaveText("Confirm witness · 10 pts");

		await page.locator("label:has(#witness-points-15)").click();
		await expect(page.locator("#witness-confirm")).toHaveText("Confirm witness · 15 pts");
		await page.locator('label:has(input[name="cares_species"])').click();
		await expect(page.locator("#witness-confirm")).toHaveText("Confirm witness · 20 pts");
		await page.locator("label:has(#witness-article-5)").click();
		await expect(page.locator("#witness-sum-total")).toHaveText("25 pts");

		await confirmWitness(page, "Confirm witness · 25 pts");

		const witnessed = await readSubmission(submissionId);
		expect(witnessed.witness_verification_status).toBe("confirmed");
		expect(witnessed.species_id).toBe(species.id);
		expect(witnessed.points).toBe(15);
		expect(witnessed.cares_species).toBe(1);
		expect(witnessed.article_points).toBe(5);
		// First-time is approval's to decide
		expect(witnessed.first_time_species).toBeNull();
		expect(witnessed.approved_on).toBeNull();

		// The member sees the points pending, on the Submission and their own list
		await logout(page);
		await login(page, MEMBER);
		await page.goto(`/submissions/${submissionId}`);
		await expect(page.locator("#pending-points-total")).toHaveText("25 pts");
		await expect(page.locator("#pending-points")).toContainText("pending approval");
		await page.goto(`/member/${memberId}`);
		await expect(page.locator(".pending-points-total")).toHaveText("25 pts");

		// Nobody else does: pending points are not awarded points
		await logout(page);
		await login(page, TEST_ADMIN);
		await page.goto(`/submissions/${submissionId}`);
		await expect(page.locator("#pending-points")).toHaveCount(0);
		await page.goto(`/member/${memberId}`);
		await expect(page.locator(".pending-points-total")).toHaveCount(0);
	});

	test("the witness records an unlisted Species, which joins the catalogue with its Point class", async ({ page }) => {
		const { memberId, adminId } = await memberIds();
		const epithet = uniqueEpithet();
		const latin = `Xenotoca ${epithet}`;
		const common = `Unlisted Goodeid ${epithet}`;
		const submissionId = await createTestSubmission({
			memberId,
			submitted: true,
			witnessed: false,
			speciesLatinName: latin,
			speciesCommonName: common,
			speciesClass: "Livebearers",
		});

		await login(page, TEST_ADMIN);
		await page.goto(`/submissions/${submissionId}`);
		await expect(page.locator("#witness-species")).toContainText("The member wrote");
		await expect(page.locator("#witness-confirm")).toBeDisabled();

		await page.locator("#witness-species-new").click();
		// Prefilled from the member's spelling
		await expect(page.locator("#witness-new-scientific-name")).toHaveValue(latin);
		await expect(page.locator("#witness-new-common-name")).toHaveValue(common);
		await page.locator("label:has(#witness-new-point-class-15)").click();
		await page.locator("#witness-record-continue").click();

		await expect(page.locator("#witness-recording")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("#witness-bound-species")).toHaveText(latin);
		await expect(page.locator("#witness-points-15")).toBeChecked();

		// Nothing is created until the Witness is confirmed
		const db = await getTestDatabase();
		try {
			const before = await db.get(
				"SELECT group_id FROM species_name_group WHERE canonical_genus = 'Xenotoca' AND canonical_species_name = ?",
				epithet
			);
			expect(before).toBeUndefined();
		} finally {
			await db.close();
		}

		await confirmWitness(page, "Confirm witness · 15 pts");

		const db2 = await getTestDatabase();
		try {
			const created = await db2.get<{ group_id: number; base_points: number }>(
				"SELECT group_id, base_points FROM species_name_group WHERE canonical_genus = 'Xenotoca' AND canonical_species_name = ?",
				epithet
			);
			expect(created).toBeTruthy();
			expect(created!.base_points).toBe(15);

			const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.species_id).toBe(created!.group_id);
			expect(submission.points).toBe(15);
			expect(submission.witnessed_by).toBe(adminId);
		} finally {
			await db2.close();
		}

		// The queue tells the approver the witness recorded it
		await page.goto("/admin/queue");
		await expect(page.locator(`#queue-new-species-${submissionId}`)).toHaveText("New species recorded by the witness");
		await expect(page.locator(`#queue-total-${submissionId}`)).toHaveText("20");
	});

	test("after Back from Record new species, the catalogue search still works", async ({ page }) => {
		const { memberId } = await memberIds();
		const submissionId = await createTestSubmission({
			memberId,
			submitted: true,
			witnessed: false,
			speciesLatinName: `Xenotoca ${uniqueEpithet()}`,
			speciesCommonName: "Back Button Goodeid",
		});

		await login(page, TEST_ADMIN);
		await page.goto(`/submissions/${submissionId}`);
		await page.locator("#witness-species-new").click();
		await expect(page.locator("#witness-record")).toBeVisible();
		await page.locator('#witness-record button:has-text("Back")').click();
		await expect(page.locator("#witness-record")).toHaveCount(0);

		// Back swaps the panel in afresh; its search must be a typeahead again
		await fillTomSelectTypeahead(page, "group_id", "Xiphophorus hellerii", false, false);
		await page.locator("#witness-species-use").click();
		await expect(page.locator("#witness-bound-species")).toHaveText("Xiphophorus hellerii", { timeout: 10000 });
	});

	test("answering No to the member's Species lets the witness choose another", async ({ page }) => {
		const { memberId } = await memberIds();
		const submissionId = await createTestSubmission({
			memberId,
			submitted: true,
			witnessed: false,
			bound: true,
		});

		await login(page, TEST_ADMIN);
		await page.goto(`/submissions/${submissionId}`);
		await expect(page.locator("#witness-bound-species")).toHaveText("Poecilia reticulata");
		await expect(page.locator("#witness-species-other")).toBeHidden();

		await page.locator("label:has(#witness-species-no)").click();
		await expect(page.locator("#witness-species-other")).toBeVisible();
		await fillTomSelectTypeahead(page, "group_id", "Xiphophorus hellerii", false, false);
		await page.locator("#witness-species-use").click();

		// Choosing reloads the panel with the witness's choice, no question left
		await expect(page.locator("#witness-chooser")).toHaveText("You chose", { timeout: 10000 });
		await expect(page.locator("#witness-bound-species")).toHaveText("Xiphophorus hellerii");
		await expect(page.locator("#witness-member-wrote")).toContainText("Poecilia reticulata");
		await expect(page.locator("#witness-species-yes")).toHaveCount(0);

		await page.locator("label:has(#witness-points-10)").click();
		await confirmWitness(page, "Confirm witness · 10 pts");

		const db = await getTestDatabase();
		try {
			const swordtail = await db.get<{ group_id: number }>(
				"SELECT group_id FROM species_name_group WHERE canonical_genus = 'Xiphophorus' AND canonical_species_name = 'hellerii'"
			);
			const submission = await db.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.species_id).toBe(swordtail!.group_id);
			expect(submission.points).toBe(10);
		} finally {
			await db.close();
		}
	});
});

test.describe("The approval queue at the meeting", () => {
	test.beforeEach(async () => {
		await ensureTestUserExists(MEMBER.email, MEMBER.password, MEMBER.displayName, false);
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);
		await cleanupTestUserSubmissions(MEMBER.email);
	});

	test("lists what is ready, what is still waiting, and your own without a button", async ({ page }) => {
		const { memberId, adminId } = await memberIds();
		const species = await createFreshSpecies(10);
		const ready = await readyRow(memberId, adminId, species.latin, species.common);
		const waiting = await createTestSubmission({
			memberId,
			submitted: true,
			witnessed: true,
			witnessedBy: adminId,
			reproductionDaysAgo: 5,
			bound: true,
			speciesLatinName: species.latin,
			speciesCommonName: species.common,
		});
		// The committee member's own, witnessed by someone else
		const own = await createTestSubmission({
			memberId: adminId,
			submitted: true,
			witnessed: true,
			witnessedBy: memberId,
			witnessedDaysAgo: 70,
			bound: true,
			speciesLatinName: species.latin,
			speciesCommonName: species.common,
		});

		try {
			await login(page, TEST_ADMIN);
			await page.goto("/admin/queue");

			// Ready: 10 base + 5 first-time, the first-time shown apart
			await expect(page.locator(`#queue-total-${ready}`)).toHaveText("15");
			await page.locator(`#queue-row-${ready} summary`).click();
			await expect(page.locator(`#queue-first-time-${ready}`)).toBeVisible();
			await expect(page.locator(`#queue-approve-${ready}`)).toHaveText("Approve · 10 pts + 5 first-time");

			// The first tap arms; Cancel disarms and nothing is written
			await page.locator(`#queue-approve-${ready}`).click();
			await expect(page.locator(`#queue-confirm-${ready}`)).toBeVisible();
			await expect(page.locator(`#queue-confirm-${ready}`)).toContainText("brought it · 15 pts");
			await page.locator(`#queue-cancel-${ready}`).click();
			await expect(page.locator(`#queue-confirm-${ready}`)).toBeHidden();
			await expect(page.locator(`#queue-approve-${ready}`)).toBeVisible();
			expect((await readSubmission(ready)).approved_on).toBeNull();

			// Still waiting: greyed, with its ready date, no button
			await expect(page.locator(`#queue-waiting-${waiting}`)).toContainText("ready ");
			await expect(page.locator(`#queue-row-${waiting}`)).toHaveCount(0);

			// Your own: another committee member approves it
			await page.locator(`#queue-row-${own} summary`).click();
			await expect(page.locator(`#queue-own-${own}`)).toContainText("Another committee member approves it");
			await expect(page.locator(`#queue-approve-${own}`)).toHaveCount(0);
		} finally {
			const db = await getTestDatabase();
			try {
				await db.run("DELETE FROM submissions WHERE id = ?", own);
			} finally {
				await db.close();
			}
		}
	});

	test("first-time goes to the first approved; the second approver is shown the new total", async ({ page, context }) => {
		const { memberId, adminId } = await memberIds();
		const species = await createFreshSpecies(10);
		const first = await readyRow(memberId, adminId, species.latin, species.common);
		const second = await readyRow(memberId, adminId, species.latin, species.common);

		await login(page, TEST_ADMIN);

		// A second committee member's phone, loaded before anything is approved
		const other = await context.newPage();
		await other.goto("/admin/queue");
		await expect(other.locator(`#queue-total-${second}`)).toHaveText("15");

		await page.goto("/admin/queue");
		await armAndConfirm(page, first);
		await expect(page.locator(`#queue-approved-${first}`)).toContainText("15 pts", { timeout: 10000 });

		// The stale row posts 15; the lifecycle refuses and the sheet says why
		await armAndConfirm(other, second);
		await expect(other.locator("#approve-sheet-title")).toHaveText("The points changed", { timeout: 10000 });
		await expect(other.locator("#approve-sheet-why")).toContainText("the first-time +5 has gone");
		await expect(other.locator("#approve-sheet-why")).toContainText("10 pts");
		expect((await readSubmission(second)).approved_on).toBeNull();

		await other.locator("#approve-sheet-approve").click();
		await expect(other.locator(`#queue-approved-${second}`)).toContainText("10 pts", { timeout: 10000 });

		const a = await readSubmission(first);
		const b = await readSubmission(second);
		expect(a.approved_by).toBe(adminId);
		expect(a.first_time_species).toBe(1);
		expect(b.approved_on).toBeTruthy();
		expect(b.first_time_species).toBe(0);

		// Approval puts the award on the activity feed
		const db = await getTestDatabase();
		try {
			const feed = await db.get(
				"SELECT * FROM activity_feed WHERE member_id = ? AND activity_type = 'submission_approved'",
				memberId
			);
			expect(feed).toBeTruthy();
		} finally {
			await db.close();
		}
	});
});

test.describe("Correcting the Species and points", () => {
	test.beforeEach(async () => {
		await ensureTestUserExists(MEMBER.email, MEMBER.password, MEMBER.displayName, false);
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);
		await cleanupTestUserSubmissions(MEMBER.email);
	});

	test("a correction before approval keeps the Witness, and a queue page loaded before it cannot approve the old total", async ({ page, context }) => {
		const { memberId, adminId } = await memberIds();
		const species = await createFreshSpecies(10);
		const submissionId = await readyRow(memberId, adminId, species.latin, species.common);

		await login(page, TEST_ADMIN);

		const stale = await context.newPage();
		await stale.goto("/admin/queue");
		await expect(stale.locator(`#queue-total-${submissionId}`)).toHaveText("15");

		// Reached from the queue row
		await page.goto("/admin/queue");
		await page.locator(`#queue-row-${submissionId} summary`).click();
		await page.locator(`#queue-witnessed-${submissionId} a:has-text("correct points")`).click();
		await page.waitForURL(new RegExp(`/admin/submissions/${submissionId}/correct-points`));

		await expect(page.locator("#correction-standing")).toContainText("points pending approval");
		await expect(page.locator("#witness-points-10")).toBeChecked();
		// First-time is approval's: no switch before it
		await expect(page.locator('input[name="first_time_species"]')).toHaveCount(0);

		await page.locator("label:has(#witness-points-20)").click();
		await expect(page.locator("#correction-save")).toHaveText("Save correction · 20 pts");
		await page.locator("#correction-reason").fill("Larger class than the catalogue says");
		await page.locator("#correction-save").click();
		await page.waitForURL(new RegExp(`/submissions/${submissionId}$`), { timeout: 10000 });

		const corrected = await readSubmission(submissionId);
		expect(corrected.points).toBe(20);
		expect(corrected.witness_verification_status).toBe("confirmed");
		expect(corrected.witnessed_by).toBe(adminId);
		expect(corrected.approved_on).toBeNull();

		const db = await getTestDatabase();
		try {
			const note = await db.get<{ note_text: string }>(
				"SELECT note_text FROM submission_notes WHERE submission_id = ? AND note_text LIKE '%admin_edit%'",
				submissionId
			);
			expect(note).toBeTruthy();
			expect(note!.note_text).toContain("Larger class than the catalogue says");
		} finally {
			await db.close();
		}

		// The page loaded before the correction posts 15; the sheet has 25
		await armAndConfirm(stale, submissionId);
		await expect(stale.locator("#approve-sheet-title")).toHaveText("The points changed", { timeout: 10000 });
		await expect(stale.locator("#approve-sheet-approve")).toHaveText("Approve · 25 pts");
		expect((await readSubmission(submissionId)).approved_on).toBeNull();

		await stale.locator("#approve-sheet-approve").click();
		await expect(stale.locator(`#queue-approved-${submissionId}`)).toContainText("25 pts", { timeout: 10000 });
		const approved = await readSubmission(submissionId);
		expect(approved.approved_on).toBeTruthy();
		expect(approved.points).toBe(20);
		expect(approved.first_time_species).toBe(1);
	});

	test("a correction after approval may change first-time, and the Edit Approved dialog has no points", async ({ page }) => {
		const { memberId, adminId } = await memberIds();
		const species = await createFreshSpecies(10);
		const submissionId = await createTestSubmission({
			memberId,
			submitted: true,
			witnessed: true,
			witnessedBy: adminId,
			witnessedDaysAgo: 70,
			approved: true,
			approvedBy: adminId,
			bound: true,
			speciesLatinName: species.latin,
			speciesCommonName: species.common,
		});

		await login(page, TEST_ADMIN);
		await page.goto(`/admin/submissions/${submissionId}/correct-points`);
		await expect(page.locator("#correction-standing")).toContainText("Approved: the points are awarded");
		await expect(page.locator('input[name="first_time_species"]')).toHaveCount(1);

		await page.locator("label:has(#witness-article-10)").click();
		await expect(page.locator("#correction-save")).toHaveText("Save correction · 20 pts");
		await page.locator("#correction-reason").fill("Article published in the newsletter");
		await page.locator("#correction-save").click();
		await page.waitForURL(new RegExp(`/submissions/${submissionId}$`), { timeout: 10000 });

		const corrected = await readSubmission(submissionId);
		expect(corrected.article_points).toBe(10);
		expect(corrected.points).toBe(10);
		expect(corrected.approved_on).toBeTruthy();

		// Details only: the Species and points go through the correction form
		const dialog = await page.request.get(`/admin/submissions/${submissionId}/edit-approved`);
		expect(dialog.ok()).toBe(true);
		const html = await dialog.text();
		expect(html).not.toContain('name="points"');
		expect(html).not.toContain('name="article_points"');
		expect(html).toContain('name="reason"');
	});
});
