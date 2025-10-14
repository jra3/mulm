#!/usr/bin/env tsx

/**
 * Merge Member Accounts
 *
 * Migrates all data from one member account to another, then deletes the old account.
 * Usage: npm run script scripts/merge-members.ts <from_member_id> <to_member_id>
 */

import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, "..", "src"));

import { init, withTransaction, query } from "@/db/conn";
import { Database } from "sqlite";

interface MemberInfo {
  id: number;
  contact_email: string;
  display_name: string;
  submission_count: number;
  has_password: boolean;
  has_google: boolean;
}

async function getMemberInfo(memberId: number): Promise<MemberInfo | null> {
  const members = await query<{ id: number; contact_email: string; display_name: string }>(
    "SELECT id, contact_email, display_name FROM members WHERE id = ?",
    [memberId]
  );

  if (members.length === 0) {
    return null;
  }

  const member = members[0];

  const submissions = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submissions WHERE member_id = ?",
    [memberId]
  );

  const passwords = await query<{ member_id: number }>(
    "SELECT member_id FROM password_account WHERE member_id = ?",
    [memberId]
  );

  const google = await query<{ member_id: number }>(
    "SELECT member_id FROM google_account WHERE member_id = ?",
    [memberId]
  );

  return {
    id: member.id,
    contact_email: member.contact_email,
    display_name: member.display_name,
    submission_count: submissions[0].count,
    has_password: passwords.length > 0,
    has_google: google.length > 0,
  };
}

async function mergeMembers(fromId: number, toId: number) {
  try {
    console.log("Member Account Merge Tool");
    console.log("=========================\n");

    // Change to parent directory
    process.chdir(path.join(__dirname, ".."));

    // Initialize database
    console.log("Initializing database connection...");
    await init();

    // Get info about both members
    console.log(`\nFetching member information...`);
    const fromMember = await getMemberInfo(fromId);
    const toMember = await getMemberInfo(toId);

    if (!fromMember) {
      console.error(`Error: Member ${fromId} not found`);
      process.exit(1);
    }

    if (!toMember) {
      console.error(`Error: Member ${toId} not found`);
      process.exit(1);
    }

    console.log(`\nFrom (will be deleted):`);
    console.log(`  ID: ${fromMember.id}`);
    console.log(`  Email: ${fromMember.contact_email}`);
    console.log(`  Name: ${fromMember.display_name}`);
    console.log(`  Submissions: ${fromMember.submission_count}`);
    console.log(`  Has Password: ${fromMember.has_password ? "YES" : "NO"}`);
    console.log(`  Has Google: ${fromMember.has_google ? "YES" : "NO"}`);

    console.log(`\nTo (will receive data):`);
    console.log(`  ID: ${toMember.id}`);
    console.log(`  Email: ${toMember.contact_email}`);
    console.log(`  Name: ${toMember.display_name}`);
    console.log(`  Submissions: ${toMember.submission_count}`);
    console.log(`  Has Password: ${toMember.has_password ? "YES" : "NO"}`);
    console.log(`  Has Google: ${toMember.has_google ? "YES" : "NO"}`);

    console.log(`\n⚠️  This will:`);
    console.log(
      `  1. Move ${fromMember.submission_count} submissions from member ${fromId} to ${toId}`
    );
    console.log(`  2. Move any awards from member ${fromId} to ${toId}`);
    console.log(`  3. Move any tank presets from member ${fromId} to ${toId}`);
    console.log(`  4. Delete member ${fromId} (${fromMember.display_name})`);
    console.log(`  5. Member ${toId} will keep their credentials unchanged\n`);

    // Perform migration in transaction
    console.log("Starting migration...\n");

    await withTransaction(async (db: Database) => {
      // Migrate submissions
      const subResult = await db.run("UPDATE submissions SET member_id = ? WHERE member_id = ?", [
        toId,
        fromId,
      ]);
      console.log(`✓ Migrated ${subResult.changes} submissions`);

      // Migrate awards (if any)
      const awardResult = await db.run("UPDATE awards SET member_id = ? WHERE member_id = ?", [
        toId,
        fromId,
      ]);
      if (awardResult.changes > 0) {
        console.log(`✓ Migrated ${awardResult.changes} awards`);
      }

      // Migrate tank presets (if any)
      const tankResult = await db.run("UPDATE tank_presets SET member_id = ? WHERE member_id = ?", [
        toId,
        fromId,
      ]);
      if (tankResult.changes > 0) {
        console.log(`✓ Migrated ${tankResult.changes} tank presets`);
      }

      // Delete old member (cascades to password_account, google_account, sessions, auth_codes)
      const deleteResult = await db.run("DELETE FROM members WHERE id = ?", [fromId]);
      console.log(`✓ Deleted member ${fromId}\n`);
    });

    // Verify migration
    console.log("Verifying migration...");
    const finalInfo = await getMemberInfo(toId);
    const oldMember = await getMemberInfo(fromId);

    if (oldMember) {
      console.error(`✗ ERROR: Member ${fromId} still exists!`);
      process.exit(1);
    }

    if (!finalInfo) {
      console.error(`✗ ERROR: Member ${toId} not found after migration!`);
      process.exit(1);
    }

    console.log(`\n✓ Verification passed!`);
    console.log(`\nFinal state of member ${toId}:`);
    console.log(`  Email: ${finalInfo.contact_email}`);
    console.log(`  Name: ${finalInfo.display_name}`);
    console.log(`  Submissions: ${finalInfo.submission_count}`);
    console.log(`  Has Password: ${finalInfo.has_password ? "YES" : "NO"}`);
    console.log(`  Has Google: ${finalInfo.has_google ? "YES" : "NO"}`);

    console.log(`\n✓ Migration complete!`);
    console.log(
      `\nMember ${fromId} (${fromMember.display_name} - ${fromMember.contact_email}) has been deleted.`
    );
    console.log(
      `Member ${toId} (${finalInfo.display_name} - ${finalInfo.contact_email}) now has all data.`
    );
  } catch (error) {
    console.error("\n✗ Migration failed:", error);
    console.error("\nTransaction has been rolled back.");
    process.exit(1);
  }
}

// Get arguments
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: npm run script scripts/merge-members.ts <from_member_id> <to_member_id>");
  console.error("Example: npm run script scripts/merge-members.ts 7 15");
  process.exit(1);
}

const fromId = parseInt(args[0]);
const toId = parseInt(args[1]);

if (isNaN(fromId) || isNaN(toId)) {
  console.error("Error: Member IDs must be numbers");
  process.exit(1);
}

if (fromId === toId) {
  console.error("Error: Cannot merge a member into itself");
  process.exit(1);
}

mergeMembers(fromId, toId).then(() => {
  process.exit(0);
});
