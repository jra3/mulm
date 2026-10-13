import { expect, type Page } from "@playwright/test";
import { login, type TestUser } from "./auth";
import { fillTomSelectTypeahead, selectTomSelectMultiple } from "./tomSelect";

export type PropagationProgram = "Plant" | "Coral";
export const propagationData = {
  Plant: {
    water: "Fresh",
    speciesClass: "Cryptocoryne",
    common: "Wendt's Cryptocoryne",
    latin: "Cryptocoryne wendtii",
    method: "Cuttings",
    light: ["LED", "200W", "16"],
  },
  Coral: {
    water: "Salt",
    speciesClass: "Hard",
    common: "Small Polyp Stony Coral",
    latin: "Acropora millepora",
    method: "Fragmentation",
    light: ["T5", "400W", "12"],
  },
};

export async function selectSpeciesType(page: Page, type: PropagationProgram): Promise<void> {
  await page.locator('[name="water_type"]').selectOption(propagationData[type].water);
  // Retaining the element proves an outerHTML replacement really happened;
  // seeing the selected value alone could still be the outgoing form.
  const outgoing = await page.locator("#bapForm").elementHandle();
  await page.locator('[name="species_type"]').selectOption(type);
  await expect.poll(() => outgoing!.evaluate((element) => element.isConnected)).toBe(false);
  await outgoing!.dispose();
  await expect(page.locator('[name="species_type"]')).toHaveValue(type);
  await expect(page.locator('[name="species_class"]')).toBeVisible();
  await expect(page.locator('[name="species_common_name"]')).toHaveClass(/tomselected/);
  await expect(page.locator('[name="species_latin_name"]')).toHaveClass(/tomselected/);
}

export async function openSubmissionForm(
  page: Page,
  member: TestUser,
  type: PropagationProgram
): Promise<void> {
  await login(page, member);
  await page.goto("/submissions/new");
  await expect(page.locator("#bapForm")).toBeVisible();
  await selectSpeciesType(page, type);
}

export async function choosePropagationSpecies(
  page: Page,
  type: PropagationProgram
): Promise<void> {
  const data = propagationData[type];
  await page.locator('[name="reproduction_date"]').fill(new Date().toISOString().split("T")[0]);
  await fillTomSelectTypeahead(page, "species_common_name", data.common, true);
  await expect(page.locator('[name="species_latin_name"]')).toHaveValue(data.latin);
  await expect(page.locator('[name="species_class"]')).toHaveValue(data.speciesClass);
}

export async function fillPropagationDetails(page: Page, type: PropagationProgram): Promise<void> {
  const coral = type === "Coral";
  const data = propagationData[type];
  const fields: Record<string, string> = {
    propagation_method: data.method,
    light_type: data.light[0],
    light_strength: data.light[1],
    light_hours: data.light[2],
    tank_size: coral ? "50 gallon" : "20 gallon",
    filter_type: coral ? "Sump" : "Sponge filter",
    water_change_volume: coral ? "20%" : "25%",
    water_change_frequency: coral ? "Bi-weekly" : "Weekly",
    temperature: coral ? "78" : "76",
    ph: coral ? "8.2" : "7.0",
    gh: coral ? "N/A" : "150",
    substrate_type: coral ? "Sand" : "Soil",
    substrate_depth: coral ? "1 inch" : "2 inches",
    substrate_color: coral ? "White" : "Dark",
  };
  if (coral) {
    fields.specific_gravity = "1.025";
    await selectTomSelectMultiple(page, "foods", ["Live"]);
  }
  for (const [name, value] of Object.entries(fields))
    await page.locator(`input[name="${name}"]`).fill(value);
}

export async function saveSubmission(page: Page, draft = false): Promise<void> {
  await page
    .locator(draft ? 'button[name="draft"]' : 'button[type="submit"]')
    .filter({ hasText: draft ? "Save Draft" : /^Submit$/ })
    .click();
  await expect(page).toHaveURL(draft ? /\/member\/\d+$/ : /\/submissions\/\d+$/);
}

export async function expectSubmissionError(page: Page, field: string): Promise<void> {
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.locator(`#${field}-error`)).toBeVisible();
  await expect(page.locator("#bapForm")).toBeVisible();
}
