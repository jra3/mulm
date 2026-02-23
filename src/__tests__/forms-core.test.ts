import { describe, test } from "node:test";
import assert from "node:assert";
import { approvalSchema } from "../forms/approval";
import { approvedEditSchema } from "../forms/approvedEdit";
import { caresRegistrationSchema, caresFryShareSchema } from "../forms/cares";
import { loginSchema, signupSchema, forgotSchema, resetSchema } from "../forms/login";
import { memberSchema, inviteSchema } from "../forms/member";
import { submissionNoteForm } from "../forms/submissionNote";

void describe("approvalSchema", () => {
  const validInput = {
    id: "42",
    points: "10",
    group_id: "5",
  };

  void test("parses valid minimal input", () => {
    const result = approvalSchema.safeParse(validInput);
    assert.ok(result.success);
    assert.strictEqual(result.data.id, 42);
    assert.strictEqual(result.data.points, 10);
    assert.strictEqual(result.data.group_id, 5);
  });

  void test("parses optional boolean fields as true when truthy string present", () => {
    const result = approvalSchema.safeParse({
      ...validInput,
      first_time_species: "1",
      cares_species: "yes",
      flowered: "true",
      sexual_reproduction: "x",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.first_time_species, true);
    assert.strictEqual(result.data.cares_species, true);
    assert.strictEqual(result.data.flowered, true);
    assert.strictEqual(result.data.sexual_reproduction, true);
  });

  void test("parses optional boolean fields as false when absent", () => {
    const result = approvalSchema.safeParse(validInput);
    assert.ok(result.success);
    assert.strictEqual(result.data.first_time_species, false);
    assert.strictEqual(result.data.cares_species, false);
    assert.strictEqual(result.data.flowered, false);
    assert.strictEqual(result.data.sexual_reproduction, false);
  });

  void test("rejects group_id less than 1 character", () => {
    const result = approvalSchema.safeParse({ ...validInput, group_id: "" });
    assert.ok(!result.success);
  });

  void test("rejects id that is too long", () => {
    const result = approvalSchema.safeParse({ ...validInput, id: "1".repeat(21) });
    assert.ok(!result.success);
  });

  void test("rejects points that is too long", () => {
    const result = approvalSchema.safeParse({ ...validInput, points: "1".repeat(11) });
    assert.ok(!result.success);
  });

  void test("rejects article_url that is too long", () => {
    const result = approvalSchema.safeParse({ ...validInput, article_url: "x".repeat(501) });
    assert.ok(!result.success);
  });

  void test("accepts valid article_url", () => {
    const result = approvalSchema.safeParse({ ...validInput, article_url: "https://example.com/article" });
    assert.ok(result.success);
    assert.strictEqual(result.data.article_url, "https://example.com/article");
  });
});

void describe("approvedEditSchema", () => {
  void test("accepts empty object (all fields optional except reason)", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix error in record" });
    assert.ok(result.success);
  });

  void test("rejects missing reason", () => {
    const result = approvedEditSchema.safeParse({});
    assert.ok(!result.success);
    const fields = result.error.issues.map((i) => i.path[0]);
    assert.ok(fields.includes("reason"));
  });

  void test("rejects reason shorter than 3 characters", () => {
    const result = approvedEditSchema.safeParse({ reason: "Ab" });
    assert.ok(!result.success);
  });

  void test("accepts reason of exactly 3 characters", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix" });
    assert.ok(result.success);
  });

  void test("rejects notes longer than 2000 characters", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", notes: "x".repeat(2001) });
    assert.ok(!result.success);
  });

  void test("accepts valid video_url", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", video_url: "https://example.com/video" });
    assert.ok(result.success);
  });

  void test("accepts empty string for video_url", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", video_url: "" });
    assert.ok(result.success);
  });

  void test("rejects invalid video_url", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", video_url: "not-a-url" });
    assert.ok(!result.success);
  });

  void test("parses formBoolean fields from string values", () => {
    const result = approvedEditSchema.safeParse({
      reason: "Fix it",
      first_time_species: "1",
      cares_species: "0",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.first_time_species, true);
    assert.strictEqual(result.data.cares_species, false);
  });

  void test("accepts multi-select foods as array", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", foods: ["flake", "frozen"] });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data.foods, ["flake", "frozen"]);
  });

  void test("accepts multi-select foods as string (coerced to array)", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", foods: "flake" });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data.foods, ["flake"]);
  });

  void test("accepts valid points range", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", points: 50 });
    assert.ok(result.success);
    assert.strictEqual(result.data.points, 50);
  });

  void test("rejects negative points", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", points: -1 });
    assert.ok(!result.success);
  });

  void test("rejects points above 100", () => {
    const result = approvedEditSchema.safeParse({ reason: "Fix it", points: 101 });
    assert.ok(!result.success);
  });
});

