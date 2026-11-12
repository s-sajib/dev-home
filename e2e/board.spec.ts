import { expect, test } from "@playwright/test";
import { api, fresh } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await fresh(page, request);
  await page.keyboard.press("2");
  await expect(page.getByTestId("board")).toBeVisible();
});

test("shows every pipeline column, left to right, with cards placed by the rules", async ({ page }) => {
  const names = await page.locator(".col header h2").allInnerTexts();
  expect(names).toEqual(["Pending", "To Do", "In Progress", "Decision Needed", "PR Review", "Merged", "Deployed Stage", "Ready for Release", "Deployed Prod"]);
  await expect(page.locator('.col[data-col="Decision Needed"]')).toContainText("OPS-88");
  await expect(page.locator('.col[data-col="PR Review"]')).toContainText("PAY-231");
  await expect(page.locator('.col[data-col="Merged"]')).toContainText("DOC-12");
  await expect(page.locator('.col[data-col="Deployed Prod"]')).toContainText("Hotfix: invoice rounding");
});

test("drag and drop moves a card and pins it", async ({ page, request }) => {
  const card = page.locator('.card:has-text("WEB-402")');
  await card.dragTo(page.locator('.col[data-col="In Progress"] .cards'));
  await expect(page.locator('.col[data-col="In Progress"]')).toContainText("WEB-402");
  const board = await api(request, "/api/board");
  const c = board.cards.find((x: any) => x.itemKey === "ticket:WEB-402");
  expect(c.col).toBe("In Progress");
  expect(c.pinned).toBe(true);
  await expect(page.locator('.col[data-col="In Progress"] .pin')).toBeVisible();
});

test("keyboard: select, move right with ], add a card with n", async ({ page, request }) => {
  await page.click('.card:has-text("WEB-402")');
  await page.keyboard.press("]");
  await expect(page.locator('.col[data-col="In Progress"]')).toContainText("WEB-402");
  await page.keyboard.press("n");
  await page.keyboard.type("Write the migration plan");
  await page.keyboard.press("Enter");
  await expect(page.locator(".card", { hasText: "Write the migration plan" })).toBeVisible();
  const board = await api(request, "/api/board");
  expect(board.cards.some((c: any) => c.title === "Write the migration plan")).toBe(true);
});

test("the + button adds a card to that column; the drawer edits notes and removes it", async ({ page }) => {
  await page.getByLabel("Add card to Decision Needed").click();
  await page.keyboard.type("Pick a queue vendor");
  await page.keyboard.press("Enter");
  const card = page.locator('.col[data-col="Decision Needed"] .card', { hasText: "Pick a queue vendor" });
  await expect(card).toBeVisible();
  await card.dblclick();
  const drawer = page.getByTestId("drawer");
  await drawer.getByPlaceholder("Notes…").fill("SQS vs NATS, ask infra");
  await drawer.getByPlaceholder("Notes…").blur();
  await page.keyboard.press("Escape");
  await expect(card).toContainText("SQS vs NATS");
  await card.dblclick();
  await drawer.getByRole("button", { name: "Remove from board" }).click();
  await expect(page.locator(".card", { hasText: "Pick a queue vendor" })).toHaveCount(0);
});

test("changing the pipeline in Settings reshapes the board (Pipeline A drops Ready for Release)", async ({ page }) => {
  await page.keyboard.press(",");
  await page.locator(".snav button", { hasText: /^Board$/ }).click();
  await page.getByRole("button", { name: /Pipeline A/ }).click();
  await page.getByRole("button", { name: "Back to inbox" }).click();
  await page.keyboard.press("2");
  const names = await page.locator(".col header h2").allInnerTexts();
  expect(names).not.toContain("Ready for Release");
  expect(names.at(-1)).toBe("Deployed Prod");
  // the card that lived in the removed column is still visible (first-column fallback), not lost
  await expect(page.locator(".card", { hasText: "Release notes 4.12" })).toBeVisible();
});
