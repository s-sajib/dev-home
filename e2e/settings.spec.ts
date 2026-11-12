import { expect, test } from "@playwright/test";
import { fresh } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await fresh(page, request);
  await page.keyboard.press(",");
  await expect(page.locator(".settings")).toBeVisible();
});

test("edit a number, see the source badge, reject a bad value inline, reset", async ({ page }) => {
  await page.locator(".snav button", { hasText: "Rules" }).click();
  const field = page.locator(".field", { hasText: "Reply owed after" });
  await field.locator("input").fill("12");
  await field.locator("input").blur();
  await expect(field.locator(".src-badge.saved")).toBeVisible();
  await field.locator("input").fill("9999");
  await field.locator("input").blur();
  await expect(field.locator(".ferr")).toContainText("maximum");
  await field.locator("input").fill("12");
  await field.locator("input").blur();
  await field.getByRole("button", { name: "reset" }).click();
  await expect(field.locator(".src-badge.default")).toBeVisible();
});

test("turning flags off removes items from the inbox immediately", async ({ page }) => {
  await page.locator(".snav button", { hasText: "Rules" }).click();
  for (const label of ["Stale ticket", "Assigned to you"]) {
    await page.locator(`.checks label:has-text("${label}") input`).click();
    await expect(page.locator(`.checks label:has-text("${label}") input`)).toBeChecked();
  }
  await page.getByRole("button", { name: "Back to inbox" }).click();
  await expect(page.locator('.row:has-text("WEB-402")')).toHaveCount(0);
});

test("rebinding a key works and duplicates are refused", async ({ page }) => {
  await page.locator(".snav button", { hasText: "Keyboard" }).click();
  await page.locator(".keyrow", { hasText: "Dismiss" }).locator("button").click();
  await page.keyboard.press("e");
  await expect(page.locator(".keyrow", { hasText: "Dismiss" }).locator("kbd")).toHaveText("e");
  await page.locator(".keyrow", { hasText: "Snooze" }).locator("button").click();
  await page.keyboard.press("e");
  await expect(page.locator(".ferr")).toContainText("used by both");
  await page.getByRole("button", { name: "Back to inbox" }).click();
  const before = await page.locator("[data-testid=list] .row").count();
  await page.keyboard.press("d");
  await page.waitForTimeout(300);
  expect(await page.locator("[data-testid=list] .row").count()).toBe(before); // old key does nothing
  await page.keyboard.press("e");
  await expect(page.locator("[data-testid=list] .row")).toHaveCount(before - 1);
});

test("theme setting switches the whole app", async ({ page }) => {
  await page.locator(".snav button", { hasText: "General" }).click();
  await page.locator(".field", { hasText: "Theme" }).locator("select").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(241, 242, 244)"); // #f1f2f4, the site's light background
  await page.locator(".field", { hasText: "Theme" }).locator("select").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(dark).toBe("rgb(18, 17, 15)"); // #12110f, the site's dark background
});

test("tokens and connection tests: secrets are never shown", async ({ page }) => {
  await page.locator(".snav button", { hasText: "Jira" }).click();
  await page.getByRole("button", { name: "Test Jira" }).click();
  await expect(page.locator(".test")).toContainText("not configured");
  await page.getByPlaceholder("paste token").fill("super-secret-token-123");
  await page.getByRole("button", { name: "Save to Keychain" }).click();
  await expect(page.locator(".secret .good")).toContainText("set");
  expect(await page.content()).not.toContain("super-secret-token-123");
});
