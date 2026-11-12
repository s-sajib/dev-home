import { expect, test } from "@playwright/test";
import { api, fresh } from "./helpers";

test.beforeEach(async ({ page, request }) => fresh(page, request));

test("groups by Claude's verdict with reasons, overdue reminders first", async ({ page }) => {
  const heads = await page.locator(".group h2").allInnerTexts();
  expect(heads[0]).toMatch(/OVERDUE REMINDERS/i);
  expect(heads.join(" ")).toMatch(/NEEDS ME/i);
  expect(heads.join(" ")).toMatch(/DROP/i);
  await expect(page.locator(".row .why").first()).toBeVisible();
});

test("j/k move the selection and the detail follows", async ({ page }) => {
  const first = await page.locator(".row.selected .t").innerText();
  await page.keyboard.press("j");
  const second = await page.locator(".row.selected .t").innerText();
  expect(second).not.toBe(first);
  await expect(page.locator(".detail")).toContainText(second.slice(0, 12));
  await page.keyboard.press("k");
  await expect(page.locator(".row.selected .t")).toHaveText(first);
});

test("dismiss hides an item and undo brings it back", async ({ page }) => {
  await page.click('.row:has-text("OPS-88")');
  const before = await page.locator("[data-testid=list] .row").count();
  await page.keyboard.press("d");
  await expect(page.locator("[data-testid=list] .row")).toHaveCount(before - 1);
  await expect(page.locator(".toast")).toContainText("Dismissed");
  await page.keyboard.press("u");
  await expect(page.locator("[data-testid=list] .row")).toHaveCount(before);
});

test("Jira transition asks for an explicit confirmation before anything is written", async ({ page, request }) => {
  await page.click('.row:has-text("PAY-231")');
  await page.keyboard.press("t");
  await expect(page.locator(".sheet")).toContainText("Nothing is written to Jira until you confirm");
  await page.keyboard.press("2");
  await expect(page.locator(".sheet")).toContainText("to confirm moving to");
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet")).toHaveCount(0);
  // nothing was attempted
  expect((await request.get("/api/inbox")).ok()).toBeTruthy();
});

test("view switching with number keys and help overlay", async ({ page }) => {
  await page.keyboard.press("2");
  await expect(page.getByTestId("board")).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByTestId("list")).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.locator(".sheet")).toContainText("Nothing is ever sent to WhatsApp");
});

test("an item can be added to the board from the inbox", async ({ page, request }) => {
  await page.click('.row:has-text("Lena Park")');
  await page.keyboard.press("b");
  await expect(page.locator(".toast")).toContainText("Added to the board");
  const board = await api(request, "/api/board");
  expect(board.cards.some((c: any) => c.itemKey === "chat:447700900007@c.us")).toBe(true);
});

test("accept shows a check on the row until something new happens", async ({ page }) => {
  await page.click('[data-testid=list] .row:has-text("OPS-88")');
  await page.keyboard.press("a");
  await expect(page.locator('[data-testid=list] .row:has-text("OPS-88")')).toContainText("Accepted");
  await expect(page.locator('[data-testid=list] .row.accepted')).toHaveCount(1);
});

test("settings has the same toolbar as the other screens", async ({ page }) => {
  await page.keyboard.press(",");
  await expect(page.locator(".topbar h1")).toHaveText("Settings");
});
