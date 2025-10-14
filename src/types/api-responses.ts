/**
 * Type definitions for API responses
 */

// Species Search API Response Types

/**
 * Response format for typeahead/autocomplete searches (when 'q' parameter is used)
 * Used by frontend autocomplete components
 */
export interface SpeciesTypeaheadItem {
  /** Display text combining genus and species */
  text: string;
  /** First common name if available */
  common_name: string;
  /** Full scientific name */
  scientific_name: string;
  /** BAP program class (e.g., "Fish", "Plant") */
  program_class: string;
  /** Numeric group ID */
  group_id: number;
  /** Specific name ID for foreign key reference */
  name_id: number;
}

/**
 * Response format for species explorer searches (when 'search' parameter is used)
 * Returns full species data with pagination info
 */
export interface SpeciesExplorerResponse {
  /** Array of species matching the search criteria */
  species: import("@/db/species").SpeciesExplorerItem[];
  /** Total count of species in the result set */
  totalSpecies: number;
}

/**
 * Generic error response format used across all APIs
 */
export interface ApiErrorResponse {
  /** Human-readable error message */
  error: string;
  /** Optional error code for programmatic handling */
  code?: string;
  /** Optional additional details about the error */
  details?: unknown;
}

/**
 * Union type representing all possible species search API responses
 */
export type SpeciesSearchApiResponse =
  | SpeciesTypeaheadItem[] // When using 'q' parameter
  | SpeciesExplorerResponse // When using 'search' parameter
  | ApiErrorResponse; // Error case

// Member Search API Response Types

/**
 * Response format for member typeahead searches
 */
export interface MemberTypeaheadItem {
  /** Member email as the form value */
  value: string;
  /** Member name for display */
  text: string;
  /** Member email for secondary display */
  email: string;
}

/**
 * Union type for member search API responses
 */
export type MemberSearchApiResponse = MemberTypeaheadItem[] | ApiErrorResponse;