void describe("caresRegistrationSchema", () => {
  void test("parses valid collection_entry_id as number", () => {
    const result = caresRegistrationSchema.safeParse({ collection_entry_id: 7 });
    assert.ok(result.success);
    assert.strictEqual(result.data.collection_entry_id, 7);
  });

  void test("coerces string to number", () => {
    const result = caresRegistrationSchema.safeParse({ collection_entry_id: "7" });
    assert.ok(result.success);
    assert.strictEqual(result.data.collection_entry_id, 7);
  });

  void test("rejects zero", () => {
    const result = caresRegistrationSchema.safeParse({ collection_entry_id: 0 });
    assert.ok(!result.success);
  });

  void test("rejects negative numbers", () => {
    const result = caresRegistrationSchema.safeParse({ collection_entry_id: -5 });
    assert.ok(!result.success);
  });

  void test("rejects missing collection_entry_id", () => {
    const result = caresRegistrationSchema.safeParse({});
    assert.ok(!result.success);
  });
});

void describe("caresFryShareSchema", () => {
  const validInput = {
    species_group_id: 3,
    recipient_name: "Alice Smith",
    share_date: "2025-06-15",
  };

  void test("parses valid minimal input", () => {
    const result = caresFryShareSchema.safeParse(validInput);
    assert.ok(result.success);
    assert.strictEqual(result.data.species_group_id, 3);
    assert.strictEqual(result.data.recipient_name, "Alice Smith");
    assert.strictEqual(result.data.share_date, "2025-06-15");
  });

  void test("rejects missing species_group_id", () => {
    const result = caresFryShareSchema.safeParse({ recipient_name: "Alice", share_date: "2025-01-01" });
    assert.ok(!result.success);
  });

  void test("rejects zero species_group_id", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, species_group_id: 0 });
    assert.ok(!result.success);
  });

  void test("rejects empty recipient_name", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, recipient_name: "" });
    assert.ok(!result.success);
  });

  void test("rejects recipient_name longer than 200 characters", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, recipient_name: "a".repeat(201) });
    assert.ok(!result.success);
  });

  void test("rejects invalid date format", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, share_date: "06/15/2025" });
    assert.ok(!result.success);
  });

  void test("rejects non-date string", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, share_date: "not-a-date" });
    assert.ok(!result.success);
  });

  void test("accepts optional recipient_club", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, recipient_club: "BASNY" });
    assert.ok(result.success);
    assert.strictEqual(result.data.recipient_club, "BASNY");
  });

  void test("rejects recipient_club longer than 200 characters", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, recipient_club: "a".repeat(201) });
    assert.ok(!result.success);
  });

  void test("transforms whitespace-only recipient_club to null", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, recipient_club: "   " });
    assert.ok(result.success);
    assert.strictEqual(result.data.recipient_club, null);
  });

  void test("accepts optional notes", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, notes: "Healthy fry" });
    assert.ok(result.success);
    assert.strictEqual(result.data.notes, "Healthy fry");
  });

  void test("rejects notes longer than 500 characters", () => {
    const result = caresFryShareSchema.safeParse({ ...validInput, notes: "x".repeat(501) });
    assert.ok(!result.success);
  });
});

