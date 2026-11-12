import type { APIRequestContext, Page } from "@playwright/test";

export async function fresh(page: Page, request: APIRequestContext, path = "/") {
  await request.post("/api/demo/reset");
  await page.goto(path);
  await page.waitForSelector(".row");
}
export const api = async (request: APIRequestContext, p: string) => (await request.get(p)).json();
