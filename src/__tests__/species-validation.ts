import { 
  validateSpeciesExplorerQuery, 
  extractValidSpeciesQuery
} from "../forms/species-explorer";

describe('Species Explorer Validation', () => {
  describe('validateSpeciesExplorerQuery', () => {
    it('should validate valid query parameters', () => {
      const validQuery = {
        species_type: 'Fish',
        species_class: 'Cichlidae',
        search: 'Apistogramma',
        sort: 'name',
        sortDirection: 'asc'
      };

      const result = validateSpeciesExplorerQuery(validQuery);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species_type).toBe('Fish');
        expect(result.data.species_class).toBe('Cichlidae');
        expect(result.data.search).toBe('Apistogramma');
        expect(result.data.sort).toBe('name');
        expect(result.data.sortDirection).toBe('asc');
      }
    });

    it('should use default values for missing parameters', () => {
      const minimalQuery = {};

      const result = validateSpeciesExplorerQuery(minimalQuery);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species_type).toBeUndefined();
        expect(result.data.species_class).toBeUndefined();
        expect(result.data.search).toBeUndefined();
        expect(result.data.sort).toBe('reports');
        expect(result.data.sortDirection).toBe('desc');
      }
    });

    it('should reject invalid sort field', () => {
      const invalidQuery = {
        sort: 'invalid_sort_field'
      };

      const result = validateSpeciesExplorerQuery(invalidQuery);
      
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('Invalid enum value');
    });

    it('should reject invalid sort direction', () => {
      const invalidQuery = {
        sortDirection: 'invalid_direction'
      };

      const result = validateSpeciesExplorerQuery(invalidQuery);
      
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('Invalid enum value');
    });

    it('should reject search query that is too long', () => {
      const longQuery = {
        search: 'a'.repeat(101) // 101 characters, exceeds max of 100
      };

      const result = validateSpeciesExplorerQuery(longQuery);
      
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('Search query too long');
    });

    it('should reject species_type that is too long', () => {
      const longQuery = {
        species_type: 'a'.repeat(51) // 51 characters, exceeds max of 50
      };

      const result = validateSpeciesExplorerQuery(longQuery);
      
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('Species type too long');
    });

    it('should reject species_class that is too long', () => {
      const longQuery = {
        species_class: 'a'.repeat(51) // 51 characters, exceeds max of 50
      };

      const result = validateSpeciesExplorerQuery(longQuery);
      
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('Species class too long');
    });

    it('should trim whitespace from string fields', () => {
      const queryWithWhitespace = {
        species_type: '  Fish  ',
        species_class: '  Cichlidae  ',
        search: '  Apistogramma  '
      };

      const result = validateSpeciesExplorerQuery(queryWithWhitespace);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species_type).toBe('Fish');
        expect(result.data.species_class).toBe('Cichlidae');
        expect(result.data.search).toBe('Apistogramma');
      }
    });

    it('should convert empty strings to undefined', () => {
      const queryWithEmptyStrings = {
        species_type: '',
        species_class: '',
        search: ''
      };

      const result = validateSpeciesExplorerQuery(queryWithEmptyStrings);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species_type).toBeUndefined();
        expect(result.data.species_class).toBeUndefined();
        expect(result.data.search).toBeUndefined();
      }
    });
  });

  describe('extractValidSpeciesQuery', () => {
    it('should extract only valid parameters', () => {
      const mixedQuery = {
        species_type: 'Fish',
        species_class: 'Cichlidae',
        search: 'Apistogramma',
        sort: 'name',
        sortDirection: 'asc',
        invalid_field: 'should_be_ignored'
      };

      const result = extractValidSpeciesQuery(mixedQuery);
      
      expect(result.species_type).toBe('Fish');
      expect(result.species_class).toBe('Cichlidae');
      expect(result.search).toBe('Apistogramma');
      expect(result.sort).toBe('name');
      expect(result.sortDirection).toBe('asc');
      expect('invalid_field' in result).toBe(false);
    });

    it('should use defaults for invalid values', () => {
      const invalidQuery = {
        species_type: 'a'.repeat(51), // Too long
        sort: 'invalid_sort',
        sortDirection: 'invalid_direction'
      };

      const result = extractValidSpeciesQuery(invalidQuery);
      
      expect(result.species_type).toBeUndefined(); // Invalid value ignored
      expect(result.sort).toBe('reports'); // Default value
      expect(result.sortDirection).toBe('desc'); // Default value
    });

    it('should handle missing parameters gracefully', () => {
      const emptyQuery = {};

      const result = extractValidSpeciesQuery(emptyQuery);
      
      expect(result.species_type).toBeUndefined();
      expect(result.species_class).toBeUndefined();
      expect(result.search).toBeUndefined();
      expect(result.sort).toBe('reports');
      expect(result.sortDirection).toBe('desc');
    });
  });

  describe('Schema validation edge cases', () => {
    it('should handle null and undefined values', () => {
      const queryWithNulls = {
        species_type: null,
        species_class: undefined,
        search: null
      };

      const result = validateSpeciesExplorerQuery(queryWithNulls);
      
      // Our updated schema now handles null/undefined values gracefully
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species_type).toBeUndefined();
        expect(result.data.species_class).toBeUndefined();
        expect(result.data.search).toBeUndefined();
      }
    });

    it('should handle non-string values by converting them', () => {
      const queryWithNumbers = {
        species_type: 123,
        species_class: true,
        search: 456
      };

      const result = validateSpeciesExplorerQuery(queryWithNumbers);
      
      // Zod schema will convert these to strings and validate them
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.species_type).toBe('123');
        expect(result.data.species_class).toBe('true');
        expect(result.data.search).toBe('456');
      }
    });

    it('should validate all allowed sort fields', () => {
      const sortFields = ['name', 'reports', 'breeders'];
      
      sortFields.forEach(sortField => {
        const query = { sort: sortField };
        const result = validateSpeciesExplorerQuery(query);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.sort).toBe(sortField);
        }
      });
    });

    it('should validate all allowed sort directions', () => {
      const sortDirections = ['asc', 'desc'];
      
      sortDirections.forEach(sortDirection => {
        const query = { sortDirection };
        const result = validateSpeciesExplorerQuery(query);
        
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.sortDirection).toBe(sortDirection);
        }
      });
    });
  });
});