import { describe, test } from "node:test";
import assert from "node:assert";
import { editApprovedDetailsForm } from "../forms/editApprovedDetails";

/**
 * The Edit Approved Submission dialog's schema (#529): the member's details
 * and a reason, nothing of the Species or the points. No database.
 */
void describe("The Edit Approved dialog's form", () => {
  const fields = (issues: { path: PropertyKey[] }[]) => issues.map((issue) => String(issue.path[0])).sort();

  void test("parses the details and the reason", () => {
    const result = editApprovedDetailsForm.safeParse({
      tank_size: "20 gallon",
      temperature: "78",
      foods: ["Flakes", "Baby brine shrimp"],
      spawn_locations: "Plants",
      reproduction_date: "2024-03-01",
      video_url: "",
      reason: "The member wrote 20 gallon on the paper form",
    });
    assert.ok(result.success, JSON.stringify(result.error?.issues));
    assert.deepStrictEqual(result.data, {
      tank_size: "20 gallon",
      temperature: "78",
      foods: ["Flakes", "Baby brine shrimp"],
      spawn_locations: ["Plants"],
      reproduction_date: "2024-03-01",
      video_url: "",
      reason: "The member wrote 20 gallon on the paper form",
    });
  });

  void test("the reason is required, and not a couple of letters", () => {
    const missing = editApprovedDetailsForm.safeParse({ tank_size: "20 gallon" });
    assert.ok(!missing.success);
    assert.deepStrictEqual(fields(missing.error.issues), ["reason"]);

    const short = editApprovedDetailsForm.safeParse({ tank_size: "20 gallon", reason: " ok " });
    assert.ok(!short.success);
    assert.deepStrictEqual(fields(short.error.issues), ["reason"]);
    assert.match(short.error.issues[0].message, /Say why/);
  });

  void test("has no Species or points fields: a body carrying them loses them", () => {
    const result = editApprovedDetailsForm.safeParse({
      tank_size: "20 gallon",
      points: "20",
      article_points: "10",
      first_time_species: "1",
      cares_species: "1",
      flowered: "1",
      sexual_reproduction: "1",
      group_id: "7",
      species_id: "7",
      reason: "Trying it on",
    });
    assert.ok(result.success);
    assert.deepStrictEqual(Object.keys(result.data).sort(), ["reason", "tank_size"]);
  });

  void test("links must be links", () => {
    const result = editApprovedDetailsForm.safeParse({ video_url: "not a url", article_link: "ftp", reason: "Fixing links" });
    assert.ok(!result.success);
    assert.deepStrictEqual(fields(result.error.issues), ["article_link", "video_url"]);
  });
});
