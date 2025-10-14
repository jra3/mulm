import { speciesExplorerQuerySchema } from "../forms/species-explorer";
import { validateQueryWithFallback } from "../forms/utils";

describe("Species Explorer Validation", () => {
  describe("validateQueryWithFallback", () => {
    it("should validate valid query parameters", () => {
      const validQuery = {
        species_type: "Fish",
        species_class: "Cichlidae",
        search: "Apistogramma",
        sort: "name",
        sortDirection: "asc",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, validQuery);

      expect(result.success).toBe(true);
      expect(result.data.species_type).toBe("Fish");
      expect(result.data.species_class).toBe("Cichlidae");
      expect(result.data.search).toBe("Apistogramma");
      expect(result.data.sort).toBe("name");
      expect(result.data.sortDirection).toBe("asc");
      expect(result.errors).toEqual([]);
      expect(result.isPartial).toBe(false);
    });

    it("should use default values for missing parameters", () => {
      const minimalQuery = {};

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, minimalQuery);

      expect(result.success).toBe(true);
      expect(result.data.species_type).toBeUndefined();
      expect(result.data.species_class).toBeUndefined();
      expect(result.data.search).toBeUndefined();
      expect(result.data.sort).toBe("reports");
      expect(result.data.sortDirection).toBe("desc");
      expect(result.errors).toEqual([]);
      expect(result.isPartial).toBe(false);
    });

    it("should handle invalid sort field with fallback", () => {
      const invalidQuery = {
        sort: "invalid_sort_field",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, invalidQuery);

      expect(result.success).toBe(false);
      expect(result.isPartial).toBe(true);
      expect(result.data.sort).toBe("reports"); // Default fallback
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle invalid sort direction with fallback", () => {
      const invalidQuery = {
        sortDirection: "invalid_direction",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, invalidQuery);

      expect(result.success).toBe(false);
      expect(result.isPartial).toBe(true);
      expect(result.data.sortDirection).toBe("desc"); // Default fallback
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle search query that is too long", () => {
      const longQuery = {
        search: "a".repeat(101), // 101 characters, exceeds max of 100
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, longQuery);

      expect(result.success).toBe(false);
      expect(result.isPartial).toBe(true);
      expect(result.data.search).toBeUndefined(); // Invalid value ignored
      expect(result.errors.some((error) => error.includes("Search query too long"))).toBe(true);
    });

    it("should handle species_type that is too long", () => {
      const longQuery = {
        species_type: "a".repeat(51), // 51 characters, exceeds max of 50
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, longQuery);

      expect(result.success).toBe(false);
      expect(result.isPartial).toBe(true);
      expect(result.data.species_type).toBeUndefined(); // Invalid value ignored
      expect(result.errors.some((error) => error.includes("Species type too long"))).toBe(true);
    });

    it("should handle species_class that is too long", () => {
      const longQuery = {
        species_class: "a".repeat(51), // 51 characters, exceeds max of 50
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, longQuery);

      expect(result.success).toBe(false);
      expect(result.isPartial).toBe(true);
      expect(result.data.species_class).toBeUndefined(); // Invalid value ignored
      expect(result.errors.some((error) => error.includes("Species class too long"))).toBe(true);
    });

    it("should trim whitespace from string fields", () => {
      const queryWithWhitespace = {
        species_type: "  Fish  ",
        species_class: "  Cichlidae  ",
        search: "  Apistogramma  ",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, queryWithWhitespace);

      expect(result.success).toBe(true);
      expect(result.data.species_type).toBe("Fish");
      expect(result.data.species_class).toBe("Cichlidae");
      expect(result.data.search).toBe("Apistogramma");
    });

    it("should convert empty strings to undefined", () => {
      const queryWithEmptyStrings = {
        species_type: "",
        species_class: "",
        search: "",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, queryWithEmptyStrings);

      expect(result.success).toBe(true);
      expect(result.data.species_type).toBeUndefined();
      expect(result.data.species_class).toBeUndefined();
      expect(result.data.search).toBeUndefined();
    });
  });

  describe("error handling and fallback behavior", () => {
    it("should ignore invalid fields and use only valid ones", () => {
      const mixedQuery = {
        species_type: "Fish",
        species_class: "Cichlidae",
        search: "Apistogramma",
        sort: "name",
        sortDirection: "asc",
        invalid_field: "should_be_ignored",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, mixedQuery);

      expect(result.success).toBe(true);
      expect(result.data.species_type).toBe("Fish");
      expect(result.data.species_class).toBe("Cichlidae");
      expect(result.data.search).toBe("Apistogramma");
      expect(result.data.sort).toBe("name");
      expect(result.data.sortDirection).toBe("asc");
      expect("invalid_field" in result.data).toBe(false);
    });

    it("should use defaults for invalid values and report errors", () => {
      const invalidQuery = {
        species_type: "a".repeat(51), // Too long
        sort: "invalid_sort",
        sortDirection: "invalid_direction",
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, invalidQuery);

      expect(result.success).toBe(false);
      expect(result.isPartial).toBe(true);
      expect(result.data.species_type).toBeUndefined(); // Invalid value ignored
      expect(result.data.sort).toBe("reports"); // Default value
      expect(result.data.sortDirection).toBe("desc"); // Default value
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle missing parameters gracefully", () => {
      const emptyQuery = {};

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, emptyQuery);

      expect(result.success).toBe(true);
      expect(result.data.species_type).toBeUndefined();
      expect(result.data.species_class).toBeUndefined();
      expect(result.data.search).toBeUndefined();
      expect(result.data.sort).toBe("reports");
      expect(result.data.sortDirection).toBe("desc");
    });
  });

  describe("Schema validation edge cases", () => {
    it("should handle null and undefined values", () => {
      const queryWithNulls = {
        species_type: null,
        species_class: undefined,
        search: null,
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, queryWithNulls);

      expect(result.success).toBe(true);
      expect(result.data.species_type).toBeUndefined();
      expect(result.data.species_class).toBeUndefined();
      expect(result.data.search).toBeUndefined();
    });

    it("should handle non-string values by converting them", () => {
      const queryWithNumbers = {
        species_type: 123,
        species_class: true,
        search: 456,
      };

      const result = validateQueryWithFallback(speciesExplorerQuerySchema, queryWithNumbers);

      expect(result.success).toBe(true);
      expect(result.data.species_type).toBe("123");
      expect(result.data.species_class).toBe("true");
      expect(result.data.search).toBe("456");
    });

    it("should validate all allowed sort fields", () => {
      const sortFields = ["name", "reports", "breeders"];

      sortFields.forEach((sortField) => {
        const query = { sort: sortField };
        const result = validateQueryWithFallback(speciesExplorerQuerySchema, query);

        expect(result.success).toBe(true);
        expect(result.data.sort).toBe(sortField);
      });
    });

    it("should validate all allowed sort directions", () => {
      const sortDirections = ["asc", "desc"];

      sortDirections.forEach((sortDirection) => {
        const query = { sortDirection };
        const result = validateQueryWithFallback(speciesExplorerQuerySchema, query);

        expect(result.success).toBe(true);
        expect(result.data.sortDirection).toBe(sortDirection);
      });
    });
  });
});
