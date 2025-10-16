import { describe, test } from "node:test";
import assert from "node:assert";
import { getTrophyLevel, getTrophyIcon, formatAwardsList, getTrophyData, Award } from "../utils/awards";

void describe("Trophy Award System", () => {
  void describe("getTrophyLevel", () => {
    void test("should return null for empty awards array", () => {
      assert.strictEqual(getTrophyLevel([]), null);
    });

    void test("should return null for no specialty awards", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Manual Award", date_awarded: "2025-01-01", award_type: "manual" },
      ];
      assert.strictEqual(getTrophyLevel(awards), null);
    });

    void test("should return bronze for 1 specialty award", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
      ];
      assert.strictEqual(getTrophyLevel(awards), "bronze");
    });

    void test("should return bronze for 3 specialty awards", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
        { member_id: 1, award_name: "Characins Specialist", date_awarded: "2025-01-03", award_type: "species" },
      ];
      assert.strictEqual(getTrophyLevel(awards), "bronze");
    });

    void test("should return silver for 4 specialty awards", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
        { member_id: 1, award_name: "Characins Specialist", date_awarded: "2025-01-03", award_type: "species" },
        { member_id: 1, award_name: "Cyprinids Specialist", date_awarded: "2025-01-04", award_type: "species" },
      ];
      assert.strictEqual(getTrophyLevel(awards), "silver");
    });

    void test("should return silver for Senior Specialist Award", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
        { member_id: 1, award_name: "Characins Specialist", date_awarded: "2025-01-03", award_type: "species" },
        { member_id: 1, award_name: "Cyprinids Specialist", date_awarded: "2025-01-04", award_type: "species" },
        { member_id: 1, award_name: "Senior Specialist Award", date_awarded: "2025-01-05", award_type: "meta_species" },
      ];
      assert.strictEqual(getTrophyLevel(awards), "silver");
    });

    void test("should return gold for 7 specialty awards", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
        { member_id: 1, award_name: "Characins Specialist", date_awarded: "2025-01-03", award_type: "species" },
        { member_id: 1, award_name: "Cyprinids Specialist", date_awarded: "2025-01-04", award_type: "species" },
        { member_id: 1, award_name: "Killifish Specialist", date_awarded: "2025-01-05", award_type: "species" },
        { member_id: 1, award_name: "Catfish Specialist", date_awarded: "2025-01-06", award_type: "species" },
        { member_id: 1, award_name: "New World Cichlids Specialist", date_awarded: "2025-01-07", award_type: "species" },
      ];
      assert.strictEqual(getTrophyLevel(awards), "gold");
    });

    void test("should return gold for Expert Specialist Award", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
        { member_id: 1, award_name: "Characins Specialist", date_awarded: "2025-01-03", award_type: "species" },
        { member_id: 1, award_name: "Cyprinids Specialist", date_awarded: "2025-01-04", award_type: "species" },
        { member_id: 1, award_name: "Killifish Specialist", date_awarded: "2025-01-05", award_type: "species" },
        { member_id: 1, award_name: "Catfish Specialist", date_awarded: "2025-01-06", award_type: "species" },
        { member_id: 1, award_name: "New World Cichlids Specialist", date_awarded: "2025-01-07", award_type: "species" },
        { member_id: 1, award_name: "Expert Specialist Award", date_awarded: "2025-01-08", award_type: "meta_species" },
      ];
      assert.strictEqual(getTrophyLevel(awards), "gold");
    });

    void test("should not count meta awards toward base count", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
        { member_id: 1, award_name: "Characins Specialist", date_awarded: "2025-01-03", award_type: "species" },
        { member_id: 1, award_name: "Senior Specialist Award", date_awarded: "2025-01-04", award_type: "meta_species" },
      ];
      // 3 base awards + Senior = silver (not gold)
      assert.strictEqual(getTrophyLevel(awards), "silver");
    });
  });

  void describe("getTrophyIcon", () => {
    void test("should return gold medal for gold level", () => {
      assert.strictEqual(getTrophyIcon("gold"), "🥇");
    });

    void test("should return silver medal for silver level", () => {
      assert.strictEqual(getTrophyIcon("silver"), "🥈");
    });

    void test("should return bronze medal for bronze level", () => {
      assert.strictEqual(getTrophyIcon("bronze"), "🥉");
    });

    void test("should return empty string for null", () => {
      assert.strictEqual(getTrophyIcon(null), "");
    });
  });

  void describe("formatAwardsList", () => {
    void test("should format single award", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
      ];
      assert.strictEqual(formatAwardsList(awards), "Anabantoids Specialist");
    });

    void test("should format multiple awards with commas", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
      ];
      assert.strictEqual(formatAwardsList(awards), "Anabantoids Specialist, Livebearers Specialist");
    });

    void test("should only include specialty awards", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Manual Award", date_awarded: "2025-01-02", award_type: "manual" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-03", award_type: "species" },
      ];
      assert.strictEqual(formatAwardsList(awards), "Anabantoids Specialist, Livebearers Specialist");
    });
  });

  void describe("getTrophyData", () => {
    void test("should return null for undefined awards", () => {
      assert.strictEqual(getTrophyData(undefined), null);
    });

    void test("should return null for empty awards array", () => {
      assert.strictEqual(getTrophyData([]), null);
    });

    void test("should return null for no specialty awards", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Manual Award", date_awarded: "2025-01-01", award_type: "manual" },
      ];
      assert.strictEqual(getTrophyData(awards), null);
    });

    void test("should return trophy data for bronze level", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
      ];
      const result = getTrophyData(awards);
      assert.ok(result);
      assert.strictEqual(result.icon, "🥉");
      assert.strictEqual(result.level, "bronze");
      assert.strictEqual(result.tooltip, "Specialty Awards: Anabantoids Specialist, Livebearers Specialist");
    });

    void test("should return trophy data for silver level", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
        { member_id: 1, award_name: "Characins Specialist", date_awarded: "2025-01-03", award_type: "species" },
        { member_id: 1, award_name: "Cyprinids Specialist", date_awarded: "2025-01-04", award_type: "species" },
        { member_id: 1, award_name: "Senior Specialist Award", date_awarded: "2025-01-05", award_type: "meta_species" },
      ];
      const result = getTrophyData(awards);
      assert.ok(result);
      assert.strictEqual(result.icon, "🥈");
      assert.strictEqual(result.level, "silver");
      assert.ok(result.tooltip.includes("Senior Specialist Award"));
    });

    void test("should return trophy data for gold level", () => {
      const awards: Award[] = [
        { member_id: 1, award_name: "Anabantoids Specialist", date_awarded: "2025-01-01", award_type: "species" },
        { member_id: 1, award_name: "Livebearers Specialist", date_awarded: "2025-01-02", award_type: "species" },
        { member_id: 1, award_name: "Characins Specialist", date_awarded: "2025-01-03", award_type: "species" },
        { member_id: 1, award_name: "Cyprinids Specialist", date_awarded: "2025-01-04", award_type: "species" },
        { member_id: 1, award_name: "Killifish Specialist", date_awarded: "2025-01-05", award_type: "species" },
        { member_id: 1, award_name: "Catfish Specialist", date_awarded: "2025-01-06", award_type: "species" },
        { member_id: 1, award_name: "New World Cichlids Specialist", date_awarded: "2025-01-07", award_type: "species" },
        { member_id: 1, award_name: "Expert Specialist Award", date_awarded: "2025-01-08", award_type: "meta_species" },
      ];
      const result = getTrophyData(awards);
      assert.ok(result);
      assert.strictEqual(result.icon, "🥇");
      assert.strictEqual(result.level, "gold");
      assert.ok(result.tooltip.includes("Expert Specialist Award"));
    });
  });
});
