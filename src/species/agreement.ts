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
 * matching kind (the Canonical name is a scientific Name), or not one of its
 * Names.
 */
export type SpellingAgreement = "empty" | "name" | "not-a-name";

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

/**
 * Does this form agree with this Species? Spellings are compared to the
 * Species' Names whole and case-insensitively - the common spelling against
 * common Names (or, for a Species that has none, its scientific Names), the
 * Latin spelling against scientific Names, the Canonical name among them -
 * and the Species type and Program class must be equal.
 *
 * The answer is itemised so a caller can say what disagrees: the save
 * transitions read `agrees`, the witness panel reads the parts.
 * @returns undefined if the Species does not exist
 */
export async function checkFormAgreement(
  speciesId: number,
  form: FormSpellings
): Promise<FormAgreement | undefined> {
  const species = await findSpeciesById(speciesId);
  if (!species) return undefined;
  const names = await listNames(speciesId);

  // A Species with no common Names goes by its Latin name, so the submit form
  // fills the common field with it (#421): any scientific Name will do there.
  const commonNames = names.common.length > 0 ? names.common : names.scientific;
  const commonName = spellingAgreement(form.species_common_name, texts(commonNames));
  const latinName = spellingAgreement(form.species_latin_name, texts(names.scientific));
  const speciesType = (form.species_type ?? "").trim() === species.species_type;
  const programClass = (form.species_class ?? "").trim() === species.program_class;

  const spellingsAgree = commonName !== "not-a-name" && latinName !== "not-a-name";
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
