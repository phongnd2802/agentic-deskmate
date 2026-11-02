import { expect, test, type Page } from "@playwright/test";

import { readCredentials, signIn } from "./auth";

test.describe.configure({ timeout: 120_000 });

/** Create a link in Settings and return its path, as the Admin would copy it. */
async function linkFrom(page: Page, trigger: () => Promise<void>): Promise<string> {
  await trigger();
  const url = await page.getByLabel(/^Link for /).inputValue();
  return new URL(url).pathname;
}

test("an Admin invites a person who becomes a Member, and a Member sees no Admin settings", async ({ page, browser }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await page.goto("/settings");
  const email = `invited-${Date.now()}@example.com`;
  await page.getByLabel("Email", { exact: true }).fill(email);
  const path = await linkFrom(page, () => page.getByRole("button", { name: "Create Invitation link" }).click());
  expect(path).toMatch(/^\/invite\//);

  // A signed-out person opens the link.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(path);
  await guest.getByLabel("New password").fill("member-pass-1");
  await guest.getByRole("button", { name: "Set password" }).click();
  await expect(guest.getByRole("status")).toContainText(email);
  await guest.getByRole("link", { name: "Go to sign in" }).click();
  await signIn(guest, { email, password: "member-pass-1" });

  await expect(guest.getByRole("link", { name: "Settings" })).toHaveCount(0);
  expect((await guest.goto("/settings"))?.status()).toBe(404);

  // The link works once.
  const again = await (await browser.newContext()).newPage();
  await again.goto(path);
  await expect(again.getByRole("alert").filter({ hasText: "already been used" })).toBeVisible();
});

test("an Admin creates a password reset link that signs the User out and sets a new password", async ({ page, browser }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  const email = `reset-${Date.now()}@example.com`;
  const invited = await page.request.post("/api/backend/invitations", { data: { email }, failOnStatusCode: true });
  const accepted = await page.request.post(`/api/backend/invitations/${(await invited.json()).token}/accept`, { data: { password: "member-pass-1" } });
  expect(accepted.status()).toBe(204);

  const member = await (await browser.newContext()).newPage();
  await signIn(member, { email, password: "member-pass-1" });

  await page.goto("/settings");
  const path = await linkFrom(page, () => page.getByRole("button", { name: `Create password reset link for ${email}` }).click());
  expect(path).toMatch(/^\/reset\//);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(path);
  await guest.getByLabel("New password").fill("changed-pass-1");
  await guest.getByRole("button", { name: "Set password" }).click();
  await expect(guest.getByRole("status")).toContainText(email);
  await signIn(guest, { email, password: "changed-pass-1" });

  // The old session ended.
  await member.goto("/chat");
  await expect(member).toHaveURL(/\/sign-in/);
});
