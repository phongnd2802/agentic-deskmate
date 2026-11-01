import { expect, test } from "@playwright/test";

import { readCredentials, signIn } from "./auth";

const VI_NAV = ["Bảng điều khiển", "Trò chuyện", "Agent", "Cơ sở tri thức"];

test("the sidebar offers every area and the non-Chat ones are placeholders", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
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

test("a signed-out visitor is sent to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("no registration page exists", async ({ request }) => {
  const response = await request.get("/register");
  expect(response.status()).toBe(404);
});

test("the user menu signs out and the old session stops working", async ({ page, context, request }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  const session = (await context.cookies()).find((c) => c.name === "session")!;
  const withOldCookie = { headers: { cookie: `session=${session.value}` } };
  expect((await request.get("/api/copilotkit/info", withOldCookie)).ok()).toBeTruthy();

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await request.get("/api/copilotkit/info", withOldCookie)).status()).toBe(401);
});

test.describe("browser language", () => {
  test.use({ locale: "vi-VN" });

  test("the interface follows the browser language", async ({ page }) => {
    const { a } = readCredentials();
    await signIn(page, a);
    await page.goto("/chat");

    const nav = page.getByRole("navigation", { name: "Không gian làm việc" });
    await expect(nav.getByRole("link")).toHaveText(VI_NAV);
  });
});

test("the NEXT_LOCALE cookie overrides the browser language", async ({ page, context, baseURL }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await context.addCookies([{ name: "NEXT_LOCALE", value: "vi", url: baseURL! }]);
  await page.goto("/chat");

  const nav = page.getByRole("navigation", { name: "Không gian làm việc" });
  await expect(nav.getByRole("link")).toHaveText(VI_NAV);
});
