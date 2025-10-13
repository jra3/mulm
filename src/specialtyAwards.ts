export interface SpecialtyAward {
	name: string;
	requiredSpecies: number;
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
	canonical_genus?: string; // From species_name_group table
}

export const specialtyAwards: SpecialtyAward[] = [
  {
    name: 'Anabantoids Specialist',
    requiredSpecies: 6,
    eligibilityFilter: (sub) => sub.species_class === 'Anabantoids'
  },
  {
    name: 'Brackish Water Specialist',
    requiredSpecies: 3,
    eligibilityFilter: (sub) => sub.water_type === 'Brackish'
  },
  {
    name: 'Catfish Specialist',
    requiredSpecies: 5,
    eligibilityFilter: (sub) => sub.species_class === 'Catfish & Loaches',
    limitations: {
      description: '1 other than Corydoras, Asidorus, Brochis',
      validator: (submissions) => {
        const nonCorydorasSubmissions = submissions.filter(sub => {
          const genus = sub.canonical_genus?.toLowerCase();
          return genus && 
						genus !== 'corydoras' && 
						genus !== 'asidorus' && 
						genus !== 'brochis';
        });
        return nonCorydorasSubmissions.length >= 1;
      }
    }
  },
  {
    name: 'Characins Specialist',
    requiredSpecies: 6,
    eligibilityFilter: (sub) => sub.species_class === 'Characins'
  },
  {
    name: 'New World Cichlids Specialist',
    requiredSpecies: 12,
    eligibilityFilter: (sub) => sub.species_class === 'Cichlids'
    // Note: We'd need additional metadata to distinguish New World vs Old World cichlids
    // For now, treating all Cichlids the same until we have better classification
  },
  {
    name: 'Old World Cichlids Specialist',
    requiredSpecies: 12,
    eligibilityFilter: (sub) => sub.species_class === 'Cichlids',
    limitations: {
      description: 'no more than 5 mouth brooders',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      validator: (submissions) => {
        // This would require additional metadata about breeding method
        // For now, we'll allow all cichlids until we have better data
        return true;
      }
    }
  },
  {
    name: 'Cyprinids Specialist',
    requiredSpecies: 10,
    eligibilityFilter: (sub) => sub.species_class === 'Cyprinids'
  },
  {
    name: 'Killifish Specialist',
    requiredSpecies: 7,
    eligibilityFilter: (sub) => sub.species_class === 'Killifish',
    limitations: {
      description: 'at least 2 must be annuals',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      validator: (submissions) => {
        // This would require additional metadata about annual vs non-annual killifish
        // For now, we'll allow all killifish until we have better data
        return true;
      }
    }
  },
  {
    name: 'Livebearers Specialist',
    requiredSpecies: 8,
    eligibilityFilter: (sub) => sub.species_class === 'Livebearers'
  },
  {
    name: 'Marine Fish Specialist',
    requiredSpecies: 3,
    eligibilityFilter: (sub) => sub.species_class === 'Marine' && sub.water_type === 'Salt'
  },
  {
    name: 'Marine Invertebrates & Corals Specialist',
    requiredSpecies: 7,
    eligibilityFilter: (sub) => 
      (sub.species_type === 'Invert' && sub.water_type === 'Salt') || 
			sub.species_type === 'Coral',
    limitations: {
      description: '2 other than snails',
      validator: (submissions) => {
        const nonSnailSubmissions = submissions.filter(sub => 
          sub.species_class !== 'Snail'
        );
        return nonSnailSubmissions.length >= 2;
      }
    }
  }
];

/**
 * Meta-awards that are earned by achieving multiple specialty awards
 */
export const metaAwards: SpecialtyAward[] = [
  {
    name: 'Senior Specialist Award',
    requiredSpecies: 4, // Actually requires 4 different specialty awards
    eligibilityFilter: () => true // Will be handled by special logic
  },
  {
    name: 'Expert Specialist Award', 
    requiredSpecies: 7, // Actually requires 7 different specialty awards
    eligibilityFilter: () => true // Will be handled by special logic
  }
];

/**
 * Get specialty awards that count toward meta-awards
 * Excludes Marine Invertebrates & Corals Specialist as per requirement
 */
export function getCountableSpecialtyAwards(): string[] {
  return specialtyAwards
    .filter(award => award.name !== 'Marine Invertebrates & Corals Specialist')
    .map(award => award.name);
}

/**
 * Check if a member qualifies for meta-awards based on their existing specialty awards
 */
export function checkMetaAwards(existingAwards: string[]): string[] {
  const countableAwards = getCountableSpecialtyAwards();
  const earnedCountableAwards = existingAwards.filter(award => 
    countableAwards.includes(award)
  );
	
  const metaAwardsEarned: string[] = [];
	
  // Senior Specialist: 4 different species groups (excluding invertebrates)
  if (earnedCountableAwards.length >= 4 && !existingAwards.includes('Senior Specialist Award')) {
    metaAwardsEarned.push('Senior Specialist Award');
  }
	
  // Expert Specialist: 7 different species groups (excluding invertebrates)  
  if (earnedCountableAwards.length >= 7 && !existingAwards.includes('Expert Specialist Award')) {
    metaAwardsEarned.push('Expert Specialist Award');
  }
	
  return metaAwardsEarned;
}

/**
 * Check if a member qualifies for any specialty awards based on their approved submissions
 */
export function checkSpecialtyAwards(
  submissions: SubmissionForAward[]
): string[] {
  const earnedAwards: string[] = [];
	
  for (const award of specialtyAwards) {
    // Filter submissions that match this award's eligibility criteria
    const eligibleSubmissions = submissions.filter(sub => 
      award.eligibilityFilter(sub)
    );
		
    // Count unique species (by latin name)
    const uniqueSpecies = new Set(
      eligibleSubmissions.map(sub => sub.species_latin_name.toLowerCase())
    );
		
    // Check if they have enough species
    if (uniqueSpecies.size >= award.requiredSpecies) {
      // Check limitations if any
      if (award.limitations) {
        if (award.limitations.validator(eligibleSubmissions)) {
          earnedAwards.push(award.name);
        }
      } else {
        earnedAwards.push(award.name);
      }
    }
  }
	
  return earnedAwards;
}