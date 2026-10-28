import { query, withTransaction } from "../db/conn";
import { moveLoginMethods } from "../db/members";
import { revokeMemberAdminTokens } from "../db/adminTokens";
import type { MemberRecord } from "../db/members";

export type MergeMembersInput = { from_member_id: number; to_member_id: number; preview?: boolean };

/** Merge administrative duplicates, retaining every login kind the survivor lacks. */
export async function mergeMembers(args: MergeMembersInput) {
  const { from_member_id, to_member_id, preview } = args;

  if (from_member_id === to_member_id) {
    throw new Error("Cannot merge a member into itself");
  }

  // Get both members
  const fromMembers = await query<MemberRecord>("SELECT * FROM members WHERE id = ?", [
    from_member_id,
  ]);
  const toMembers = await query<MemberRecord>("SELECT * FROM members WHERE id = ?", [to_member_id]);

  if (fromMembers.length === 0) {
    throw new Error(`Source member ${from_member_id} not found`);
  }
  if (toMembers.length === 0) {
    throw new Error(`Destination member ${to_member_id} not found`);
  }

  const fromMember = fromMembers[0];
  const toMember = toMembers[0];

  // Get counts for preview
  const submissionCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submissions WHERE member_id = ?",
    [from_member_id]
  );

  const awardCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM awards WHERE member_id = ?",
    [from_member_id]
  );

  const tankPresetCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM tank_presets WHERE member_id = ?",
    [from_member_id]
  );

  const previewData = {
    from_member: {
      id: fromMember.id,
      email: fromMember.contact_email,
      display_name: fromMember.display_name,
      submission_count: submissionCount[0]?.count || 0,
      award_count: awardCount[0]?.count || 0,
      tank_preset_count: tankPresetCount[0]?.count || 0,
    },
    to_member: {
      id: toMember.id,
      email: toMember.contact_email,
      display_name: toMember.display_name,
    },
    actions: [
      `Move ${submissionCount[0]?.count || 0} submissions`,
      `Move ${awardCount[0]?.count || 0} awards`,
      `Move ${tankPresetCount[0]?.count || 0} tank presets`,
      `Move Google, Apple and password logins the destination lacks`,
      `Revoke member ${from_member_id}'s admin API tokens`,
      `Delete member ${from_member_id}`,
    ],
  };

  if (preview) {
    return {
      success: true,
      preview: true,
      preview_data: previewData,
      message: "Preview of merge operation (no changes made)",
    };
  }

  // Execute merge
  const results = await withTransaction(async (db) => {
    // Migrate submissions
    const subStmt = await db.prepare("UPDATE submissions SET member_id = ? WHERE member_id = ?");
    const subResult = await subStmt.run(to_member_id, from_member_id);
    await subStmt.finalize();

    // Migrate awards
    const awardStmt = await db.prepare("UPDATE awards SET member_id = ? WHERE member_id = ?");
    const awardResult = await awardStmt.run(to_member_id, from_member_id);
    await awardStmt.finalize();

    // Migrate tank presets
    const tankStmt = await db.prepare("UPDATE tank_presets SET member_id = ? WHERE member_id = ?");
    const tankResult = await tankStmt.run(to_member_id, from_member_id);
    await tankStmt.finalize();

    // Keep the source's logins where the destination has none of that kind,
    // so a duplicate created by a Google or Apple sign-in (a Hide My Email
    // relay address, say) still logs into the surviving member afterwards.
    const loginsMoved = await moveLoginMethods(db, from_member_id, to_member_id);

    // The source's admin API tokens die with it rather than moving: they were
    // minted for that member's admin rights, not the destination's.
    const adminTokensRevoked = await revokeMemberAdminTokens(db, from_member_id);

    // Delete source member (cascades whatever logins were not moved, plus
    // sessions and auth_codes)
    const deleteStmt = await db.prepare("DELETE FROM members WHERE id = ?");
    await deleteStmt.run(from_member_id);
    await deleteStmt.finalize();

    return {
      submissions_moved: subResult.changes,
      awards_moved: awardResult.changes,
      tank_presets_moved: tankResult.changes,
      logins_moved: loginsMoved,
      admin_tokens_revoked: adminTokensRevoked,
    };
  });

  return {
    success: true,
    from_member_id,
    to_member_id,
    ...results,
    preview_data: previewData,
    message: `Member ${from_member_id} merged into ${to_member_id} successfully`,
  };
}
