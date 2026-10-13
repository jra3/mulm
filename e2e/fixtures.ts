import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import {
  TEST_USER,
  TEST_ADMIN,
  ensureTestUserExists,
  removeOwnedMembers,
} from "./helpers/testData";
import { configureE2EDatabase } from "./helpers/database";
import { startWorkerPortal } from "./helpers/portal";

export interface TestMember {
  id: number;
  email: string;
  password: string;
  displayName: string;
}

export const test = base.extend<
  {
    members: { member: TestMember; committee: TestMember };
    member: TestMember;
    committee: TestMember;
  },
  { portal: string }
>({
  portal: [
    async ({}, use) => {
      const portal = await startWorkerPortal();
      try {
        await use(portal.baseURL);
      } finally {
        await portal.stop();
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ portal }, use) => use(portal),
  members: [
    async ({ portal }, use, testInfo) => {
      if (!portal) throw new Error("Missing owned Portal");
      configureE2EDatabase();
      const owned: number[] = [];
      const create = async (committee: boolean): Promise<TestMember> => {
        const credentials = {
          email: `${process.env.MULM_E2E_RUN}-${testInfo.workerIndex}-${randomUUID()}@example.invalid`,
          password: "TestPassword123!",
          displayName: committee ? "E2E Test Admin" : "E2E Test User",
        };
        const id = await ensureTestUserExists(
          credentials.email,
          credentials.password,
          credentials.displayName,
          committee
        );
        owned.push(id);
        return { ...credentials, id };
      };
      try {
        const member = await create(false);
        const committee = await create(true);
        // Compatibility for existing specs; these objects are private to this
        // worker and assigned before its beforeEach hooks. New specs use fixtures.
        Object.assign(TEST_USER, member);
        Object.assign(TEST_ADMIN, committee);
        await use({ member, committee });
      } finally {
        await removeOwnedMembers(owned);
      }
    },
    { auto: true },
  ],
  member: async ({ members }, use) => use(members.member),
  committee: async ({ members }, use) => use(members.committee),
});
export { expect };
export type { Page } from "@playwright/test";
