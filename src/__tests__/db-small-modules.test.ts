import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";

// activity.ts
import { createActivity, getRecentActivity } from "../db/activity";
import type { SubmissionApprovedData, AwardGrantedData } from "../db/activity";

// auth.ts
import { createAuthCode, getAuthCode, deleteAuthCode, deleteExpiredAuthCodes } from "../db/auth";
import type { AuthCode } from "../auth";

// sessions.ts
import { regenerateSessionInDB } from "../db/sessions";

// settings.ts
import { getSetting, updateSetting, getLiveCTAMessage, updateLiveCTAMessage } from "../db/settings";

// submission_notes.ts
import {
  getNotesForSubmission,
  addNote,
  updateNote,
  deleteNote,
  getNoteById,
} from "../db/submission_notes";

// tank.ts
import {
  createTankPreset,
  updateTankPreset,
  queryTankPresets,
  deleteTankPreset,
} from "../db/tank";

let db: Database;
let memberId1: number;
let memberId2: number;

async function setup() {
  db = await open({
    filename: ":memory:",
    driver: sqlite3.Database,
  });
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.migrate({ migrationsPath: "./db/migrations" });
  overrideConnection(db);

  const m1 = await db.run(
    "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
    ["Alice", "alice@test.com"]
  );
  memberId1 = m1.lastID as number;

  const m2 = await db.run(
    "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
    ["Bob", "bob@test.com"]
  );
  memberId2 = m2.lastID as number;
}

async function teardown() {
  try {
    await db.close();
  } catch {
    // ignore
  }
}

// ─── Activity Feed ───────────────────────────────────────────────────────────

void describe("activity.ts", () => {
  beforeEach(setup);
  afterEach(teardown);

  void describe("createActivity", () => {
    void test("should insert a submission_approved activity", async () => {
      const data: SubmissionApprovedData = {
        species_common_name: "Neon Tetra",
        species_type: "Fish",
        points: 10,
        first_time_species: true,
      };

      await createActivity("submission_approved", memberId1, "sub-1", data);

      const row = await db.get("SELECT * FROM activity_feed WHERE member_id = ?", memberId1);
      assert.ok(row);
      assert.equal(row.activity_type, "submission_approved");
      assert.equal(row.related_id, "sub-1");
      const parsed = JSON.parse(row.activity_data);
      assert.equal(parsed.species_common_name, "Neon Tetra");
      assert.equal(parsed.points, 10);
    });

    void test("should insert an award_granted activity", async () => {
      const data: AwardGrantedData = {
        award_name: "Cichlid Master",
        award_type: "specialty",
      };

      await createActivity("award_granted", memberId1, "award-1", data);

      const row = await db.get(
        "SELECT * FROM activity_feed WHERE activity_type = 'award_granted'"
      );
      assert.ok(row);
      assert.equal(row.member_id, memberId1);
      const parsed = JSON.parse(row.activity_data);
      assert.equal(parsed.award_name, "Cichlid Master");
    });

    void test("should set created_at automatically", async () => {
      await createActivity("submission_approved", memberId1, "sub-1", {
        species_common_name: "Guppy",
        species_type: "Fish",
        points: 5,
        first_time_species: false,
      });

      const row = await db.get("SELECT created_at FROM activity_feed LIMIT 1");
      assert.ok(row.created_at);
    });
  });

  void describe("getRecentActivity", () => {
    void test("should return activities ordered by most recent first", async () => {
      await createActivity("submission_approved", memberId1, "sub-1", {
        species_common_name: "First",
        species_type: "Fish",
        points: 5,
        first_time_species: false,
      });
      await createActivity("submission_approved", memberId2, "sub-2", {
        species_common_name: "Second",
        species_type: "Fish",
        points: 10,
        first_time_species: true,
      });

      const activities = await getRecentActivity(10);
      assert.equal(activities.length, 2);
      // Most recent first (sub-2 inserted second)
      assert.equal(activities[0].related_id, "sub-2");
      assert.equal(activities[1].related_id, "sub-1");
    });

    void test("should respect limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await createActivity("submission_approved", memberId1, `sub-${i}`, {
          species_common_name: `Species ${i}`,
          species_type: "Fish",
          points: 5,
          first_time_species: false,
        });
      }

      const activities = await getRecentActivity(3);
      assert.equal(activities.length, 3);
    });

    void test("should include member_name from join", async () => {
      await createActivity("submission_approved", memberId1, "sub-1", {
        species_common_name: "Tetra",
        species_type: "Fish",
        points: 5,
        first_time_species: false,
      });

      const activities = await getRecentActivity(1);
      assert.equal(activities[0].member_name, "Alice");
    });

    void test("should attach awards array to each activity", async () => {
      // Add an award for the member
      await db.run(
        "INSERT INTO awards (member_id, award_name) VALUES (?, ?)",
        [memberId1, "Fish Expert"]
      );

      await createActivity("submission_approved", memberId1, "sub-1", {
        species_common_name: "Tetra",
        species_type: "Fish",
        points: 5,
        first_time_species: false,
      });

      const activities = await getRecentActivity(1);
      assert.ok(Array.isArray(activities[0].awards));
      assert.equal(activities[0].awards.length, 1);
      assert.equal(activities[0].awards[0].award_name, "Fish Expert");
    });

    void test("should return empty array when no activities exist", async () => {
      const activities = await getRecentActivity(10);
      assert.equal(activities.length, 0);
    });

    void test("should default to 10 results", async () => {
      for (let i = 0; i < 15; i++) {
        await createActivity("submission_approved", memberId1, `sub-${i}`, {
          species_common_name: `Species ${i}`,
          species_type: "Fish",
          points: 5,
          first_time_species: false,
        });
      }

      const activities = await getRecentActivity();
      assert.equal(activities.length, 10);
    });
  });
});

