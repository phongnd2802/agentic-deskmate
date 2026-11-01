import { expect, test, type Page } from "@playwright/test";

import { readCredentials, signIn } from "./auth";

const WIDTHS = [375, 768, 1024, 1440];

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

for (const locale of ["en-US", "vi-VN"]) {
  test.describe(`locale ${locale}`, () => {
    test.use({ locale });

    test("Chat and a reopened Conversation fit every width, with readable text", async ({ page }) => {
      test.setTimeout(120_000);
      const { a } = readCredentials();
      await signIn(page, a);
      await page.goto("/chat");
      const composer = page.getByRole("textbox").first();
      await composer.fill("Layout check");
      const run = page.waitForRequest((request) => request.url().endsWith("/agent/default/run"));
      await composer.press("Enter");
      const threadId = (await run).postDataJSON().threadId as string;
      await expect(page.getByRole("status")).toBeVisible({ timeout: 30_000 });

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await noHorizontalScroll(page);
        // The new UI keeps text at 12px or larger.
        const small = await page.evaluate(() =>
          [...document.querySelectorAll("main aside *, main [role=status], main [role=status] *")]
            .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
            .map((el) => parseFloat(getComputedStyle(el).fontSize))
            .filter((size) => size < 12),
        );
        expect(small).toEqual([]);
      }

      await page.goto(`/chat/${threadId}`);
      await expect(page.getByLabel(/Question|Câu hỏi/)).toBeVisible({ timeout: 60_000 });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await noHorizontalScroll(page);
      }
    });
  });
}

test("on touch the list controls reach 44px, and the keyboard shows a focus ring", async ({ browser, baseURL }) => {
  const { a } = readCredentials();
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  await signIn(page, a);
  await page.goto("/chat");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  const button = page.getByRole("button", { name: "New conversation" });
  await expect(button).toBeVisible();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const links = page.getByRole("navigation", { name: "Conversations" }).getByRole("link");
  if ((await links.count()) > 0) expect((await links.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await context.close();

  const desktop = await browser.newContext({ baseURL });
  const desktopPage = await desktop.newPage();
  await signIn(desktopPage, a);
  await desktopPage.goto("/chat");
  const first = desktopPage.getByRole("navigation", { name: "Conversations" }).getByRole("link").first();
  await first.focus();
  await desktopPage.keyboard.press("Shift+Tab");
  await desktopPage.keyboard.press("Tab");
  await expect(first).toBeFocused();
  expect(await first.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
  await desktop.close();
});
