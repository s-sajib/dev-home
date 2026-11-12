import { expect, test } from "@playwright/test";

test("the app boots and demo data loads", async ({ page, request }) => {
  await request.post("/api/demo/reset");
  await page.goto("/");
  await expect(page.locator(".row").first()).toBeVisible();
});
