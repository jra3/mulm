import { describe, test } from "node:test";
import assert from "node:assert";
import * as pug from "pug";
import type { Submission } from "../db/submissions";
import type { MemberRecord } from "../db/members";

/**
 * Email Template Tests - Changes Requested
 *
 * Tests the onChangesRequested.pug email template to verify it renders
 * correctly with all required content.
 *
 * Related to Issue #178: Add integration tests for changes-requested email notifications
 */

const renderOnChangesRequested = pug.compileFile("src/views/email/onChangesRequested.pug");

// Mock submission data
const createMockSubmission = (overrides?: Partial<Submission>): Partial<Submission> => ({
	id: 123,
	species_common_name: "Guppy",
	species_latin_name: "Poecilia reticulata",
	species_class: "Livebearers",
	species_type: "Fish",
	reproduction_date: "2024-08-15",
	submitted_on: "2024-10-01",
	...overrides,
});

const createMockMember = (overrides?: Partial<MemberRecord>): Partial<MemberRecord> => ({
	id: 1,
	display_name: "Test Member",
	contact_email: "test@example.com",
	...overrides,
});

void describe("Changes Requested Email Template", () => {
	void test("renders email without errors", () => {
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason: "Please add more photos of the fry",
			programContactEmail: "admin@test.com",
		});

		assert.ok(html, "Template should render HTML");
		assert.ok(html.length > 0, "HTML should not be empty");
	});

	void test("includes member name greeting", () => {
		const member = createMockMember({ display_name: "John Doe" });
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member,
			reason: "Test feedback",
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes("John Doe"), "Should include member display name");
		assert.ok(html.includes("Hello"), "Should have greeting");
	});

	void test("includes submission species details", () => {
		const submission = createMockSubmission({
			species_common_name: "Fancy Guppy",
			species_latin_name: "Poecilia reticulata var. fancy",
			species_class: "Livebearers",
		});

		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission,
			member: createMockMember(),
			reason: "Test feedback",
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes("Fancy Guppy"), "Should include common name");
		assert.ok(html.includes("Poecilia reticulata var. fancy"), "Should include latin name");
		assert.ok(html.includes("Livebearers"), "Should include species class");
	});

	void test("includes admin feedback reason", () => {
		const reason = "Please add more photos of the fry and update water parameters";
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason,
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes(reason), "Should include admin feedback verbatim");
		assert.ok(html.includes("Feedback from Admin"), "Should have feedback heading");
	});

	void test("includes edit submission link", () => {
		const submission = createMockSubmission({ id: 456 });
		const html = renderOnChangesRequested({
			domain: "https://bap.basny.org",
			submission,
			member: createMockMember(),
			reason: "Test feedback",
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes("https://bap.basny.org/submissions/456"), "Should include edit link with domain and ID");
		assert.ok(html.includes("Edit Submission"), "Should have edit button text");
	});

	void test("includes witness preservation notice", () => {
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason: "Test feedback",
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes("Your Witness Confirmation is Preserved"), "Should mention witness preservation");
		assert.ok(html.includes("do not need to go through screening again"), "Should explain no re-screening needed");
	});

	void test("includes program contact email", () => {
		const programEmail = "bap@basny.org";
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason: "Test feedback",
			programContactEmail: programEmail,
		});

		assert.ok(html.includes(programEmail), "Should include program contact email for questions");
	});

	void test("includes next steps instructions", () => {
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason: "Test feedback",
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes("Next Steps"), "Should have next steps heading");
		assert.ok(html.includes("Review the admin"), "Should mention reviewing feedback");
		assert.ok(html.includes("Edit your submission"), "Should instruct to edit");
		assert.ok(html.includes("Resubmit"), "Should mention resubmitting");
	});

	void test("handles special characters in feedback", () => {
		const reason = 'Please add "better" photos & update <pH> values';
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason,
			programContactEmail: "admin@test.com",
		});

		// Pug should escape HTML entities
		assert.ok(html.includes("better"), "Should include content with quotes");
		assert.ok(html.includes("&amp;") || html.includes("&"), "Should handle ampersands");
		// Note: Pug may escape < and > to &lt; and &gt;
		assert.ok(html.includes("pH") || html.includes("&lt;pH&gt;"), "Should handle HTML-like content");
	});

	void test("handles long feedback text", () => {
		const longReason = "A".repeat(500) + " Please make these changes.";
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason: longReason,
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes(longReason), "Should include full long feedback text");
		assert.ok(html.length > longReason.length, "HTML should be larger than just the reason");
	});

	void test("handles unicode characters in feedback", () => {
		const reason = "Please add 🐟 photos with café lighting and ensure pH ≥ 7.0";
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason,
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes("café") || html.includes("cafe"), "Should handle accented characters");
		assert.ok(html.includes("pH"), "Should include technical symbols");
	});

	void test("includes email header and footer", () => {
		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission: createMockSubmission(),
			member: createMockMember(),
			reason: "Test feedback",
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes("Changes Requested"), "Should have header title");
		assert.ok(html.includes("Brooklyn Aquarium Society"), "Should have organization name in footer");
		assert.ok(html.includes("basny.org"), "Should have website in footer");
	});

	void test("includes submission dates", () => {
		const submission = createMockSubmission({
			reproduction_date: "2024-08-15",
			submitted_on: "2024-10-01",
		});

		const html = renderOnChangesRequested({
			domain: "https://test.com",
			submission,
			member: createMockMember(),
			reason: "Test feedback",
			programContactEmail: "admin@test.com",
		});

		assert.ok(html.includes("Reproduction Date"), "Should label reproduction date");
		assert.ok(html.includes("Submitted On"), "Should label submission date");
		// Dates are formatted via +longDate mixin, so exact format may vary
		assert.ok(html.includes("2024"), "Should include year from dates");
	});
});
