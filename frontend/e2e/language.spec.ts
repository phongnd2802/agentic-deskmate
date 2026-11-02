import { expect, test } from "@playwright/test";

import en from "../messages/en.json";
import vi from "../messages/vi.json";
import { openChat, readCredentials, signIn } from "./auth";

test("the language is chosen in the User menu, saved on the User and follows them to a new browser", async ({ page, browser }) => {
  // b's Organization has a Provider, so Chat mounts and CopilotChat labels can be checked.
  const { b } = readCredentials();
  await signIn(page, b);
  await openChat(page);
  const nav = (name: string) => page.getByRole("navigation", { name });
  const placeholder = (text: string) => page.getByPlaceholder(text);
  await expect(nav(en.workspace.navLabel)).toBeVisible();
  await expect(placeholder(en.chat.inputPlaceholder)).toBeVisible();

  try {
    await page.getByRole("button", { name: en.userMenu.menuLabel }).click();
    await page.getByRole("menuitemradio", { name: "Tiếng Việt" }).click();
    await expect(nav(vi.workspace.navLabel)).toBeVisible();
    await expect(placeholder(vi.chat.inputPlaceholder)).toBeVisible();
    await expect(page).toHaveURL(/\/chat$/);

    // A fresh browser has no cookie and asks for English, yet the User chose Vietnamese.
    const other = await browser.newContext({ locale: "en-US" });
    const otherPage = await other.newPage();
    await signIn(otherPage, b);
    await expect(otherPage.getByRole("navigation", { name: vi.workspace.navLabel })).toBeVisible();
    await other.close();
  } finally {
    // Back to English, so tests that share this User read English even when a step above failed.
    await page.getByRole("button", { name: /User menu|Menu người dùng/ }).click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(nav(en.workspace.navLabel)).toBeVisible();
  }

  // Signing out forgets the language cookie, so the next User on this browser starts from the browser's language.
  await page.getByRole("button", { name: en.userMenu.menuLabel }).click();
  await page.getByRole("menuitem", { name: en.userMenu.signOut }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await page.context().cookies()).find((c) => c.name === "NEXT_LOCALE")).toBeUndefined();
});
