import { Submission } from "@/db/submissions";

/**
 * Calculate required waiting days based on species
 * Marine Fish: 30 days
 * All other species: 60 days
 */
export function getRequiredWaitingDays(submission: Pick<Submission, 'species_type' | 'species_class'>): number {
  // Marine fish get 30 days
  if (submission.species_type === 'Fish' && submission.species_class === 'Marine') {
    return 30;
  }
  // Everything else gets 60 days
  return 60;
}

/**
 * Calculate days elapsed since reproduction date
 */
export function getDaysElapsed(reproductionDate: string): number {
  const reproDate = new Date(reproductionDate);
  const now = new Date();
  const diffTime = now.getTime() - reproDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Check if submission is eligible for approval based on waiting period
 */
export function isEligibleForApproval(submission: Submission): boolean {
  if (submission.witness_verification_status !== 'confirmed') {
    return false;
  }

  const requiredDays = getRequiredWaitingDays(submission);
  const elapsed = getDaysElapsed(submission.reproduction_date);
	
  return elapsed >= requiredDays;
}

/**
 * Get waiting period status with days remaining
 */
export function getWaitingPeriodStatus(submission: Submission): { 
	eligible: boolean; 
	daysRemaining: number; 
	requiredDays: number;
	elapsedDays: number;
} {
  const requiredDays = getRequiredWaitingDays(submission);
  const elapsedDays = getDaysElapsed(submission.reproduction_date);
  const daysRemaining = Math.max(0, requiredDays - elapsedDays);
  const eligible = daysRemaining === 0 && submission.witness_verification_status === 'confirmed';
	
  return {
    eligible,
    daysRemaining,
    requiredDays,
    elapsedDays
  };
}

/**
 * Filter submissions that are ready for approval (past waiting period)
 */
export function filterEligibleSubmissions(submissions: Submission[]): Submission[] {
  return submissions.filter(isEligibleForApproval);
}

/**
 * Filter submissions still in waiting period
 */
export function filterWaitingSubmissions(submissions: Submission[]): Submission[] {
  return submissions.filter(submission => 
    submission.witness_verification_status === 'confirmed' && !isEligibleForApproval(submission)
  );
}

export function getWaitingPeriodStatusBulk<T extends Submission>(submissions: T[]): Array<T & { waitingStatus: ReturnType<typeof getWaitingPeriodStatus> }> {
  // Pre-calculate current date once
  const now = new Date();
	
  return submissions.map(submission => {
    const requiredDays = getRequiredWaitingDays(submission);
    const reproDate = new Date(submission.reproduction_date);
    const diffTime = now.getTime() - reproDate.getTime();
    const elapsedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, requiredDays - elapsedDays);
    const eligible = daysRemaining === 0 && submission.witness_verification_status === 'confirmed';
		
    return {
      ...submission,
      waitingStatus: {
        eligible,
        daysRemaining,
        requiredDays,
        elapsedDays
      }
    };
  });
}