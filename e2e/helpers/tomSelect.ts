import { expect, type Page } from "@playwright/test";

export async function fillTomSelectTypeahead(
  page: Page,
  fieldName: string,
  searchText: string,
  exactMatch = false,
  waitForFieldLinking = true
): Promise<void> {
  const select = page.locator(`select[name="${fieldName}"]`);
  await expect(select).toHaveClass(/tomselected/);
  const wrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
  if ((await select.inputValue()) !== searchText) {
    await wrapper.locator(".ts-control").click();
    await wrapper.locator(".ts-control input").fill(searchText);
    // Locator retries cover both a fresh API response and Tom Select's cache.
    // Exclude the free-text "Add" option: this action chooses a catalogue Name.
    const options = wrapper.locator(".ts-dropdown .option");
    const option = exactMatch
      ? options
          .filter({
            has: page.locator(`span.font-medium`, {
              hasText: new RegExp(`^${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
            }),
          })
          .first()
      : options.filter({ hasText: searchText }).first();
    await expect(option).toBeVisible();
    const value = await option.getAttribute("data-value");
    if (!value) throw new Error(`Name option has no value: ${searchText}`);
    await option.click();
    await expect(select).toHaveValue(value);
    await expect(wrapper.locator(".ts-dropdown")).toBeHidden();
  }
  if (
    waitForFieldLinking &&
    /^species_(common|latin)_name$/.test(fieldName) &&
    (await page.locator("#bapForm").count())
  ) {
    await expect(page.locator('input[name="species_id"]')).not.toHaveValue("");
    await expect(page.locator("#species-binding-notice")).toBeVisible();
  }
}

export async function selectTomSelectOption(
  page: Page,
  fieldName: string,
  value: string
): Promise<void> {
  const select = page.locator(`select[name="${fieldName}"]`);
  await expect(select).toHaveClass(/tomselected/);
  const wrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
  await wrapper.locator(".ts-control").click();
  const option = wrapper.locator(".ts-dropdown .option").filter({ hasText: value }).first();
  await expect(option).toBeVisible();
  const selected = await option.getAttribute("data-value");
  await option.click();
  await expect(select).toHaveValue(selected!);
}

export async function selectTomSelectMultiple(
  page: Page,
  fieldName: string,
  values: string[]
): Promise<void> {
  const select = page.locator(`select[name="${fieldName}"]`);
  await expect(select).toHaveClass(/tomselected/);
  const wrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
  for (const value of values) {
    await wrapper.locator(".ts-control input").click();
    await wrapper.locator(".ts-control input").press("ArrowDown");
    const option = wrapper.locator(".ts-dropdown .option").filter({ hasText: value }).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(wrapper.locator(".ts-control .item").filter({ hasText: value })).toBeVisible();
  }
  await expect(select).toHaveValues(values);
}

export async function getTomSelectValue(page: Page, fieldName: string): Promise<string | null> {
  return page.locator(`select[name="${fieldName}"]`).inputValue();
}

export async function clearTomSelect(page: Page, fieldName: string): Promise<void> {
  const wrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
  await wrapper.locator(".ts-control").click();
  await wrapper.locator(".ts-control input").press("Backspace");
  await expect(page.locator(`select[name="${fieldName}"]`)).toHaveValue("");
}

/** Explicit free text: unlike choosing a Name, this must not bind a Species. */
export async function createTomSelectValue(
  page: Page,
  fieldName: string,
  value: string
): Promise<void> {
  const wrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
  await expect(page.locator(`select[name="${fieldName}"]`)).toHaveClass(/tomselected/);
  await wrapper.locator(".ts-control").click();
  await wrapper.locator(".ts-control input").fill(value);
  await wrapper.locator(".ts-dropdown .create").click();
  await expect(page.locator(`select[name="${fieldName}"]`)).toHaveValue(value);
}
