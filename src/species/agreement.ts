import { findSpeciesById } from "./lookup";
import { listNames } from "./names";
import type { Name } from "./types";

/** What a Submission form says about its Species. Field names are the Submission's columns. */
export type FormSpellings = {
  species_common_name?: string | null;
  species_latin_name?: string | null;
  species_type?: string | null;
  /** The Submission's copy of the Program class. */
  species_class?: string | null;
};

/**
 * How one spelling relates to the Species: blank, one of its Names of the
 * matching kind (the Canonical name is a scientific Name), one of its
 * scientific Names in the common field, or not one of its Names.
 *
 * "scientific-name" is only for the common field. A Species with no common
 * Name goes by a scientific Name, which the submit form puts in the common
 * field (#421): for such a Species the spelling agrees, for one with common
 * Names it does not. Either way the witness never adds it as a common Name.
 */
export type SpellingAgreement = "empty" | "name" | "scientific-name" | "not-a-name";

export type FormAgreement = {
  /** Spellings and classification both agree. */
  agrees: boolean;
  /** No spelling is something other than a Name of the Species. */
  spellingsAgree: boolean;
  /** Species type and Program class both equal the Species'. */
  classificationAgrees: boolean;
  commonName: SpellingAgreement;
  latinName: SpellingAgreement;
  speciesType: boolean;
  programClass: boolean;
};

function spellingAgreement(spelling: string | null | undefined, names: string[]): SpellingAgreement {
  const trimmed = spelling?.trim().toLowerCase();
  if (!trimmed) return "empty";
  return names.some((name) => name.toLowerCase() === trimmed) ? "name" : "not-a-name";
}

const texts = (names: Name[]) => names.map((n) => n.name);

/** The common spelling against the common Names, then the scientific Names. */
function commonSpellingAgreement(
  spelling: string | null | undefined,
  names: { common: Name[]; scientific: Name[] }
): SpellingAgreement {
  const agreement = spellingAgreement(spelling, texts(names.common));
  if (agreement !== "not-a-name") return agreement;
  return spellingAgreement(spelling, texts(names.scientific)) === "name" ? "scientific-name" : "not-a-name";
}

/**
 * Does this form agree with this Species? Spellings are compared to the
 * Species' Names whole and case-insensitively - the common spelling against
 * common Names (or, for a Species that has none, its scientific Names), the
 * Latin spelling against scientific Names, the Canonical name among them -
 * and the Species type and Program class must be equal.
 *
 * The answer is itemised so a caller can say what disagrees: the save
 * transitions read `agrees`, the witness panel and the Witness read the parts.
 * @returns undefined if the Species does not exist
 */
export async function checkFormAgreement(
  speciesId: number,
  form: FormSpellings
): Promise<FormAgreement | undefined> {
  const species = await findSpeciesById(speciesId);
  if (!species) return undefined;
  const names = await listNames(speciesId);

  const commonName = commonSpellingAgreement(form.species_common_name, names);
  const latinName = spellingAgreement(form.species_latin_name, texts(names.scientific));
  const speciesType = (form.species_type ?? "").trim() === species.species_type;
  const programClass = (form.species_class ?? "").trim() === species.program_class;

  // A scientific Name stands in for a common Name only while the Species has none (#421)
  const commonAgrees =
    commonName === "scientific-name" ? names.common.length === 0 : commonName !== "not-a-name";
  const spellingsAgree = commonAgrees && latinName !== "not-a-name";
  const classificationAgrees = speciesType && programClass;
  return {
    agrees: spellingsAgree && classificationAgrees,
    spellingsAgree,
    classificationAgrees,
    commonName,
    latinName,
    speciesType,
    programClass,
  };
}
