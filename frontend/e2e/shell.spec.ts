import { expect, test } from "@playwright/test";

const VI_NAV = ["Bảng điều khiển", "Trò chuyện", "Agent", "Cơ sở tri thức"];

test("the sidebar offers every area and the non-Chat ones are placeholders", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link")).toHaveText(["Dashboard", "Chat", "Agents", "Knowledge Bases"]);

  for (const [href, title] of [
    ["/dashboard", "Dashboard"],
    ["/agents", "Agents"],
    ["/knowledge-bases", "Knowledge Bases"],
  ]) {
    await page.goto(href);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("This area is coming soon.")).toBeVisible();
  }
});

test.describe("browser language", () => {
  test.use({ locale: "vi-VN" });

  test("the interface follows the browser language", async ({ page }) => {
    await page.goto("/chat");

    const nav = page.getByRole("navigation", { name: "Không gian làm việc" });
    await expect(nav.getByRole("link")).toHaveText(VI_NAV);
  });
});

test("the NEXT_LOCALE cookie overrides the browser language", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "vi", url: baseURL! }]);
  await page.goto("/chat");

  const nav = page.getByRole("navigation", { name: "Không gian làm việc" });
  await expect(nav.getByRole("link")).toHaveText(VI_NAV);
});