// ─── Auth Codes ──────────────────────────────────────────────────────────────

void describe("auth.ts", () => {
  beforeEach(setup);
  afterEach(teardown);

  const makeCode = (overrides: Partial<AuthCode> = {}): AuthCode => ({
    code: "test-code-123",
    member_id: memberId1,
    purpose: "email_verification" as const,
    expires_on: new Date(Date.now() + 3600_000), // 1 hour from now
    ...overrides,
  });

  void describe("createAuthCode / getAuthCode", () => {
    void test("should store and retrieve an auth code", async () => {
      const code = makeCode();
      await createAuthCode(code);

      const retrieved = await getAuthCode("test-code-123");
      assert.ok(retrieved);
      assert.equal(retrieved.code, "test-code-123");
      assert.equal(retrieved.member_id, memberId1);
      assert.equal(retrieved.purpose, "email_verification");
    });

    void test("should return undefined for non-existent code", async () => {
      const result = await getAuthCode("does-not-exist");
      assert.equal(result, undefined);
    });

    void test("should store password_reset purpose", async () => {
      await createAuthCode(makeCode({ code: "reset-1", purpose: "password_reset" }));

      const retrieved = await getAuthCode("reset-1");
      assert.ok(retrieved);
      assert.equal(retrieved.purpose, "password_reset");
    });
  });

  void describe("deleteAuthCode", () => {
    void test("should delete an existing code", async () => {
      await createAuthCode(makeCode());
      await deleteAuthCode("test-code-123");

      const result = await getAuthCode("test-code-123");
      assert.equal(result, undefined);
    });

    void test("should not throw when deleting non-existent code", async () => {
      await assert.doesNotReject(async () => {
        await deleteAuthCode("no-such-code");
      });
    });
  });

  void describe("deleteExpiredAuthCodes", () => {
    void test("should delete codes expired before cutoff", async () => {
      const past = new Date(Date.now() - 7200_000); // 2 hours ago
      await createAuthCode(makeCode({ code: "expired-1", expires_on: past }));
      await createAuthCode(makeCode({ code: "valid-1" })); // 1 hour from now

      await deleteExpiredAuthCodes(new Date());

      const expired = await getAuthCode("expired-1");
      const valid = await getAuthCode("valid-1");
      assert.equal(expired, undefined);
      assert.ok(valid);
    });

    void test("should not delete codes expiring after cutoff", async () => {
      const future = new Date(Date.now() + 86400_000); // tomorrow
      await createAuthCode(makeCode({ code: "future-1", expires_on: future }));

      await deleteExpiredAuthCodes(new Date());

      const result = await getAuthCode("future-1");
      assert.ok(result);
    });
  });
});

// ─── Sessions ────────────────────────────────────────────────────────────────

