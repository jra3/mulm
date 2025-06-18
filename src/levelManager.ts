import { MemberRecord, getMember, updateMember } from './db/members';
import { getSubmissionsByMember } from './db/submissions';
import { calculateLevel, levelRules } from './programs';
import { onLevelUpgrade } from './notifications';
import { logger } from './utils/logger';

export type Program = 'fish' | 'plant' | 'coral';

/**
 * Check and update a member's level for a specific program, sending email if upgraded
 */
export async function checkAndUpdateMemberLevel(
	memberId: number, 
	program: Program
): Promise<{ levelChanged: boolean; newLevel?: string; oldLevel?: string }> {
	try {
		const member = await getMember(memberId);
		if (!member) {
			throw new Error(`Member ${memberId} not found`);
		}

		// Get all approved submissions for this member and program
		const submissions = await getSubmissionsByMember(
			memberId.toString(), 
			false, // don't include unsubmitted
			false  // don't include unapproved
		);

		// Filter submissions by program and extract points
		const programSubmissions = submissions.filter(sub => sub.program === program);
		const pointsArray = programSubmissions.map(sub => sub.total_points || sub.points || 0);

		// Calculate what level they should be
		const calculatedLevel = calculateLevel(levelRules[program], pointsArray);
		
		// Get current stored level
		const currentLevel = getCurrentLevel(member, program);

		// Check if level has changed
		if (calculatedLevel !== currentLevel) {
			logger.info(`Level upgrade detected for member ${memberId}: ${currentLevel} → ${calculatedLevel} (${program})`);
			
			// Update member's level in database
			const updateData: Partial<MemberRecord> = {};
			if (program === 'fish') {
				updateData.fish_level = calculatedLevel;
			} else if (program === 'plant') {
				updateData.plant_level = calculatedLevel;
			} else if (program === 'coral') {
				updateData.coral_level = calculatedLevel;
			}
			await updateMember(memberId, updateData);

			// Send email notification if they actually upgraded (not downgraded)
			if (shouldSendUpgradeEmail(currentLevel, calculatedLevel)) {
				const totalPoints = pointsArray.reduce((sum, points) => sum + points, 0);
				await onLevelUpgrade(member, program, calculatedLevel, totalPoints);
				logger.info(`Level upgrade email sent to ${member.contact_email} for ${program} level: ${calculatedLevel}`);
			}

			return { 
				levelChanged: true, 
				newLevel: calculatedLevel, 
				oldLevel: currentLevel 
			};
		}

		return { levelChanged: false };

	} catch (error) {
		logger.error(`Error checking level for member ${memberId} (${program}):`, error);
		throw error;
	}
}

/**
 * Check and update levels for all programs for a member
 */
export async function checkAllMemberLevels(memberId: number): Promise<{
	fish?: { levelChanged: boolean; newLevel?: string; oldLevel?: string };
	plant?: { levelChanged: boolean; newLevel?: string; oldLevel?: string };
	coral?: { levelChanged: boolean; newLevel?: string; oldLevel?: string };
}> {
	const results: Record<string, { levelChanged: boolean; newLevel?: string; oldLevel?: string; error?: boolean }> = {};
	
	for (const program of ['fish', 'plant', 'coral'] as Program[]) {
		try {
			results[program] = await checkAndUpdateMemberLevel(memberId, program);
		} catch (error) {
			logger.error(`Failed to check ${program} level for member ${memberId}:`, error);
			results[program] = { levelChanged: false, error: true };
		}
	}
	
	return results;
}

/**
 * Get the current level for a member in a specific program
 */
function getCurrentLevel(member: MemberRecord, program: Program): string | undefined {
	switch (program) {
		case 'fish':
			return member.fish_level;
		case 'plant':
			return member.plant_level;
		case 'coral':
			return member.coral_level;
		default:
			return undefined;
	}
}

/**
 * Determine if we should send an upgrade email
 * Only send if it's a genuine upgrade (not null->null or downgrade)
 */
function shouldSendUpgradeEmail(oldLevel: string | undefined, newLevel: string): boolean {
	// Always send if going from null/undefined to a level
	if (!oldLevel && newLevel) {
		return true;
	}
	
	// Don't send if both are null/undefined
	if (!oldLevel && !newLevel) {
		return false;
	}
	
	// For now, send for any level change (could add level hierarchy checking later)
	return oldLevel !== newLevel;
}