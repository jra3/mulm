import * as z from "zod";
import { trimmedString } from "./utils";

// Define allowed sort fields as enum
const sortFieldEnum = z.enum(["name", "reports", "breeders"]);

// Define allowed sort directions as enum  
const sortDirectionEnum = z.enum(["asc", "desc"]);

// Schema for species explorer query parameters
export const speciesExplorerQuerySchema = z.object({
  species_type: trimmedString(50, "Species type too long").optional(),
  species_class: trimmedString(50, "Species class too long").optional(),
  search: trimmedString(100, "Search query too long (maximum 100 characters)").optional(),
  sort: sortFieldEnum.optional().default("reports"),
  sortDirection: sortDirectionEnum.optional().default("desc")
});

// Export the inferred type
export type SpeciesExplorerQuery = z.infer<typeof speciesExplorerQuerySchema>;

