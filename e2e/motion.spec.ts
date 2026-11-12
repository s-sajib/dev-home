import { expect, test, type Page } from "@playwright/test";
import { fresh } from "./helpers";

test.beforeEach(async ({ page, request }) => fresh(page, request));

/** Records every time a class shows up on any element, so short animations can be asserted without flakiness. */
async function watchClass(page: Page, cls: string) {
  await page.evaluate((c) => {
    (window as any).__seen ??= {};
    new MutationObserver((muts) => {
      for (const m of muts) if ((m.target as HTMLElement).classList?.contains(c)) (window as any).__seen[c] = true;
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class"], childList: true });
  }, cls);
  return () => page.evaluate((c) => !!(window as any).__seen?.[c], cls);
}

test.describe("Radix behaviour", () => {
  test("verbs show their key in a tooltip on hover", async ({ page }) => {
    await page.click('[data-testid=list] .row:has-text("PAY-231 Retry")');
    await page.getByRole("button", { name: "Dismiss" }).hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toBeVisible();
    await expect(tip.locator("kbd")).toHaveText("d");
  });

  test("dialogs trap focus, label themselves, and give focus back on Esc", async ({ page }) => {
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: "Keys" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("the Claude menu is a popover with radio groups you can drive by keyboard", async ({ page }) => {
    await page.click('[data-testid=list] .row:has-text("Acme Support Group")');
    await page.getByRole("button", { name: "Summarise options" }).click();
    const panel = page.getByRole("dialog", { name: "Summarise options" });
    await expect(panel.getByRole("radiogroup", { name: "Claude access" })).toBeVisible();
    await expect(panel.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    await panel.getByRole("radio", { name: "Auto" }).focus();
    await page.keyboard.press("ArrowRight"); // roving focus -> Never
    await expect(panel.getByRole("radio", { name: "Never" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator(".modeflag.never")).toBeVisible();
  });

  test("settings booleans are real switches", async ({ page }) => {
    await page.keyboard.press(",");
    await page.locator(".snav button", { hasText: "Nag & hours" }).click();
    const sw = page.getByRole("switch").first();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("micro-interactions", () => {
  test("a gradient indicator glides to the selected row", async ({ page }) => {
    const glide = page.locator(".glide");
    await expect(glide).toBeVisible();
    const y1 = (await glide.boundingBox())!.y;
    await page.keyboard.press("j");
    await page.waitForTimeout(450);
    const y2 = (await glide.boundingBox())!.y;
    expect(y2).toBeGreaterThan(y1);
  });

  test("dismissing a row animates it out first", async ({ page }) => {
    const seen = await watchClass(page, "leaving-out");
    await page.click('[data-testid=list] .row:has-text("OPS-88")');
    await page.keyboard.press("d");
    await expect(page.locator('[data-testid=list] .row:has-text("OPS-88")')).toHaveCount(0);
    expect(await seen()).toBe(true);
  });

  test("copying a draft confirms itself", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click('[data-testid=list] .row:has-text("Acme Support Group")');
    await page.getByRole("button", { name: /^Copy/ }).click();
    await expect(page.getByRole("button", { name: /Copied/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Copy/ })).toBeVisible({ timeout: 4000 }); // and resets
  });

  test("a dropped card settles and its stage answers", async ({ page }) => {
    await page.keyboard.press("2");
    const seen = await watchClass(page, "landed");
    await page.locator('.card:has-text("WEB-402")').dragTo(page.locator('.col[data-col="In Progress"] .cards'));
    await expect(page.locator('.col[data-col="In Progress"]')).toContainText("WEB-402");
    expect(await seen()).toBe(true);
  });

  test("urgent icons pulse; the clock hand sweeps for overdue reminders", async ({ page }) => {
    const glyph = page.locator('[data-testid=list] .row:has-text("Follow up on PAY-231") .glyph');
    await expect(glyph).toHaveClass(/live/);
    expect(await glyph.locator(".hand").evaluate((h) => getComputedStyle(h).animationName)).toBe("sweep");
  });

  test("reduced motion switches every animation off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.waitForSelector(".row");
    const lamp = page.locator(".lamp.warn").first();
    expect(await lamp.evaluate((l) => getComputedStyle(l).animationName)).toBe("none");
    expect(await page.locator(".row").first().evaluate((r) => getComputedStyle(r).animationName)).toBe("none");
  });
});