void describe("loginSchema", () => {
  void test("parses valid email and password", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "secret123" });
    assert.ok(result.success);
    assert.strictEqual(result.data.email, "user@example.com");
    assert.strictEqual(result.data.password, "secret123");
  });

  void test("accepts optional rememberMe", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "secret", rememberMe: true });
    assert.ok(result.success);
    assert.strictEqual(result.data.rememberMe, true);
  });

  void test("rejects email longer than 100 characters", () => {
    const result = loginSchema.safeParse({ email: "a".repeat(101), password: "secret" });
    assert.ok(!result.success);
  });

  void test("rejects password longer than 100 characters", () => {
    const result = loginSchema.safeParse({ email: "u@e.com", password: "a".repeat(101) });
    assert.ok(!result.success);
  });
});

void describe("signupSchema", () => {
  const validInput = {
    email: "newuser@example.com",
    display_name: "New User",
    password: "ValidPassword1",  // 14 chars, meets level-1 (length >= 12)
    password_confirm: "ValidPassword1",
  };

  void test("parses valid signup input", () => {
    const result = signupSchema.safeParse(validInput);
    assert.ok(result.success);
  });

  void test("rejects invalid email format", () => {
    const result = signupSchema.safeParse({ ...validInput, email: "not-an-email" });
    assert.ok(!result.success);
  });

  void test("rejects display_name shorter than 2 characters", () => {
    const result = signupSchema.safeParse({ ...validInput, display_name: "X" });
    assert.ok(!result.success);
  });

  void test("rejects display_name longer than 100 characters", () => {
    const result = signupSchema.safeParse({ ...validInput, display_name: "a".repeat(101) });
    assert.ok(!result.success);
  });

  void test("rejects password shorter than 12 characters", () => {
    const result = signupSchema.safeParse({ ...validInput, password: "Short1", password_confirm: "Short1" });
    assert.ok(!result.success);
  });

  void test("rejects mismatched password_confirm", () => {
    const result = signupSchema.safeParse({ ...validInput, password_confirm: "DifferentPass1" });
    assert.ok(!result.success);
  });

  void test("rejects email longer than 100 characters", () => {
    const result = signupSchema.safeParse({ ...validInput, email: "a".repeat(90) + "@example.com" });
    assert.ok(!result.success);
  });
});

void describe("forgotSchema", () => {
  void test("parses valid email", () => {
    const result = forgotSchema.safeParse({ email: "user@example.com" });
    assert.ok(result.success);
    assert.strictEqual(result.data.email, "user@example.com");
  });

  void test("rejects invalid email", () => {
    const result = forgotSchema.safeParse({ email: "not-email" });
    assert.ok(!result.success);
  });

  void test("rejects email longer than 100 characters", () => {
    const result = forgotSchema.safeParse({ email: "a".repeat(90) + "@example.com" });
    assert.ok(!result.success);
  });
});

void describe("resetSchema", () => {
  const validInput = {
    code: "abc123token",
    password: "NewValidPass1",
    password_confirm: "NewValidPass1",
  };

  void test("parses valid reset input", () => {
    const result = resetSchema.safeParse(validInput);
    assert.ok(result.success);
  });

  void test("rejects code longer than 200 characters", () => {
    const result = resetSchema.safeParse({ ...validInput, code: "x".repeat(201) });
    assert.ok(!result.success);
  });

  void test("rejects short password", () => {
    const result = resetSchema.safeParse({ ...validInput, password: "short", password_confirm: "short" });
    assert.ok(!result.success);
  });

  void test("rejects mismatched passwords", () => {
    const result = resetSchema.safeParse({ ...validInput, password_confirm: "WrongPass123" });
    assert.ok(!result.success);
  });
});

