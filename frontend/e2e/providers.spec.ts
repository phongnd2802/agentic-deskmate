import { expect, test } from "@playwright/test";

import { openChat, readCredentials, signIn, submit } from "./auth";

// These tests span a sign-in and first compiles under Next dev, which outlast the default 30s in CI.
test.describe.configure({ timeout: 120_000 });

test("an Admin adds a Provider, a User picks its Model, the Answer names it, and deleting it leaves the Answer readable", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  const name = `Acme ${Date.now()}`;

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add Provider" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("API type").selectOption("anthropic");
  await page.getByLabel("API key").fill("sk-e2e-secret");
  await page.getByLabel("Model ID").fill("model-one");
  await page.getByRole("button", { name: "Add Model" }).click();
  await page.getByLabel("Model ID").nth(1).fill("model-two");

  // A loopback address is refused with a message the Admin can act on, and nothing is saved.
  await page.getByLabel("Base URL").fill("http://127.0.0.1:11434/v1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("form", { name: "Add Provider" }).getByRole("alert")).toContainText("private or loopback");

  await page.getByLabel("Base URL").fill("https://8.8.8.8/v1");
  await page.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("model-one, model-two");
  await expect(page.getByText("sk-e2e-secret")).toHaveCount(0);

  // The Model is in the composer; the Answer is written by it and says so.
  await openChat(page);
  await page.getByLabel("Model", { exact: true }).selectOption({ label: `${name} · model-two` });
  await page.getByRole("textbox").first().fill("Which Model wrote this?");
  const threadId = await submit(page);
  await expect(page.getByText("The walking skeleton is working.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("This Conversation has its Answer.")).toBeVisible();
  await expect(page.getByText(`${name} · model-two`).first()).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(name)).toHaveCount(0);

  await page.goto(`/chat/${threadId}`);
  await expect(page.getByLabel("Answer")).toContainText(`${name} · model-two`);
  await expect(page.getByText("The walking skeleton is working.")).toBeVisible();
});

test("an Organization with no Provider sees a clear message in Chat", async ({ page }) => {
  const { c } = readCredentials();
  await signIn(page, c);
  await page.goto("/chat");
  await expect(page.getByText("Your Organization has no Provider yet")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("textbox")).toHaveCount(0);
});
