import { test, expect } from "./fixtures";

const year = new Date().getFullYear() - 1;

for (const width of [320, 375, 390, 400, 430, 1280]) {
  test(`annual year menu stays beside its title at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 732 });
    await page.goto(`/annual/${year}/fish`);
    const trigger = page.getByRole("button", { name: String(year), exact: true });
    const menu = page.getByRole("navigation", { name: "Standings year", exact: true });
    await expect(
      page.getByRole("heading", { name: `Annual Standings for ${year}`, exact: true })
    ).toBeVisible();
    await expect(trigger).toHaveAccessibleDescription("Choose a standings year");
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const triggerBox = (await trigger.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(Math.abs(menuBox.y - triggerBox.y - triggerBox.height - 6)).toBeLessThan(1);
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(732);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width < 640) {
      const programs = page.getByRole("navigation", { name: "Standings program" });
      const programBox = (await programs.boundingBox())!;
      const headingBox = (await page
        .getByRole("heading", { name: "Breeder Awards Program", exact: true })
        .boundingBox())!;
      expect(programBox.y + programBox.height).toBeLessThanOrEqual(headingBox.y);
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(8, 650);
    await expect(menu).toBeHidden();
  });
}

test("year navigation preserves the program and program navigation preserves the year", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/annual/${year}/plant`);
  await page.getByRole("button", { name: String(year), exact: true }).click();
  await page
    .getByRole("navigation", { name: "Standings year", exact: true })
    .getByRole("link", { name: String(year - 1), exact: true })
    .click();
  await expect(page).toHaveURL(`/annual/${year - 1}/plant`);
  await page
    .getByRole("navigation", { name: "Standings program" })
    .getByRole("link", { name: "Coral", exact: true })
    .click();
  await expect(page).toHaveURL(`/annual/${year - 1}/coral`);
  await expect(
    page.getByRole("heading", { name: "Coral Awards Program", exact: true })
  ).toBeVisible();
});

test("year menu supports keyboard selection and remains anchored after resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/annual/${year}/fish`);
  const trigger = page.getByRole("button", { name: String(year), exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("navigation", { name: "Standings year", exact: true });
  await expect(menu.getByRole("link", { name: String(year), exact: true })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 732 });
  await expect
    .poll(async () => {
      const triggerBox = (await trigger.boundingBox())!;
      const menuBox = (await menu.boundingBox())!;
      return Math.abs(menuBox.y - triggerBox.y - triggerBox.height - 6);
    })
    .toBeLessThan(1);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/annual/2015/fish");
  await page.getByRole("button", { name: "2015", exact: true }).click();
  await expect(menu.getByRole("link", { name: "2015", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/annual/${year + 1}/fish`);
});

test("year menu closes when its title scrolls off a short screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 200 });
  await page.goto(`/annual/${year}/fish`);
  const trigger = page.getByRole("button", { name: String(year), exact: true });
  const menu = page.getByRole("navigation", { name: "Standings year", exact: true });
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.mouse.move(8, 190);
  await page.mouse.wheel(0, 250);
  await expect
    .poll(async () => {
      const box = (await trigger.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(0);
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("year menu fits the visible viewport after pinch zoom", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 732 });
  await page.goto(`/annual/${year}/fish`);
  const trigger = page.getByRole("button", { name: String(year), exact: true });
  const menu = page.getByRole("navigation", { name: "Standings year", exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 3 });
  await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBe(3);
  await expect(menu).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewport = window.visualViewport!;
        const trigger = document.getElementById("annual-year-trigger")!.getBoundingClientRect();
        const menu = document.getElementById("annual-year-menu")!.getBoundingClientRect();
        const right = viewport.offsetLeft + viewport.width;
        const bottom = viewport.offsetTop + viewport.height;
        return {
          triggerVisible:
            trigger.left >= viewport.offsetLeft &&
            trigger.right <= right &&
            trigger.top >= viewport.offsetTop &&
            trigger.bottom <= bottom,
          menuVisible:
            menu.left >= viewport.offsetLeft &&
            menu.right <= right &&
            menu.top >= viewport.offsetTop &&
            menu.bottom <= bottom,
        };
      })
    )
    .toEqual({ triggerVisible: true, menuVisible: true });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("future-year pages include their selected year without extending the year range", async ({
  page,
}) => {
  const futureYear = year + 10;
  await page.goto(`/annual/${futureYear}/fish`);
  await page.getByRole("button", { name: String(futureYear), exact: true }).click();
  const menu = page.getByRole("navigation", { name: "Standings year", exact: true });
  const selected = menu.getByRole("link", { name: String(futureYear), exact: true });
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link")).toHaveCount(year + 1 - 2015 + 2);
});
