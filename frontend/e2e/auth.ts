import { readFileSync } from "node:fs";
import { Page } from "@playwright/test";

type Creds = { emailA: string; passwordA: string; emailB: string; passwordB: string };

export function readCredentials(): Creds {
  return JSON.parse(readFileSync("test-results/e2e-credentials.json", "utf8")) as Creds;
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /sign in|đăng nhập/i }).click();
  await page.waitForURL("**/chat");
}