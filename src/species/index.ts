/**
 * The Species catalogue.
 *
 * One module owns Species identity, Names, the Canonical name, Program class,
 * Species type, Point class and the CARES flag. Admin routes, the approval
 * handler, MCP tools, backfill and the IUCN, external-data, CARES, collection
 * and Submission data modules cross this interface for anything about a
 * Species.
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
  type Species,
  type Name,
  type NameKind,
  type SpeciesNames,
} from "./types";
export { isPointClass, admitPointClass, pointClasses, type PointClass } from "./pointClass";
export { CatalogueRefusal, type RefusalCode } from "./errors";

// Finding a Species: by id, or from a pair of spellings (any Name or the Canonical name).
export {
  findSpeciesById,
  findSpeciesByIds,
  resolveSpecies,
  type Resolution,
} from "./lookup";

// Names, by kind.
export { listNames, findNames, addName, removeName, updateName, ensureName } from "./names";

// Curating Species identity.
export {
  createSpecies,
  updateSpecies,
  setPointClass,
  renameCanonical,
  mergeSpecies,
  previewMerge,
  deleteSpecies,
  type NewSpecies,
  type SpeciesUpdate,
  type MergePreview,
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
  countSubmissionsOfSpecies,
  findSpeciesIdOfSubmission,
} from "./submissions";

// Columns other modules own the meaning of; the catalogue writes them.
export { updateIucnStatus, updateLastExternalSync, type IucnStatus } from "./status";

// SQL fragments for modules that read a Species alongside their own tables.
export { speciesFromSql, speciesJoinSql, speciesOfSubmissionJoinSql, anyNameSql } from "./sql";

// Read models: typeahead, explorer, admin list, detail, breeders, IUCN due list, statistics.
export {
  searchSpeciesTypeahead,
  getSpeciesForExplorer,
  getSpeciesForAdmin,
  getSpeciesDetail,
  getBreedersForSpecies,
  getExplorerFilterOptions,
  listSpeciesDueIucnSync,
  getSpeciesStatistics,
  type SpeciesStatistics,
  type SpeciesFilters,
  type SpeciesExplorerItem,
  type SpeciesNameRecord,
  type SpeciesAdminFilters,
  type SpeciesAdminListItem,
  type SpeciesAdminListResult,
  type SpeciesDetail,
  type SpeciesBreeder,
} from "./listings";