void describe("sessions.ts", () => {
  beforeEach(setup);
  afterEach(teardown);

  void describe("regenerateSessionInDB", () => {
    void test("should create a new session", async () => {
      await regenerateSessionInDB(undefined, "new-session-1", memberId1, "2030-01-01T00:00:00Z");

      const row = await db.get("SELECT * FROM sessions WHERE session_id = ?", "new-session-1");
      assert.ok(row);
      assert.equal(row.member_id, memberId1);
      assert.equal(row.expires_on, "2030-01-01T00:00:00Z");
    });

    void test("should delete old session and create new one", async () => {
      // Insert an old session first
      await db.run(
        "INSERT INTO sessions (session_id, member_id, expires_on) VALUES (?, ?, ?)",
        ["old-session", memberId1, "2030-01-01T00:00:00Z"]
      );

      await regenerateSessionInDB("old-session", "new-session", memberId1, "2031-01-01T00:00:00Z");

      const old = await db.get("SELECT * FROM sessions WHERE session_id = ?", "old-session");
      const newS = await db.get("SELECT * FROM sessions WHERE session_id = ?", "new-session");
      assert.equal(old, undefined);
      assert.ok(newS);
      assert.equal(newS.member_id, memberId1);
    });

    void test("should handle undefined old session ID gracefully", async () => {
      await assert.doesNotReject(async () => {
        await regenerateSessionInDB(undefined, "fresh-session", memberId1, "2030-01-01T00:00:00Z");
      });

      const row = await db.get("SELECT * FROM sessions WHERE session_id = ?", "fresh-session");
      assert.ok(row);
    });

    void test("should handle 'undefined' string old session ID", async () => {
      await assert.doesNotReject(async () => {
        await regenerateSessionInDB(
          "undefined",
          "session-after-undef",
          memberId1,
          "2030-01-01T00:00:00Z"
        );
      });

      const row = await db.get(
        "SELECT * FROM sessions WHERE session_id = ?",
        "session-after-undef"
      );
      assert.ok(row);
    });

    void test("should work within a transaction (old delete + new insert are atomic)", async () => {
      await db.run(
        "INSERT INTO sessions (session_id, member_id, expires_on) VALUES (?, ?, ?)",
        ["existing", memberId1, "2030-01-01T00:00:00Z"]
      );

      await regenerateSessionInDB("existing", "replacement", memberId1, "2031-06-15T12:00:00Z");

      const count = await db.get("SELECT COUNT(*) as cnt FROM sessions WHERE member_id = ?", memberId1);
      assert.equal(count.cnt, 1);
    });
  });
});

// ─── Settings ────────────────────────────────────────────────────────────────

void describe("settings.ts", () => {
  beforeEach(setup);
  afterEach(teardown);

  void describe("getSetting / updateSetting", () => {
    void test("should return null for non-existent key", async () => {
      const value = await getSetting("nonexistent_key");
      assert.equal(value, null);
    });

    void test("should store and retrieve a setting", async () => {
      await updateSetting("test_key", "test_value");

      const value = await getSetting("test_key");
      assert.equal(value, "test_value");
    });

    void test("should upsert (update existing key)", async () => {
      await updateSetting("my_key", "first");
      await updateSetting("my_key", "second");

      const value = await getSetting("my_key");
      assert.equal(value, "second");
    });

    void test("should store empty string value", async () => {
      await updateSetting("empty_key", "");

      const value = await getSetting("empty_key");
      assert.equal(value, "");
    });
  });

  void describe("getLiveCTAMessage / updateLiveCTAMessage", () => {
    void test("should return default CTA message from migration seed", async () => {
      const msg = await getLiveCTAMessage();
      assert.ok(msg);
      assert.ok(msg.includes("Breeder Awards Program"));
    });

    void test("should update and retrieve CTA message", async () => {
      await updateLiveCTAMessage("# New CTA\n\nUpdated content");

      const msg = await getLiveCTAMessage();
      assert.equal(msg, "# New CTA\n\nUpdated content");
    });
  });
});

// ─── Submission Notes ────────────────────────────────────────────────────────

