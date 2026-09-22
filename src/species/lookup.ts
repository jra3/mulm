import { query } from "@/db/conn";
import { nameTable } from "./names";
import { nameKinds, type NameKind, type Species } from "./types";

/** One Species by id, or undefined. */
export async function findSpeciesById(speciesId: number): Promise<Species | undefined> {
  const rows = await query<Species>("SELECT * FROM species_name_group WHERE group_id = ?", [
    speciesId,
  ]);
  return rows[0];
}

/**
 * Every Species that has this Name, matched whole and case-insensitively.
 * A common Name can belong to more than one Species, so this is a list.
 * Pass a kind to search only common or only scientific Names.
 */
export async function findSpeciesByName(text: string, kind?: NameKind): Promise<Species[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const kinds = kind ? [kind] : nameKinds;
  const matches = kinds
    .map((k) => {
      const t = nameTable[k];
      return `SELECT group_id FROM ${t.table} WHERE LOWER(${t.text}) = LOWER(?)`;
    })
    .join(" UNION ");
  return query<Species>(
    `SELECT * FROM species_name_group WHERE group_id IN (${matches})
     ORDER BY canonical_genus, canonical_species_name`,
    kinds.map(() => trimmed)
  );
}

/**
 * The Species whose Canonical name this is, case-insensitively. The first
 * word is the genus and the rest the epithet, so a trinomial finds its
 * Species too.
 */
export async function findSpeciesByCanonicalName(text: string): Promise<Species | undefined> {
  const [genus, ...rest] = text.trim().split(/\s+/);
  const epithet = rest.join(" ");
  if (!genus || !epithet) return undefined;
  const rows = await query<Species>(
    `SELECT * FROM species_name_group
     WHERE LOWER(canonical_genus) = LOWER(?) AND LOWER(canonical_species_name) = LOWER(?)
     LIMIT 1`,
    [genus, epithet]
  );
  return rows[0];
}

export type Resolution = {
  species: Species;
  /** What found it: a scientific Name, a common Name, or the Canonical name. */
  matchedBy: NameKind | "canonical";
};

/**
 * Resolve a pair of free-text spellings - a Submission's, an import row's - to
 * one Species. The Latin spelling is tried first as a scientific Name, then the
 * common spelling as a common Name, then the Latin spelling as a Canonical
 * name. The first hit wins; when a Name belongs to several Species the one
 * with the lowest Canonical name wins, so the answer is stable.
 *
 * This is the lookup historical imports bind by (it was the backfill tools'
 * private matcher). It is exact, not fuzzy: suggesting the Species a member
 * probably meant is separate work.
 */
export async function resolveSpecies(spellings: {
  commonName?: string | null;
  latinName?: string | null;
}): Promise<Resolution | null> {
  const latin = spellings.latinName?.trim();
  const common = spellings.commonName?.trim();

  if (latin) {
    const [species] = await findSpeciesByName(latin, "scientific");
    if (species) return { species, matchedBy: "scientific" };
  }
  if (common) {
    const [species] = await findSpeciesByName(common, "common");
    if (species) return { species, matchedBy: "common" };
  }
  if (latin) {
    const species = await findSpeciesByCanonicalName(latin);
    if (species) return { species, matchedBy: "canonical" };
  }
  return null;
}
