export interface SpecialtyAward {
  name: string;
  requiredSpecies: number;
  countsTowardMeta: boolean;
  eligibilityFilter: (submission: SubmissionForAward) => boolean;
  limitations?: {
    description: string;
    validator: (submissions: SubmissionForAward[]) => boolean;
  };
}

export interface SubmissionForAward {
  species_class: string;
  species_latin_name: string;
  species_type: string;
  water_type: string;
  spawn_locations?: string;
  canonical_genus?: string; // The referenced Species' Canonical genus
}

export const specialtyAwards: SpecialtyAward[] = [
  {
    name: "Anabantoids Specialist",
    countsTowardMeta: true,
    requiredSpecies: 6,
    eligibilityFilter: (sub) => sub.species_class === "Anabantoids",
  },
  {
    name: "Brackish Water Specialist",
    countsTowardMeta: true,
    requiredSpecies: 3,
    eligibilityFilter: (sub) => sub.water_type === "Brackish",
  },
  {
    name: "Catfish Specialist",
    countsTowardMeta: true,
    requiredSpecies: 5,
    eligibilityFilter: (sub) => sub.species_class === "Catfish & Loaches",
    limitations: {
      description: "1 other than Corydoras, Asidorus, Brochis",
      validator: (submissions) => {
        const nonCorydorasSubmissions = submissions.filter((sub) => {
          const genus = sub.canonical_genus?.toLowerCase();
          return genus && genus !== "corydoras" && genus !== "asidorus" && genus !== "brochis";
        });
        return nonCorydorasSubmissions.length >= 1;
      },
    },
  },
  {
    name: "Characins Specialist",
    countsTowardMeta: true,
    requiredSpecies: 6,
    eligibilityFilter: (sub) => sub.species_class === "Characins",
  },
  {
    name: "New World Cichlids Specialist",
    countsTowardMeta: true,
    requiredSpecies: 12,
    eligibilityFilter: (sub) => sub.species_class === "Cichlids - New World",
  },
  {
    name: "Old World Cichlids Specialist",
    countsTowardMeta: true,
    requiredSpecies: 12,
    eligibilityFilter: (sub) => sub.species_class === "Cichlids - Old World",
    limitations: {
      description: "no more than 5 mouth brooders",
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      validator: (submissions) => {
        // This would require additional metadata about breeding method
        // For now, we'll allow all Old World cichlids until we have better data
        return true;
      },
    },
  },
  {
    name: "Cyprinids Specialist",
    countsTowardMeta: true,
    requiredSpecies: 10,
    eligibilityFilter: (sub) => sub.species_class === "Cyprinids",
  },
  {
    name: "Killifish Specialist",
    countsTowardMeta: true,
    requiredSpecies: 7,
    eligibilityFilter: (sub) => sub.species_class === "Killifish",
    limitations: {
      description: "at least 2 must be annuals",
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      validator: (submissions) => {
        // This would require additional metadata about annual vs non-annual killifish
        // For now, we'll allow all killifish until we have better data
        return true;
      },
    },
  },
  {
    name: "Livebearers Specialist",
    countsTowardMeta: true,
    requiredSpecies: 8,
    eligibilityFilter: (sub) => sub.species_class === "Livebearers",
  },
  {
    name: "Marine Fish Specialist",
    countsTowardMeta: true,
    requiredSpecies: 3,
    eligibilityFilter: (sub) => sub.species_class === "Marine" && sub.water_type === "Salt",
  },
  {
    name: "Marine Invertebrates & Corals Specialist",
    countsTowardMeta: false,
    requiredSpecies: 7,
    eligibilityFilter: (sub) =>
      (sub.species_type === "Invert" && sub.water_type === "Salt") || sub.species_type === "Coral",
    limitations: {
      description: "2 other than snails",
      validator: (submissions) => {
        const nonSnailSubmissions = submissions.filter((sub) => sub.species_class !== "Snail");
        return nonSnailSubmissions.length >= 2;
      },
    },
  },
];

/** Stable definitions own both the meta thresholds and their presentation keys. */
export const metaAwardDefinitions = {
  seniorSpecialist: { name: "Senior Specialist Award", requiredAwards: 4 },
  expertSpecialist: { name: "Expert Specialist Award", requiredAwards: 7 },
};

export const metaAwards = Object.values(metaAwardDefinitions);

export interface SpecialtyAwardEvaluation {
  award: SpecialtyAward;
  eligibleSubmissions: SubmissionForAward[];
  /** Case-insensitive scientific spellings, deliberately not catalogue Species ids. */
  distinctSpecies: string[];
  count: number;
  requiredCount: number;
  limitationMet: boolean;
  qualified: boolean;
}

/**
 * The one qualification rule, independent of grants and presentation.
 * Limitations receive all eligible Submissions (not deduplicated evidence),
 * preserving the existing limitation rules as well as spelling-based counting.
 */
export function evaluateSpecialtyAwards(
  submissions: SubmissionForAward[],
  definitions: SpecialtyAward[] = specialtyAwards
): SpecialtyAwardEvaluation[] {
  return definitions.map((award) => {
    const eligibleSubmissions = submissions.filter(award.eligibilityFilter);
    const distinctSpecies = [
      ...new Set(
        eligibleSubmissions.map((submission) => submission.species_latin_name.toLowerCase())
      ),
    ];
    const count = distinctSpecies.length;
    const requiredCount = award.requiredSpecies;
    const limitationMet = award.limitations?.validator(eligibleSubmissions) ?? true;
    return {
      award,
      eligibleSubmissions,
      distinctSpecies,
      count,
      requiredCount,
      limitationMet,
      qualified: count >= requiredCount && limitationMet,
    };
  });
}

/** Marine Invertebrates & Corals is explicitly excluded by its definition. */
export function getCountableSpecialtyAwards(): string[] {
  return specialtyAwards.filter((award) => award.countsTowardMeta).map((award) => award.name);
}

/** The caller chooses whether these are qualified specialties or existing grants. */
export function evaluateMetaAwards(specialtyNames: string[]) {
  const countableAwards = getCountableSpecialtyAwards();
  const countedAwards = [...new Set(specialtyNames)].filter((name) =>
    countableAwards.includes(name)
  );
  return metaAwards.map((award) => ({
    award,
    countedAwards,
    count: countedAwards.length,
    requiredCount: award.requiredAwards,
    qualified: countedAwards.length >= award.requiredAwards,
  }));
}

/** Newly earned meta-awards; existing grants are left untouched. */
export function checkMetaAwards(existingAwards: string[]): string[] {
  return evaluateMetaAwards(existingAwards)
    .filter(({ award, qualified }) => qualified && !existingAwards.includes(award.name))
    .map(({ award }) => award.name);
}

export function checkSpecialtyAwards(submissions: SubmissionForAward[]): string[] {
  return evaluateSpecialtyAwards(submissions)
    .filter(({ qualified }) => qualified)
    .map(({ award }) => award.name);
}