void describe("memberSchema", () => {
  const validInput = {
    display_name: "Jane Doe",
    contact_email: "jane@example.com",
  };

  void test("parses valid member input", () => {
    const result = memberSchema.safeParse(validInput);
    assert.ok(result.success);
    assert.strictEqual(result.data.display_name, "Jane Doe");
    assert.strictEqual(result.data.contact_email, "jane@example.com");
  });

  void test("rejects empty display_name", () => {
    const result = memberSchema.safeParse({ ...validInput, display_name: "" });
    assert.ok(!result.success);
  });

  void test("rejects display_name longer than 100 characters", () => {
    const result = memberSchema.safeParse({ ...validInput, display_name: "a".repeat(101) });
    assert.ok(!result.success);
  });

  void test("rejects invalid contact_email", () => {
    const result = memberSchema.safeParse({ ...validInput, contact_email: "not-an-email" });
    assert.ok(!result.success);
  });

  void test("rejects contact_email longer than 100 characters", () => {
    const result = memberSchema.safeParse({ ...validInput, contact_email: "a".repeat(90) + "@example.com" });
    assert.ok(!result.success);
  });

  void test("accepts optional fields", () => {
    const result = memberSchema.safeParse({
      ...validInput,
      is_admin: "1",
      fish_level: "advanced",
      plant_level: "beginner",
      coral_level: "intermediate",
    });
    assert.ok(result.success);
  });

  void test("rejects fish_level longer than 50 characters", () => {
    const result = memberSchema.safeParse({ ...validInput, fish_level: "a".repeat(51) });
    assert.ok(!result.success);
  });
});

void describe("inviteSchema", () => {
  void test("parses valid email", () => {
    const result = inviteSchema.safeParse({ contact_email: "invite@example.com" });
    assert.ok(result.success);
    assert.strictEqual(result.data.contact_email, "invite@example.com");
  });

  void test("accepts optional display_name", () => {
    const result = inviteSchema.safeParse({ contact_email: "invite@example.com", display_name: "Invited User" });
    assert.ok(result.success);
    assert.strictEqual(result.data.display_name, "Invited User");
  });

  void test("rejects invalid email", () => {
    const result = inviteSchema.safeParse({ contact_email: "bad-email" });
    assert.ok(!result.success);
  });

  void test("rejects display_name longer than 100 characters", () => {
    const result = inviteSchema.safeParse({ contact_email: "invite@example.com", display_name: "a".repeat(101) });
    assert.ok(!result.success);
  });
});

void describe("submissionNoteForm", () => {
  void test("parses valid note_text", () => {
    const result = submissionNoteForm.safeParse({ note_text: "Great submission!" });
    assert.ok(result.success);
    assert.strictEqual(result.data.note_text, "Great submission!");
  });

  void test("trims whitespace from note_text", () => {
    const result = submissionNoteForm.safeParse({ note_text: "  trimmed  " });
    assert.ok(result.success);
    assert.strictEqual(result.data.note_text, "trimmed");
  });

  void test("rejects empty note_text", () => {
    const result = submissionNoteForm.safeParse({ note_text: "" });
    assert.ok(!result.success);
  });

  void test("trims whitespace-only note_text to empty string (min check runs before trim)", () => {
    // Zod .trim() is a transform applied after .min(1) validation, so whitespace-only
    // passes the length check and gets trimmed to "".
    const result = submissionNoteForm.safeParse({ note_text: "   " });
    assert.ok(result.success);
    assert.strictEqual(result.data.note_text, "");
  });

  void test("rejects note_text longer than 2000 characters", () => {
    const result = submissionNoteForm.safeParse({ note_text: "a".repeat(2001) });
    assert.ok(!result.success);
  });

  void test("accepts note_text of exactly 2000 characters", () => {
    const result = submissionNoteForm.safeParse({ note_text: "a".repeat(2000) });
    assert.ok(result.success);
  });

  void test("rejects missing note_text", () => {
    const result = submissionNoteForm.safeParse({});
    assert.ok(!result.success);
  });
});
