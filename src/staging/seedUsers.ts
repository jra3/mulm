import { generateRandomCode, makePasswordEntry } from "../auth";
import {
  createMember,
  createOrUpdatePassword,
  getMemberByEmail,
  updateMember,
} from "../db/members";
import { deleteSessionsForMember } from "../db/sessions";
import { clearFailedAttempts } from "../services/accountLockout";

export const STAGING_ADMIN_EMAIL = "baptest+admin@porcnick.com";
export const STAGING_MEMBER_EMAIL = "baptest+e2e@porcnick.com";

type Login = { email: string; password: string };
export type StagingCredentials = { admin: Login; member: Login };

/**
 * Give the staging test accounts fresh random passwords, creating them if a
 * prod restore left them out. Staging is public and holds prod data, so a known
 * password there is a real admin login: every run rotates both passwords, and
 * ends the accounts' sessions and lockouts. No other account is touched.
 *
 * Refuses to run anywhere but staging.
 */
export async function seedStagingUsers(
  env: Record<string, string | undefined>
): Promise<StagingCredentials> {
  if (env.STAGING !== "1") {
    throw new Error("Refusing to seed: STAGING is not 1, so this is not staging");
  }
  return {
    admin: await ensureLogin(STAGING_ADMIN_EMAIL, "Staging Test Admin", true),
    member: await ensureLogin(STAGING_MEMBER_EMAIL, "Staging Test User", false),
  };
}

async function ensureLogin(email: string, name: string, isAdmin: boolean): Promise<Login> {
  const password = generateRandomCode(24);
  const existing = await getMemberByEmail(email);
  if (!existing) {
    await createMember(email, name, { password }, isAdmin);
    return { email, password };
  }
  await updateMember(existing.id, { display_name: name, is_admin: isAdmin ? 1 : 0 });
  await createOrUpdatePassword(existing.id, await makePasswordEntry(password));
  await clearFailedAttempts(existing.id);
  await deleteSessionsForMember(existing.id);
  return { email, password };
}
