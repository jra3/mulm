import { test, expect } from "./fixtures";
import { getSubmissionsForMember } from "./helpers/testData";
import {
  openSubmissionForm,
  choosePropagationSpecies,
  fillPropagationDetails,
  saveSubmission,
  expectSubmissionError,
  propagationData,
} from "./helpers/submissionForm";

const program = "Plant";

test.describe("Plant Submissions", () => {
  test.beforeEach(async ({ page, member }) => {
    await openSubmissionForm(page, member, program);
  });

  test("should show Plant-specific fields (propagation method, lighting) and hide Fish fields", async ({
    page,
  }) => {
    for (const field of [
      "propagation_method",
      "light_type",
      "light_strength",
      "light_hours",
      "co2",
    ]) {
      await expect(page.locator(`[name="${field}"]`)).toBeVisible();
    }
    await expect(page.locator('[name="count"]')).toHaveCount(0);
    await expect(page.locator('[name="spawn_locations"]')).toHaveCount(0);
    await expect(page.locator('[name="foods"]')).toHaveCount(0);
  });

  test("should show 'Date Propagated' label instead of 'Date Spawned'", async ({ page }) => {
    await expect(page.locator('label[for="reproduction_date"]')).toContainText("Propagated");
    await expect(page.locator('label[for="reproduction_date"]')).not.toContainText("Spawned");
  });

  test("should allow saving a draft with partial Plant data", async ({ page, member }) => {
    await choosePropagationSpecies(page, program);
    await saveSubmission(page, true);
    const submissions = await getSubmissionsForMember(member.id);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      species_type: program,
      species_class: propagationData[program].speciesClass,
      submitted_on: null,
    });
  });

  test("should require propagation_method for Plant submission", async ({ page, member }) => {
    await choosePropagationSpecies(page, program);
    await fillPropagationDetails(page, program);
    await page.locator('[name="propagation_method"]').fill("");
    await expectSubmissionError(page, "propagation_method");
    expect(await getSubmissionsForMember(member.id)).toHaveLength(0);
  });

  test("should require all lighting fields for Plant submission", async ({ page, member }) => {
    await choosePropagationSpecies(page, program);
    await fillPropagationDetails(page, program);
    await page.locator('[name="light_hours"]').fill("");
    await expectSubmissionError(page, "light_hours");
    expect(await getSubmissionsForMember(member.id)).toHaveLength(0);
  });

  test("should require CO2 description when CO2=yes", async ({ page, member }) => {
    await choosePropagationSpecies(page, program);
    await fillPropagationDetails(page, program);
    await page.locator('[name="co2"]').selectOption("yes");
    await expect(page.locator('[name="co2_description"]')).toBeVisible();
    await expectSubmissionError(page, "co2_description");
    expect(await getSubmissionsForMember(member.id)).toHaveLength(0);
  });

  test("should successfully submit complete Plant form", async ({ page, member }) => {
    await choosePropagationSpecies(page, program);
    await fillPropagationDetails(page, program);
    await saveSubmission(page);
    const submissions = await getSubmissionsForMember(member.id);
    expect(submissions).toHaveLength(1);
    const data = propagationData[program];
    expect(submissions[0]).toMatchObject({
      species_type: program,
      program: program.toLowerCase(),
      water_type: data.water,
      species_common_name: data.common,
      species_latin_name: data.latin,
      propagation_method: data.method,
      light_type: data.light[0],
      light_strength: data.light[1],
      light_hours: data.light[2],
      witness_verification_status: "pending",
      count: null,
    });
    expect(submissions[0].submitted_on).toBeTruthy();
    expect(submissions[0].species_id).toBeTruthy();
  });

  test("should allow adding supplement rows dynamically", async ({ page }) => {
    const rows = page.locator('input[name="supplement_type"]');
    await expect(rows.first()).toBeVisible();
    const initial = await rows.count();
    await page.getByRole("button", { name: "Add another supplement" }).click();
    await expect(rows).toHaveCount(initial + 1);
  });
});
