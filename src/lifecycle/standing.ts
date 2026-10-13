import { getMember, MemberRecord } from "@/db/members";
import { recordActivity } from "@/db/activity";
import { checkAndUpdateMemberLevel, type Program } from "@/levelManager";
import { recomputeSpecialtyAwards } from "@/specialtyAwardManager";
import { compareLevelChange, programMetadata } from "@/programs";
import { logger } from "@/utils/logger";
import { notifier } from "./consequences";

/**
 * Bring a member's standing into line with their approved Submissions.
 *
 * Runs on any change to an approved Submission, not only when Points changed:
 * Specialty Awards key on species and genus, so the Points-only gate this
 * replaced missed exactly the case that matters - a committee member
 * correcting a misidentified species.
 *
 * Symmetric in both halves. A Level can drop and a Specialty Award can be
 * revoked, because a member's standing must be one their approved Submissions
 * actually support.
 *
 * Who is told: a rise and a newly earned Award each congratulate the member and
 * post to the feed. A drop, an unknown stored Level, and a revocation do not
 * get congratulatory announcements; the correction letter and standing page
 * already show the member the revised Points.
 *
 * Never throws: a member's standing failing to recompute must not undo an
 * approval that has already been recorded.
 */
export async function recomputeStanding(memberId: number, program: Program): Promise<void> {
  const member = await getMember(memberId);
  if (!member) {
    logger.error("Cannot recompute standing: member not found", { memberId });
    return;
  }

  await recomputeLevel(member, program);
  await recomputeAwards(member);
}

async function recomputeLevel(member: MemberRecord, program: Program): Promise<void> {
  try {
    // The Level module owns the ladder; it is told not to send, because who
    // hears about a change is this module's business.
    const result = await checkAndUpdateMemberLevel(member.id, program, { disableEmails: true });
    if (!result.levelChanged || !result.newLevel) {
      return;
    }

    const change = compareLevelChange(program, result.oldLevel, result.newLevel);
    if (change !== "initial" && change !== "rise") {
      logger.info("Level change does not establish a rise; telling nobody", {
        change,
        memberId: member.id,
        program,
        from: result.oldLevel,
        to: result.newLevel,
      });
      return;
    }

    const totalPoints = result.totalPoints ?? 0;
    // Keyed on the Level, not just the Program: each rise is its own thing to
    // announce, so a second one adds an entry rather than overwriting the
    // first. Reaching a Level already announced refreshes that entry.
    await recordActivity("level_up", member.id, `${program}:${result.newLevel}`, {
      program,
      program_name: programMetadata[program].name,
      level: result.newLevel,
      total_points: totalPoints,
    });
    await notifier().levelUp(member, program, result.newLevel, totalPoints);
  } catch (error) {
    logger.error("Failed to recompute level", error);
  }
}

async function recomputeAwards(member: MemberRecord): Promise<void> {
  try {
    // Granting an Award posts its own feed entry, and revoking one removes it.
    const { granted } = await recomputeSpecialtyAwards(member.id);
    for (const awardName of granted) {
      await notifier().specialtyAward(member, awardName);
    }
  } catch (error) {
    logger.error("Failed to recompute specialty awards", error);
  }
}
