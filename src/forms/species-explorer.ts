import * as z from "zod";

// Define allowed sort fields as enum
const sortFieldEnum = z.enum(["name", "reports", "breeders"]);

// Define allowed sort directions as enum  
const sortDirectionEnum = z.enum(["asc", "desc"]);

// Schema for species explorer query parameters
export const speciesExplorerQuerySchema = z.object({
  species_type: z
    .any()
    .transform((val) => val != null ? String(val).trim() : undefined)
    .refine((val) => val === undefined || val.length <= 50, "Species type too long")
    .transform((val) => val || undefined),
    
  species_class: z
    .any()
    .transform((val) => val != null ? String(val).trim() : undefined)
    .refine((val) => val === undefined || val.length <= 50, "Species class too long")
    .transform((val) => val || undefined),
    
  search: z
    .any()
    .transform((val) => val != null ? String(val).trim() : undefined)
    .refine((val) => val === undefined || val.length <= 100, "Search query too long (maximum 100 characters)")
    .transform((val) => val || undefined),
    
  sort: sortFieldEnum
    .optional()
    .default("reports"),
    
  sortDirection: sortDirectionEnum
    .optional()
    .default("desc")
});

// Export the inferred type
export type SpeciesExplorerQuery = z.infer<typeof speciesExplorerQuerySchema>;

// Validation function for query parameters
export function validateSpeciesExplorerQuery(query: Record<string, unknown>) {
  return speciesExplorerQuerySchema.safeParse(query);
}

// Helper to extract only valid parameters from a query object
export function extractValidSpeciesQuery(query: Record<string, unknown>): Partial<SpeciesExplorerQuery> {
  const result: Partial<SpeciesExplorerQuery> = {};
  
  // Manually validate each field to avoid throwing on invalid data
  const speciesTypeResult = z.string().trim().max(50).optional().safeParse(query.species_type);
  if (speciesTypeResult.success && speciesTypeResult.data) {
    result.species_type = speciesTypeResult.data;
  }
  
  const speciesClassResult = z.string().trim().max(50).optional().safeParse(query.species_class);
  if (speciesClassResult.success && speciesClassResult.data) {
    result.species_class = speciesClassResult.data;
  }
  
  const searchResult = z.string().trim().max(100).optional().safeParse(query.search);
  if (searchResult.success && searchResult.data) {
    result.search = searchResult.data;
  }
  
  const sortResult = sortFieldEnum.optional().safeParse(query.sort);
  if (sortResult.success && sortResult.data) {
    result.sort = sortResult.data;
  } else {
    result.sort = "reports"; // Default value
  }
  
  const sortDirectionResult = sortDirectionEnum.optional().safeParse(query.sortDirection);
  if (sortDirectionResult.success && sortDirectionResult.data) {
    result.sortDirection = sortDirectionResult.data;
  } else {
    result.sortDirection = "desc"; // Default value
  }
  
  return result;
}