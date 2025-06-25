import { Submission } from "@/db/submissions";

/**
 * Calculate required waiting days based on species type
 * Fish, Inverts, Corals: 30 days
 * Plants: 60 days (to ensure successful propagation)
 */
export function getRequiredWaitingDays(speciesType: string): number {
	switch (speciesType) {
		case "Plant":
			return 60;
		case "Fish":
		case "Invert":
		case "Coral":
		default:
			return 30;
	}
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

	const requiredDays = getRequiredWaitingDays(submission.species_type);
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
	const requiredDays = getRequiredWaitingDays(submission.species_type);
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