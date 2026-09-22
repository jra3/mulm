/**
 * The catalogue's one refusal.
 *
 * Every rule the catalogue enforces - a Point class outside the tally keys, a
 * duplicate Name, a Canonical name another Species holds, deleting a Species
 * something references, naming a Species that does not exist to an act that
 * needs one (add a Name, rename, merge, delete) - throws this, so a
 * caller can tell "the catalogue said no" (show the message) from "the
 * database broke" (log and 500) by class rather than by message string.
 */
export type RefusalCode =
  | "not_found"
  | "invalid"
  | "duplicate"
  | "referenced"
  | "point_class";

export class CatalogueRefusal extends Error {
  public readonly code: RefusalCode;

  constructor(message: string, code: RefusalCode) {
    super(message);
    this.name = "CatalogueRefusal";
    this.code = code;
  }
}

export function speciesNotFound(speciesId: number): CatalogueRefusal {
  return new CatalogueRefusal(`Species ${speciesId} not found`, "not_found");
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes("UNIQUE constraint");
}
