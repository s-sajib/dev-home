import { expect, test } from "@playwright/test";
import { fresh } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await fresh(page, request);
  await page.click('.row:has-text("Acme Support Group")');
  await expect(page.getByTestId("chat")).toBeVisible();
});

test("a chat reads as a conversation: their bubbles left, mine right, mention highlighted", async ({ page }) => {
  const incoming = page.getByTestId("msg-in");
  const outgoing = page.getByTestId("msg-out");
  expect(await incoming.count()).toBeGreaterThanOrEqual(3);
  expect(await outgoing.count()).toBeGreaterThanOrEqual(1);
  const inBox = await incoming.first().boundingBox();
  const outBox = await outgoing.first().boundingBox();
  const chatBox = (await page.getByTestId("chat").boundingBox())!;
  expect(inBox!.x - chatBox.x).toBeLessThan(80); // left aligned
  expect(chatBox.x + chatBox.width - (outBox!.x + outBox!.width)).toBeLessThan(80); // right aligned
  await expect(page.locator(".bubble.mention")).toHaveCount(1);
  await expect(page.locator(".who-name").first()).toBeVisible(); // sender names in groups
  await expect(page.locator(".day").first()).toBeVisible();
});

test("the draft is a dashed 'not sent' bubble and the chat is visibly read-only", async ({ page }) => {
  await expect(page.getByTestId("draft")).toContainText("Draft · not sent");
  await expect(page.locator(".composer")).toContainText("Read-only");
  expect(await page.locator(".composer input, .composer textarea").count()).toBe(0); // no way to type or send
});

const summariseBtn = (page: import("@playwright/test").Page) => page.locator(".split-btn > button").first();
const openOptions = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Summarise options" }).click();

test("auto chat shows a collapsible summary; presets and custom size live in one menu", async ({ page }) => {
  const summary = page.getByTestId("summary");
  await expect(summary).toContainText("Acme's Priya");
  await expect(summary.locator("li")).toHaveCount(0);
  await summary.getByRole("button", { name: /action item/ }).click();
  await expect(summary.locator("li")).toHaveCount(2);
  await openOptions(page);
  const panel = page.getByRole("dialog", { name: "Summarise options" });
  await panel.getByRole("radio", { name: /^100/ }).click();
  await expect(summariseBtn(page)).toContainText("Summarise 100");
  await panel.getByRole("button", { name: "make 100 the default" }).click();
  await expect(panel.getByRole("radio", { name: /^100/ }).locator("i")).toBeVisible();
  await panel.getByPlaceholder("custom").fill("37");
  await expect(summariseBtn(page)).toContainText("Summarise 37");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("per-chat Claude mode: Never disables summarising; w cycles the mode", async ({ page }) => {
  await openOptions(page);
  const panel = page.getByRole("dialog", { name: "Summarise options" });
  await panel.getByRole("radio", { name: "Never" }).click();
  await expect(page.locator(".toast")).toContainText("will not be sent to Claude");
  await expect(summariseBtn(page)).toBeDisabled();
  await expect(page.locator(".modeflag.never")).toBeVisible();
  await panel.getByRole("radio", { name: "Manual" }).click();
  await expect(summariseBtn(page)).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("w"); // manual -> auto
  await expect(page.locator(".modeflag.auto")).toBeVisible();
});

test("a manual chat can be summarised on demand and gets a copy-only draft", async ({ page }) => {
  await page.click('.row:has-text("Lena Park")');
  await expect(page.getByTestId("summary")).toHaveCount(0);
  await summariseBtn(page).click();
  await expect(page.getByTestId("summary")).toContainText("Lena is blocked");
  await expect(page.getByTestId("draft")).toContainText("review the PR");
});
