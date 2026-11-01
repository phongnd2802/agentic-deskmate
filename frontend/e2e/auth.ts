import { readFileSync } from "node:fs";
import { Page } from "@playwright/test";

export type Credentials = { email: string; password: string };

export function readCredentials(): { a: Credentials; b: Credentials } {
  return JSON.parse(readFileSync("test-results/e2e-credentials.json", "utf8"));
}

export async function signIn(page: Page, { email, password }: Credentials) {
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /sign in|đăng nhập/i }).click();
  await page.waitForURL("**/chat");
}
