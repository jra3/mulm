/**
 * The Species catalogue.
 *
 * One module owns Species identity, Names, the Canonical name, Program class,
 * Species type, Point class and the CARES flag. Admin routes, the lifecycle
 * module, MCP tools, backfill and scripts cross this interface for anything
 * about a Species.
 *
 * What it does not own: IUCN status, external references and images
 * (enrichment, with their own modules), the CARES registry, the Points
 * formula, and Submissions themselves - it answers which Submissions reference
 * a Species, and whether a form agrees with one, but it does not move them.
 *
 * This index is the interface. See README.md for what is where.
 */

// What a Species, a Name and a Point class are.
export {
  canonicalName,
  nameKinds,
  speciesTypes,
  isSpeciesType,
  type Species,
  type Name,
  type NameKind,
  type SpeciesNames,
} from "./types";
export { isPointClass, pointClasses, type PointClass } from "./pointClass";
export { CatalogueRefusal, type RefusalCode } from "./errors";

// Finding a Species: by id, by any Name, by Canonical name, or from a pair of spellings.
export {
  findSpeciesById,
  findSpeciesByIds,
  findSpeciesByName,
  findSpeciesByCanonicalName,
  resolveSpecies,
  type Resolution,
} from "./lookup";

// Names, by kind.
export { listNames, addName, removeName, ensureName } from "./names";

// Curating Species identity.
export {
  createSpecies,
  updateSpecies,
  setPointClass,
  renameCanonical,
  mergeSpecies,
  deleteSpecies,
  type NewSpecies,
  type SpeciesUpdate,
} from "./curation";

// Does a Submission's form agree with a Species?
export {
  checkFormAgreement,
  type FormSpellings,
  type FormAgreement,
  type SpellingAgreement,
} from "./agreement";

// The Species-Submission relation, one definition.
export {
  speciesIdOfSubmissionSql,
  listSubmissionsOfSpecies,
  countSubmissionsOfSpecies,
  findSpeciesIdOfSubmission,
  type SubmissionOfSpecies,
} from "./submissions";

// Read models: typeahead, explorer, admin list, detail, breeders.
export {
  searchSpeciesTypeahead,
  getSpeciesForExplorer,
  getSpeciesForAdmin,
  getSpeciesDetail,
  getBreedersForSpecies,
  getExplorerFilterOptions,
  listSpeciesDueIucnSync,
  type SpeciesFilters,
  type SpeciesExplorerItem,
  type SpeciesNameRecord,
  type SpeciesAdminFilters,
  type SpeciesAdminListItem,
  type SpeciesAdminListResult,
  type SpeciesDetail,
  type SpeciesBreeder,
} from "./listings";