void describe("submission_notes.ts", () => {
  let submissionId: number;

  beforeEach(async () => {
    await setup();

    // Create a minimal submission to attach notes to
    // Need species name group and names for FK constraints
    const groupResult = await db.run(
      `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
       VALUES ('Freshwater', 'Testus', 'noteus', 'Fish')`
    );
    const groupId = groupResult.lastID as number;

    const cnResult = await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [groupId, "Test Note Fish"]
    );
    const commonNameId = cnResult.lastID as number;

    const snResult = await db.run(
      "INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, ?)",
      [groupId, "Testus noteus"]
    );
    const scientificNameId = snResult.lastID as number;

    const sub = await db.run(
      `INSERT INTO submissions (
        member_id, species_class, species_type, species_common_name,
        species_latin_name, common_name_id, scientific_name_id,
        reproduction_date, temperature, ph, gh,
        specific_gravity, water_type, witness_verification_status,
        program, submitted_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memberId1, "New World", "Fish", "Test Note Fish",
        "Testus noteus", commonNameId, scientificNameId,
        new Date().toISOString(), "76", "7.0", "8",
        "1.000", "Fresh", "pending",
        "fish", new Date().toISOString(),
      ]
    );
    submissionId = sub.lastID as number;
  });

  afterEach(teardown);

  void describe("addNote / getNotesForSubmission", () => {
    void test("should add a note and retrieve it", async () => {
      const noteId = await addNote(submissionId, memberId1, "Looks good overall");

      assert.ok(noteId > 0);

      const notes = await getNotesForSubmission(submissionId);
      assert.equal(notes.length, 1);
      assert.equal(notes[0].note_text, "Looks good overall");
      assert.equal(notes[0].admin_name, "Alice");
      assert.equal(notes[0].submission_id, submissionId);
    });

    void test("should return notes in chronological order", async () => {
      await addNote(submissionId, memberId1, "First note");
      await addNote(submissionId, memberId2, "Second note");

      const notes = await getNotesForSubmission(submissionId);
      assert.equal(notes.length, 2);
      assert.equal(notes[0].note_text, "First note");
      assert.equal(notes[1].note_text, "Second note");
    });

    void test("should return empty array when no notes exist", async () => {
      const notes = await getNotesForSubmission(submissionId);
      assert.equal(notes.length, 0);
    });
  });

  void describe("getNoteById", () => {
    void test("should retrieve a specific note", async () => {
      const noteId = await addNote(submissionId, memberId1, "Specific note");

      const note = await getNoteById(noteId);
      assert.ok(note);
      assert.equal(note.id, noteId);
      assert.equal(note.note_text, "Specific note");
      assert.equal(note.admin_name, "Alice");
    });

    void test("should return null for non-existent note", async () => {
      const note = await getNoteById(99999);
      assert.equal(note, null);
    });
  });

  void describe("updateNote", () => {
    void test("should update the note text", async () => {
      const noteId = await addNote(submissionId, memberId1, "Original");

      await updateNote(noteId, "Updated text");

      const note = await getNoteById(noteId);
      assert.ok(note);
      assert.equal(note.note_text, "Updated text");
    });
  });

  void describe("deleteNote", () => {
    void test("should remove the note", async () => {
      const noteId = await addNote(submissionId, memberId1, "To be deleted");

      await deleteNote(noteId);

      const note = await getNoteById(noteId);
      assert.equal(note, null);
    });

    void test("should not affect other notes", async () => {
      const id1 = await addNote(submissionId, memberId1, "Keep this");
      const id2 = await addNote(submissionId, memberId2, "Delete this");

      await deleteNote(id2);

      const notes = await getNotesForSubmission(submissionId);
      assert.equal(notes.length, 1);
      assert.equal(notes[0].id, id1);
    });
  });
});

// ─── Tank Presets ────────────────────────────────────────────────────────────

void describe("tank.ts", () => {
  beforeEach(setup);
  afterEach(teardown);

  void describe("createTankPreset / queryTankPresets", () => {
    void test("should create and query a tank preset", async () => {
      await createTankPreset({
        member_id: memberId1,
        preset_name: "20 Gallon Long",
        tank_size: "20 gallon",
        filter_type: "HOB",
        water_change_volume: "25%",
        water_change_frequency: "weekly",
        temperature: "78",
        ph: "7.2",
        gh: "10",
        specific_gravity: null,
        substrate_type: "sand",
        substrate_depth: "2 inches",
        substrate_color: "black",
      });

      const presets = await queryTankPresets(memberId1);
      assert.equal(presets.length, 1);
      assert.equal(presets[0].preset_name, "20 Gallon Long");
      assert.equal(presets[0].tank_size, "20 gallon");
      assert.equal(presets[0].temperature, "78");
    });

    void test("should return presets ordered by name", async () => {
      await createTankPreset({
        member_id: memberId1,
        preset_name: "Zebra Tank",
        tank_size: null, filter_type: null, water_change_volume: null,
        water_change_frequency: null, temperature: null, ph: null, gh: null,
        specific_gravity: null, substrate_type: null, substrate_depth: null,
        substrate_color: null,
      });
      await createTankPreset({
        member_id: memberId1,
        preset_name: "Alpha Tank",
        tank_size: null, filter_type: null, water_change_volume: null,
        water_change_frequency: null, temperature: null, ph: null, gh: null,
        specific_gravity: null, substrate_type: null, substrate_depth: null,
        substrate_color: null,
      });

      const presets = await queryTankPresets(memberId1);
      assert.equal(presets.length, 2);
      assert.equal(presets[0].preset_name, "Alpha Tank");
      assert.equal(presets[1].preset_name, "Zebra Tank");
    });

    void test("should isolate presets per member", async () => {
      await createTankPreset({
        member_id: memberId1,
        preset_name: "Alice Tank",
        tank_size: null, filter_type: null, water_change_volume: null,
        water_change_frequency: null, temperature: null, ph: null, gh: null,
        specific_gravity: null, substrate_type: null, substrate_depth: null,
        substrate_color: null,
      });
      await createTankPreset({
        member_id: memberId2,
        preset_name: "Bob Tank",
        tank_size: null, filter_type: null, water_change_volume: null,
        water_change_frequency: null, temperature: null, ph: null, gh: null,
        specific_gravity: null, substrate_type: null, substrate_depth: null,
        substrate_color: null,
      });

      const alicePresets = await queryTankPresets(memberId1);
      const bobPresets = await queryTankPresets(memberId2);
      assert.equal(alicePresets.length, 1);
      assert.equal(alicePresets[0].preset_name, "Alice Tank");
      assert.equal(bobPresets.length, 1);
      assert.equal(bobPresets[0].preset_name, "Bob Tank");
    });

    void test("should return empty array for member with no presets", async () => {
      const presets = await queryTankPresets(memberId1);
      assert.equal(presets.length, 0);
    });
  });

  void describe("updateTankPreset", () => {
    void test("should update specific fields", async () => {
      await createTankPreset({
        member_id: memberId1,
        preset_name: "My Tank",
        tank_size: "10 gallon",
        filter_type: "sponge",
        water_change_volume: null, water_change_frequency: null,
        temperature: "76", ph: "7.0", gh: "8",
        specific_gravity: null, substrate_type: null,
        substrate_depth: null, substrate_color: null,
      });

      await updateTankPreset({
        member_id: memberId1,
        preset_name: "My Tank",
        temperature: "80",
        ph: "6.8",
      });

      const presets = await queryTankPresets(memberId1);
      assert.equal(presets[0].temperature, "80");
      assert.equal(presets[0].ph, "6.8");
      // Unchanged field
      assert.equal(presets[0].filter_type, "sponge");
    });

    void test("should set updated_on timestamp", async () => {
      await createTankPreset({
        member_id: memberId1,
        preset_name: "My Tank",
        tank_size: null, filter_type: null, water_change_volume: null,
        water_change_frequency: null, temperature: null, ph: null, gh: null,
        specific_gravity: null, substrate_type: null, substrate_depth: null,
        substrate_color: null,
      });

      await updateTankPreset({
        member_id: memberId1,
        preset_name: "My Tank",
        temperature: "72",
      });

      const presets = await queryTankPresets(memberId1);
      assert.ok(presets[0].updated_on);
    });
  });

  void describe("deleteTankPreset", () => {
    void test("should delete a preset", async () => {
      await createTankPreset({
        member_id: memberId1,
        preset_name: "Doomed Tank",
        tank_size: null, filter_type: null, water_change_volume: null,
        water_change_frequency: null, temperature: null, ph: null, gh: null,
        specific_gravity: null, substrate_type: null, substrate_depth: null,
        substrate_color: null,
      });

      await deleteTankPreset(memberId1, "Doomed Tank");

      const presets = await queryTankPresets(memberId1);
      assert.equal(presets.length, 0);
    });

    void test("should only delete for the specified member", async () => {
      await createTankPreset({
        member_id: memberId1,
        preset_name: "Same Name",
        tank_size: null, filter_type: null, water_change_volume: null,
        water_change_frequency: null, temperature: null, ph: null, gh: null,
        specific_gravity: null, substrate_type: null, substrate_depth: null,
        substrate_color: null,
      });
      await createTankPreset({
        member_id: memberId2,
        preset_name: "Same Name",
        tank_size: null, filter_type: null, water_change_volume: null,
        water_change_frequency: null, temperature: null, ph: null, gh: null,
        specific_gravity: null, substrate_type: null, substrate_depth: null,
        substrate_color: null,
      });

      await deleteTankPreset(memberId1, "Same Name");

      const alicePresets = await queryTankPresets(memberId1);
      const bobPresets = await queryTankPresets(memberId2);
      assert.equal(alicePresets.length, 0);
      assert.equal(bobPresets.length, 1);
    });
  });
});
