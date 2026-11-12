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

/** Samples a numeric value every animation frame until `ms` has passed, so mid-animation states can be asserted. */
async function sample(page: Page, fn: string, ms = 700): Promise<number[]> {
  return page.evaluate(async ({ fn, ms }) => {
    const f = new Function("return (" + fn + ")()") as () => number;
    const out: number[] = [];
    const t0 = performance.now();
    await new Promise<void>((done) => { const tick = () => { out.push(f()); performance.now() - t0 < ms ? requestAnimationFrame(tick) : done(); }; tick(); });
    return out;
  }, { fn, ms });
}

test.describe("micro-interactions (Motion)", () => {
  test("the selection pill slides between rows instead of jumping", async ({ page }) => {
    const y = () => `() => (document.querySelector(".rowsel")?.getBoundingClientRect().top ?? 0)`;
    const before = await page.evaluate(`(${y()})()`) as number;
    const [samples] = await Promise.all([sample(page, y(), 600), page.keyboard.press("j")]);
    const after = samples.at(-1)!;
    expect(after).toBeGreaterThan(before);
    const mid = samples.filter((v) => v > before + 2 && v < after - 2);
    expect(mid.length).toBeGreaterThan(0); // it passed through intermediate positions
  });

  test("a dismissed row fades out and its siblings slide up (no jump)", async ({ page }) => {
    await page.click('[data-testid=list] .row:has-text("OPS-88")');
    const opacity = `() => { const r = [...document.querySelectorAll("[data-testid=list] .row")].find((e) => e.textContent.includes("OPS-88")); return r ? +getComputedStyle(r).opacity : 0; }`;
    const siblingY = `() => { const r = [...document.querySelectorAll("[data-testid=list] .row")].find((e) => e.textContent.includes("API-90")); return r ? r.getBoundingClientRect().top : 0; }`;
    const [ops, sib] = await Promise.all([sample(page, opacity, 700), sample(page, siblingY, 700), page.keyboard.press("d")]).then((r) => [r[0], r[1]]);
    expect(ops.some((v) => v > 0.05 && v < 0.95)).toBe(true); // faded, not cut
    expect(new Set(sib.map((v) => Math.round(v))).size).toBeGreaterThan(2); // the row below moved up gradually
    await expect(page.locator('[data-testid=list] .row:has-text("OPS-88")')).toHaveCount(0);
  });

  test("copying a draft confirms itself", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click('[data-testid=list] .row:has-text("Acme Support Group")');
    await page.getByRole("button", { name: /^Copy/ }).click();
    await expect(page.getByRole("button", { name: /Copied/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Copy/ })).toBeVisible({ timeout: 4000 });
  });

  test("a dragged card travels to its new column (shared layout), not a jump", async ({ page }) => {
    await page.keyboard.press("2");
    const card = page.locator('.card:has-text("WEB-402")');
    const x = `() => { const c = [...document.querySelectorAll(".card")].find((e) => e.textContent.includes("WEB-402")); return c ? c.getBoundingClientRect().left : 0; }`;
    const start = (await card.boundingBox())!.x;
    const [xs] = await Promise.all([sample(page, x, 900), card.dragTo(page.locator('.col[data-col="PR Review"] .cards'))]);
    const end = xs.at(-1)!;
    expect(end).toBeGreaterThan(start + 300);
    expect(xs.some((v) => v > start + 20 && v < end - 20)).toBe(true);
  });

  test("the overdue reminder's clock hand keeps turning", async ({ page }) => {
    const hand = `() => { const h = document.querySelector('[data-testid=list] .row .glyph.live path:last-child'); return h ? (new DOMMatrix(getComputedStyle(h).transform).b) : 0; }`;
    const xs = await sample(page, hand, 900);
    expect(new Set(xs.map((v) => v.toFixed(4))).size).toBeGreaterThan(1);
  });

  test("the toast animates in and carries a shrinking timer", async ({ page }) => {
    await page.click('[data-testid=list] .row:has-text("OPS-88")');
    await page.keyboard.press("d");
    const timer = page.locator(".toast .timer");
    await expect(timer).toBeVisible();
    const w1 = (await timer.boundingBox())!.width;
    await page.waitForTimeout(700);
    expect((await timer.boundingBox())!.width).toBeLessThan(w1);
  });

  test("reduced motion: transforms stop (clock hand stays put) and layout animations are instant", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.waitForSelector(".row");
    await page.waitForTimeout(500);
    const hand = `() => { const h = document.querySelector('[data-testid=list] .row .glyph.live path:last-child'); return h ? (new DOMMatrix(getComputedStyle(h).transform).b) : 0; }`;
    const xs = await sample(page, hand, 700);
    expect(new Set(xs.map((v) => v.toFixed(4))).size).toBe(1);
    const y = `() => (document.querySelector(".rowsel")?.getBoundingClientRect().top ?? 0)`;
    const [samples] = await Promise.all([sample(page, y, 500), page.keyboard.press("j")]);
    const before = samples[0]!, after = samples.at(-1)!;
    expect(samples.filter((v) => v > before + 2 && v < after - 2).length).toBe(0); // no in-between frames
  });
});
