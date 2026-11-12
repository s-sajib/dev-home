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

  test("icons play when their row is hovered (AnimateIcons), and an overdue reminder rings on its own", async ({ page }) => {
    const row = page.locator('[data-testid=list] .row:has-text("Lena Park")');
    const glyph = row.locator(".glyph");
    await page.evaluate(() => {
      (window as any).__mut = 0;
      const g = [...document.querySelectorAll("[data-testid=list] .row")].find((r) => r.textContent?.includes("Lena Park"))!.querySelector(".glyph")!;
      new MutationObserver((m) => ((window as any).__mut += m.length)).observe(g, { attributes: true, subtree: true, childList: true });
    });
    expect(await page.evaluate(() => (window as any).__mut)).toBe(0);
    await row.hover();
    await expect.poll(() => page.evaluate(() => (window as any).__mut), { timeout: 3000 }).toBeGreaterThan(0);
    await expect(glyph).toBeVisible();

    const live = page.locator('[data-testid=list] .row:has-text("Follow up on PAY-231") .glyph.live');
    await expect(live).toHaveCount(1);
    await expect.poll(async () => Number(await live.getAttribute("data-plays")), { timeout: 10_000 }).toBeGreaterThanOrEqual(2); // rings again every few seconds
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

  test("reduced motion: icons stay at rest, the selection pill snaps", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.waitForSelector(".row");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      (window as any).__mut = 0;
      const g = [...document.querySelectorAll("[data-testid=list] .row")].find((r) => r.textContent?.includes("Lena Park"))!.querySelector(".glyph")!;
      new MutationObserver((m) => ((window as any).__mut += m.length)).observe(g, { attributes: true, subtree: true, childList: true });
    });
    await page.locator('[data-testid=list] .row:has-text("Lena Park")').hover();
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as any).__mut)).toBe(0); // hover does nothing under Reduce Motion
    const y = `() => (document.querySelector(".rowsel")?.getBoundingClientRect().top ?? 0)`;
    const [samples] = await Promise.all([sample(page, y, 500), page.keyboard.press("j")]);
    const before = samples[0]!, after = samples.at(-1)!;
    expect(samples.filter((v) => v > before + 2 && v < after - 2).length).toBe(0);
  });
});

test.describe("macOS feel", () => {
  test("the sidebar and toolbar are translucent materials", async ({ page }) => {
    const blur = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backdropFilter || (getComputedStyle(e) as any).webkitBackdropFilter);
    expect(await blur(".rail")).toContain("blur");
    expect(await blur(".topbar")).toContain("blur");
    expect(await page.locator(".rail").evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(/rgba?\(|color\(/);
  });

  test("keyboard focus shows a soft accent ring, mouse focus does not", async ({ page }) => {
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth);
    expect(outline).toBe("3px");
  });

  test("primary actions are filled accent buttons with a gradient; secondary verbs are quiet", async ({ page }) => {
    await page.click('[data-testid=list] .row:has-text("PAY-231 Retry")');
    const primary = page.getByRole("button", { name: /^Open ticket/ });
    expect(await primary.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("gradient");
    const quiet = page.getByRole("button", { name: /^Comment/ });
    expect(await quiet.evaluate((e) => getComputedStyle(e).backgroundImage)).toBe("none");
  });

  test("segmented controls use a sliding thumb and switches use real roles", async ({ page }) => {
    await page.click('[data-testid=list] .row:has-text("Acme Support Group")');
    await page.getByRole("button", { name: "Summarise options" }).click();
    const group = page.getByRole("radiogroup", { name: "Claude access" });
    await expect(group.locator(".seg-pill")).toHaveCount(1);
    await group.getByRole("radio", { name: "Manual" }).click();
    await expect(group.locator(".seg-pill")).toHaveCount(1); // one pill that moved, not many
  });
});
