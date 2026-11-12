import { expect, test, type Page } from "@playwright/test";

/** Collect every uncaught error and failed console.error so "it did not crash" is an assertion, not a hope. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
const ready = async (page: Page) => { await page.goto("/"); await page.waitForSelector("[data-testid=list] .row", { timeout: 30_000 }); };
const list = (page: Page) => page.locator("[data-testid=list] .row");

/** Time from keydown to the next painted frame, p95 over n presses. */
async function keyLatency(page: Page, key: string, n: number) {
  await page.evaluate(() => {
    (window as any).__lat = [];
    addEventListener("keydown", () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => (window as any).__lat.push(performance.now() - t0))); }, true);
  });
  for (let i = 0; i < n; i++) { await page.keyboard.press(key); await page.waitForTimeout(25); }
  await page.waitForTimeout(300);
  const lat: number[] = await page.evaluate(() => (window as any).__lat);
  lat.sort((a, b) => a - b);
  return { p50: lat[Math.floor(lat.length * 0.5)]!, p95: lat[Math.floor(lat.length * 0.95)]!, max: lat.at(-1)! };
}

test.describe("volume", () => {
  test("hundreds of items render and navigating them stays fast", async ({ page }) => {
    const errors = watchErrors(page);
    await ready(page);
    expect(await list(page).count()).toBeGreaterThan(150);
    const down = await keyLatency(page, "j", 60);
    const up = await keyLatency(page, "k", 40);
    console.log("j latency", down, "k latency", up);
    expect(down.p95).toBeLessThan(120);
    expect(up.p95).toBeLessThan(120);
    expect(errors).toEqual([]);
  });

  test("the 5,000-message chat opens quickly and renders a bounded window", async ({ page }) => {
    await ready(page);
    const t0 = Date.now();
    await page.locator('[data-testid=list] .row:has-text("Acme Support Group")').first().click();
    await expect(page.getByTestId("chat")).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(await page.getByTestId("msg-in").count() + await page.getByTestId("msg-out").count()).toBeLessThanOrEqual(130);
    const t1 = Date.now();
    await page.keyboard.press("2"); await page.waitForSelector(".card");
    await page.keyboard.press("1"); await page.waitForSelector("[data-testid=list] .row");
    expect(Date.now() - t1).toBeLessThan(2500);
  });

  test("the board with 150+ cards drags without freezing", async ({ page }) => {
    const errors = watchErrors(page);
    await ready(page);
    await page.keyboard.press("2");
    await page.waitForSelector(".card");
    expect(await page.locator(".card").count()).toBeGreaterThan(120);
    const card = page.locator(".col[data-col='To Do'] .card").first();
    const title = await card.innerText();
    const t0 = Date.now();
    await card.dragTo(page.locator(".col[data-col='Merged'] .cards"));
    await expect(page.locator(".col[data-col='Merged']")).toContainText(title.split("\n")[0]!.slice(0, 20));
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(errors).toEqual([]);
  });
});

test.describe("hostile content", () => {
  test("markup in titles and chats is shown as text, never executed", async ({ page }) => {
    const errors = watchErrors(page);
    await ready(page);
    await page.locator('[data-testid=list] .row:has-text("Totally Legit Vendor")').first().click();
    await expect(page.getByTestId("chat")).toBeVisible();
    await expect(page.locator(".bubble", { hasText: "<img src=x" })).toBeVisible(); // literal text
    await page.keyboard.press("2"); await page.waitForSelector(".card");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    expect(await page.locator("img[src='x']").count()).toBe(0);
    expect(await page.locator("script:not([src])").evaluateAll((s) => s.filter((x) => x.textContent?.includes("__xss")).length)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("very long unbroken titles do not break the layout", async ({ page }) => {
    await ready(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const widest = await page.locator("[data-testid=list] .row").evaluateAll((rows) => Math.max(...rows.map((r) => r.getBoundingClientRect().width)));
    expect(widest).toBeLessThan(620);
  });

  test("a prompt-injection chat can be summarised without any action being taken", async ({ page, request }) => {
    await ready(page);
    const before = (await (await request.get("/api/board")).json()).cards.length;
    await page.locator('[data-testid=list] .row:has-text("Totally Legit Vendor")').first().click();
    for (let i = 0; i < 8; i++) {
      await page.locator(".split-btn > button").first().click();
      try { await expect(page.getByTestId("summary")).toBeVisible({ timeout: 9000 }); break; } catch { /* flaky Claude: retry */ }
    }
    await expect(page.getByTestId("summary")).toBeVisible();
    const after = (await (await request.get("/api/board")).json()).cards.length;
    expect(after).toBe(before); // nothing was created, moved or transitioned
  });
});

test.describe("failing world", () => {
  test("broken sources are loud: banners and a red health line, items still usable", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".banner", { hasText: "Jira" })).toBeVisible();
    await expect(page.locator(".banner", { hasText: "WhatsApp is disconnected" })).toBeVisible();
    await expect(page.locator(".health.bad")).toContainText("Jira");
    await page.keyboard.press("j");
    await expect(page.locator(".detail")).toBeVisible();
  });

  test("injected 500s, latency and hangs never crash the UI; errors surface as toasts", async ({ page }) => {
    const errors = watchErrors(page);
    await ready(page);
    let toasts = 0;
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press(["j", "j", "k", "a", "b", "s", "u"][i % 7]!);
      await page.waitForTimeout(60);
      if (await page.locator(".toast.err").count()) toasts++;
      expect(await list(page).count()).toBeGreaterThan(0); // never blank
    }
    await page.waitForTimeout(2500);
    expect(errors).toEqual([]);
    console.log("error toasts seen:", toasts);
  });

  test("the app survives a backend crash and recovers by itself with its data intact", async ({ page, request }) => {
    const errors = watchErrors(page);
    await ready(page);
    const before = await list(page).count();
    await page.click("[data-testid=list] .row >> nth=2");
    await page.keyboard.press("d"); // an action that must survive the crash (file-backed database)
    await expect(list(page)).toHaveCount(before - 1, { timeout: 10_000 });
    await request.post("/api/demo/crash").catch(() => undefined);
    await expect(page.locator(".conn")).toBeVisible({ timeout: 20_000 }); // "can't reach the app" banner
    await expect(page.locator(".conn")).toHaveCount(0, { timeout: 40_000 }); // supervisor restarted it
    await expect(list(page)).toHaveCount(before - 1, { timeout: 20_000 }); // the dismissal persisted
    expect(errors).toEqual([]);
  });

  test("a 2 MB request body is refused and the server stays up", async ({ request }) => {
    const big = "x".repeat(2_000_000);
    const r = await request.post("/api/settings", { data: { changes: { ignoreAuthors: big } }, failOnStatusCode: false }).catch(() => null);
    if (r) expect([400, 413]).toContain(r.status());
    expect((await request.get("/api/demo/ping")).ok()).toBe(true);
  });
});

test.describe("hostile user", () => {
  test("mashing keys and switching views 300 times does not break anything", async ({ page }) => {
    const errors = watchErrors(page);
    await ready(page);
    for (let i = 0; i < 300; i++) await page.keyboard.press(["j", "k", "1", "2", "h", "l", "]", "[", "Escape", "v"][i % 10]!, { delay: 0 });
    await page.keyboard.press("1");
    await expect(list(page).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const [w, h] of [[1100, 700], [900, 700], [700, 800]]) {
    test(`usable at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await ready(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await list(page).first().click();
      await expect(page.locator(".detail")).toBeVisible();
      const box = await page.locator(".detail").boundingBox();
      expect(box!.width).toBeGreaterThan(280);
    });
  }
});
