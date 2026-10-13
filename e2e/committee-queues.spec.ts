import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { login } from "./helpers/auth";
import { createTestSubmission } from "./helpers/submissions";

/** Measure the rendered label, including every wrapped line, against its tap target. */
async function expectLabelFits(control: Locator) {
  await expect(control).toBeVisible();
  const geometry = await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      height: box.height,
      fits: Array.from(range.getClientRects()).every((line) =>
        line.left >= box.left - 1 && line.right <= box.right + 1 &&
        line.top >= box.top - 1 && line.bottom <= box.bottom + 1
      ),
    };
  });
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.fits).toBe(true);
}

for (const width of [320, 390]) {
  test(`committee actions fit their touch targets at ${width}px`, async ({ page, member, committee }) => {
    await page.setViewportSize({ width, height: 844 });
    const waiting = await createTestSubmission({ memberId: member.id, submitted: true, witnessed: true, witnessedBy: committee.id, reproductionDaysAgo: 1, bound: true });
    const ready = await createTestSubmission({ memberId: member.id, submitted: true, witnessed: true, witnessedBy: committee.id, bound: true });
    const pending = await createTestSubmission({ memberId: member.id, submitted: true, bound: true });
    const approved = await createTestSubmission({ memberId: member.id, submitted: true, witnessed: true, witnessedBy: committee.id, approved: true, approvedBy: committee.id, bound: true });
    await login(page, committee);

    await page.goto(`/submissions/${waiting}`);
    const actions = page.locator("#adminPanel .submission-actions");
    await expectLabelFits(actions.getByRole("link", { name: "Correct species and points" }));
    await expectLabelFits(actions.getByRole("button", { name: "Request Changes" }));
    await expectLabelFits(actions.getByRole("button", { name: "Delete", exact: true }));
    const positions = await actions.locator(":scope > *").evaluateAll((elements) => elements.map((e) => {
      const { top, bottom } = e.getBoundingClientRect();
      return { top, bottom };
    }));
    expect(positions[1].top).toBeGreaterThan(positions[0].bottom);
    expect(positions[2].top).toBeGreaterThan(positions[1].bottom);

    await page.goto(`/submissions/${pending}`);
    await expectLabelFits(page.locator("#witness-confirm"));
    await expect(page.locator("#witness-confirm")).toHaveCSS("height", "48px");
    await expect(page.locator("#witness-confirm")).toHaveCSS("font-size", "16px");
    await page.locator("label:has(#witness-species-yes)").click();
    await page.locator("label:has(#witness-points-15)").click();
    await expect(page.locator("#witness-confirm")).toHaveText("Confirm witness · 15 pts");
    await expectLabelFits(page.locator("#witness-confirm"));

    await page.goto(`/submissions/${approved}`);
    await expectLabelFits(page.locator("#correct-points-link"));
    await expectLabelFits(page.getByRole("button", { name: "Edit Approved Submission" }));

    await page.goto("/admin/queue");
    await page.locator(`#queue-row-${ready} summary`).click();
    await page.locator(`#queue-approve-${ready}`).click();
    await expectLabelFits(page.locator(`#queue-confirm-${ready}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("screening All survives panel swaps and confirmation with other programs still pending", async ({ page, member, committee }) => {
  const fish = await createTestSubmission({ memberId: member.id, submitted: true, bound: true });
  const plant = await createTestSubmission({ memberId: member.id, submitted: true, bound: true, speciesType: "Plant" });
  await login(page, committee);
  await page.goto("/admin/witness-queue");
  await page.locator(`#screening-row-${fish} summary`).click();
  await page.locator(`#screening-row-${fish}`).getByRole("link", { name: "Review submission" }).click();
  await page.locator("label:has(#witness-species-yes)").click();
  await page.locator("label:has(#witness-points-15)").click();
  await expect(page.locator("#witness-confirm")).toHaveText("Confirm witness · 15 pts");
  await page.locator("#witness-confirm").click();
  await expect(page).toHaveURL(/\/admin\/witness-queue$/);
  await expect(page.locator(`#screening-row-${fish}`)).toHaveCount(0);
  await expect(page.locator(`#screening-row-${plant}`)).toBeVisible();
});
