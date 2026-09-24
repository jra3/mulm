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

/** The Species with these ids that exist, in canonical-name order. */
export async function findSpeciesByIds(speciesIds: number[]): Promise<Species[]> {
  if (speciesIds.length === 0) return [];
  return query<Species>(
    `SELECT * FROM species_name_group WHERE group_id IN (${speciesIds.map(() => "?").join(",")})
     ORDER BY canonical_genus, canonical_species_name`,
    speciesIds
  );
}

/**
 * Every Species that has this Name, matched whole and case-insensitively.
 * A common Name can belong to more than one Species, so this is a list: a
 * Species whose Canonical name it is comes first, then by Canonical name.
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
  const s = nameTable.scientific;
  return query<Species>(
    `SELECT * FROM species_name_group WHERE group_id IN (${matches})
     ORDER BY group_id IN (
         SELECT group_id FROM ${s.table} WHERE ${s.canonical} = 1 AND LOWER(${s.text}) = LOWER(?)
       ) DESC,
       canonical_genus, canonical_species_name`,
    [...kinds.map(() => trimmed), trimmed]
  );
}

export type Resolution = {
  species: Species;
  /** What found it: a scientific Name (the Canonical name is one) or a common Name. */
  matchedBy: NameKind;
};

/**
 * Resolve a pair of free-text spellings - a Submission's, an import row's - to
 * one Species. The Latin spelling is tried first as a scientific Name (the
 * Canonical name is one), then the common spelling as a common Name. The first
 * hit wins; when a Name belongs to several Species, the one whose Canonical
 * name it is wins, else the one with the lowest Canonical name, so the answer
 * is stable.
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
    // As typed, then with runs of spaces collapsed ("Genus  species"), which the
    // Canonical name never has.
    for (const spelling of new Set([latin, latin.replace(/\s+/g, " ")])) {
      const [species] = await findSpeciesByName(spelling, "scientific");
      if (species) return { species, matchedBy: "scientific" };
    }
  }
  if (common) {
    const [species] = await findSpeciesByName(common, "common");
    if (species) return { species, matchedBy: "common" };
  }
  return null;
}
