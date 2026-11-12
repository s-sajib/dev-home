import { expect, test } from "@playwright/test";
import { fresh } from "./helpers";

test.beforeEach(async ({ page, request }) => fresh(page, request));

test("one object, one representation: the ticket looks the same in the inbox, on the board and in the drawer", async ({ page }) => {
  const row = page.locator('[data-testid=list] .row:has-text("OPS-88")');
  await expect(row.getByRole("img", { name: "Ticket" })).toBeVisible();
  await page.keyboard.press("2");
  const card = page.locator('.card:has-text("OPS-88")');
  await expect(card.getByRole("img", { name: "Ticket" })).toBeVisible();
  await card.dblclick();
  await expect(page.getByTestId("drawer").locator(".kicker")).toContainText("Ticket · OPS-88");
  // the same verbs are offered in the drawer as in the inbox
  await expect(page.getByTestId("drawer").getByRole("button", { name: /^Move/ })).toBeVisible();
});

test("every object type has its own glyph", async ({ page }) => {
  await expect(page.locator('[data-testid=list] .row:has-text("Follow up on PAY-231")').getByRole("img", { name: "Reminder" })).toBeVisible();
  await expect(page.locator('[data-testid=list] .row:has-text("Acme Support Group")').getByRole("img", { name: "Conversation" })).toBeVisible();
  await expect(page.locator('[data-testid=list] .row:has-text("Bump eslint")').getByRole("img", { name: "Pull request" })).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.locator('.card:has-text("Hotfix: invoice rounding")').getByRole("img", { name: "Note" })).toBeVisible();
});

test("relationships are visible and navigable: ticket -> conversation -> back", async ({ page }) => {
  await page.click('.row:has-text("PAY-231 Retry")');
  const rel = page.locator(".rel");
  await expect(rel).toContainText("Acme Support Group");
  await expect(rel).toContainText("Follow up on PAY-231");
  await expect(rel).toContainText("On the board");
  await rel.locator('[data-key="chat:120363@g.us"]').click();
  await expect(page.getByTestId("chat")).toBeVisible();
  await expect(page.locator(".rel")).toContainText("PAY-231"); // and the conversation links back to its ticket
  await page.locator('.rel [data-key="ticket:PAY-231"]').click();
  await expect(page.locator(".ov h3.title")).toContainText("PAY-231");
});

test("verbs depend on the object: tickets can be moved and commented, reminders completed, chats summarised", async ({ page }) => {
  await page.click('.row:has-text("PAY-231 Retry")');
  await expect(page.getByRole("button", { name: /^Move/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Comment/ })).toBeVisible();
  await page.click('.row:has-text("Follow up on PAY-231")');
  await expect(page.getByRole("button", { name: /^Complete/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move/ })).toHaveCount(0);
  await page.click('.row:has-text("Lena Park")');
  await expect(page.locator(".split-btn > button").first()).toContainText("Summarise");
});

test("urgency is shown as light, not chips: a lamp dot on the why-line", async ({ page }) => {
  const why = page.locator('.row:has-text("Lena Park") .why');
  await expect(why.locator(".lamp.warn")).toBeVisible();
  expect(await page.locator("[data-testid=list] .chip").count()).toBe(0); // no chip stacks in the list
});
