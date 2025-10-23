import { describe, test } from "node:test";
import assert from "node:assert";
import { speciesExplorerQuerySchema } from "../forms/species-explorer";
import { validateQueryWithFallback } from "../forms/utils";

void describe("Species Explorer Validation", () => {
  void describe("validateQueryWithFallback", () => {
    void test("should validate valid query parameters", () => {
      const validQuery = {
        species_type: "Fish",
        species_class: "Cichlidae",
        search: "Apistogramma",
        sort: "name",
        sortDirection: "asc",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, validQuery);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.species_type, "Fish");
      assert.strictEqual(result.data.species_class, "Cichlidae");
      assert.strictEqual(result.data.search, "Apistogramma");
      assert.strictEqual(result.data.sort, "name");
      assert.strictEqual(result.data.sortDirection, "asc");
      assert.deepStrictEqual(result.errors, []);
      assert.strictEqual(result.isPartial, false);
    });

    void test("should use default values for missing parameters", () => {
      const minimalQuery = {};

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, minimalQuery);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.species_type, undefined);
      assert.strictEqual(result.data.species_class, undefined);
      assert.strictEqual(result.data.search, undefined);
      assert.strictEqual(result.data.sort, "reports");
      assert.strictEqual(result.data.sortDirection, "desc");
      assert.deepStrictEqual(result.errors, []);
      assert.strictEqual(result.isPartial, false);
    });

    void test("should handle invalid sort field with fallback", () => {
      const invalidQuery = {
        sort: "invalid_sort_field",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, invalidQuery);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isPartial, true);
      assert.strictEqual(result.data.sort, "reports"); // Default fallback
      assert.ok(result.errors.length > 0);
    });

    void test("should handle invalid sort direction with fallback", () => {
      const invalidQuery = {
        sortDirection: "invalid_direction",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, invalidQuery);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isPartial, true);
      assert.strictEqual(result.data.sortDirection, "desc"); // Default fallback
      assert.ok(result.errors.length > 0);
    });

    void test("should handle search query that is too long", () => {
      const longQuery = {
        search: "a".repeat(101), // 101 characters, exceeds max of 100
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, longQuery);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isPartial, true);
      assert.strictEqual(result.data.search, undefined); // Invalid value ignored
      assert.ok(result.errors.some((error) => error.includes("Search query too long")));
    });

    void test("should handle species_type that is too long", () => {
      const longQuery = {
        species_type: "a".repeat(51), // 51 characters, exceeds max of 50
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, longQuery);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isPartial, true);
      assert.strictEqual(result.data.species_type, undefined); // Invalid value ignored
      assert.ok(result.errors.some((error) => error.includes("Species type too long")));
    });

    void test("should handle species_class that is too long", () => {
      const longQuery = {
        species_class: "a".repeat(51), // 51 characters, exceeds max of 50
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, longQuery);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isPartial, true);
      assert.strictEqual(result.data.species_class, undefined); // Invalid value ignored
      assert.ok(result.errors.some((error) => error.includes("Species class too long")));
    });

    void test("should trim whitespace from string fields", () => {
      const queryWithWhitespace = {
        species_type: "  Fish  ",
        species_class: "  Cichlidae  ",
        search: "  Apistogramma  ",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, queryWithWhitespace);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.species_type, "Fish");
      assert.strictEqual(result.data.species_class, "Cichlidae");
      assert.strictEqual(result.data.search, "Apistogramma");
    });

    void test("should convert empty strings to undefined", () => {
      const queryWithEmptyStrings = {
        species_type: "",
        species_class: "",
        search: "",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, queryWithEmptyStrings);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.species_type, undefined);
      assert.strictEqual(result.data.species_class, undefined);
      assert.strictEqual(result.data.search, undefined);
    });
  });

  void describe("error handling and fallback behavior", () => {
    void test("should ignore invalid fields and use only valid ones", () => {
      const mixedQuery = {
        species_type: "Fish",
        species_class: "Cichlidae",
        search: "Apistogramma",
        sort: "name",
        sortDirection: "asc",
        invalid_field: "should_be_ignored",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, mixedQuery);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.species_type, "Fish");
      assert.strictEqual(result.data.species_class, "Cichlidae");
      assert.strictEqual(result.data.search, "Apistogramma");
      assert.strictEqual(result.data.sort, "name");
      assert.strictEqual(result.data.sortDirection, "asc");
      assert.strictEqual("invalid_field" in result.data, false);
    });

    void test("should use defaults for invalid values and report errors", () => {
      const invalidQuery = {
        species_type: "a".repeat(51), // Too long
        sort: "invalid_sort",
        sortDirection: "invalid_direction",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, invalidQuery);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isPartial, true);
      assert.strictEqual(result.data.species_type, undefined); // Invalid value ignored
      assert.strictEqual(result.data.sort, "reports"); // Default value
      assert.strictEqual(result.data.sortDirection, "desc"); // Default value
      assert.ok(result.errors.length > 0);
    });

    void test("should handle missing parameters gracefully", () => {
      const emptyQuery = {};

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, emptyQuery);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.species_type, undefined);
      assert.strictEqual(result.data.species_class, undefined);
      assert.strictEqual(result.data.search, undefined);
      assert.strictEqual(result.data.sort, "reports");
      assert.strictEqual(result.data.sortDirection, "desc");
    });
  });

  void describe("Schema validation edge cases", () => {
    void test("should handle null and undefined values", () => {
      const queryWithNulls = {
        species_type: null,
        species_class: undefined,
        search: null,
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, queryWithNulls);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.species_type, undefined);
      assert.strictEqual(result.data.species_class, undefined);
      assert.strictEqual(result.data.search, undefined);
    });

    void test("should handle non-string values by converting them", () => {
      const queryWithNumbers = {
        species_type: 123,
        species_class: true,
        search: 456,
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, queryWithNumbers);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.species_type, "123");
      assert.strictEqual(result.data.species_class, "true");
      assert.strictEqual(result.data.search, "456");
    });

    void test("should validate all allowed sort fields", () => {
      const sortFields = ["name", "reports", "breeders"];

      sortFields.forEach((sortField) => {
        const query = { sort: sortField };
        const result = validateQueryWithFallback(speciesExplorerQuerySchema, query);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data.sort, sortField);
      });
    });

    void test("should validate all allowed sort directions", () => {
      const sortDirections = ["asc", "desc"];

      sortDirections.forEach((sortDirection) => {
        const query = { sortDirection };
        const result = validateQueryWithFallback(speciesExplorerQuerySchema, query);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data.sortDirection, sortDirection);
      });
    });
  });
});
