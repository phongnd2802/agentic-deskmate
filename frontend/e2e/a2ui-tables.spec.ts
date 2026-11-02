import { expect, test, type Page } from "@playwright/test";

import { openChat, readCredentials, signIn, submit } from "./auth";

test.describe.configure({ timeout: 120_000 });

const UI_MODEL = "E2E Provider · e2e-ui-model";

async function ask(page: Page, question: string): Promise<string> {
  await page.getByLabel("Model").selectOption({ label: UI_MODEL });
  await page.getByRole("textbox").first().fill(question);
  return submit(page);
}

async function expectTable(page: Page) {
  const region = page.getByRole("region", { name: "Sales by region" });
  const table = region.getByRole("table", { name: "Sales by region" });
  await expect(table.getByRole("columnheader")).toHaveText(["Region", "Sales"]);
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("cell")).toHaveText(["North", "120", "South", "340", "Central", "90"]);
  // Nothing in the catalog acts, so nothing here could start a run; scrolling is reachable from the keyboard.
  await expect(region.getByRole("button")).toHaveCount(0);
  await region.focus();
  await expect(region).toBeFocused();
  return region;
}

test("a table renders in one run, and reopens with no run", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const runs: string[] = [];
  page.on("request", (request) => request.method() === "POST" && request.url().endsWith("/agent/default/run") && runs.push(request.url()));

  const threadId = await ask(page, "[table] Compare sales by region");
  await expect(page.getByText("Here is the table.")).toBeVisible({ timeout: 30_000 });
  await expectTable(page);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(runs).toHaveLength(1);

  const reopened = await page.context().newPage();
  const calls: string[] = [];
  reopened.on("request", (request) => new URL(request.url()).pathname.startsWith("/api/copilotkit") && calls.push(request.url()));
  await reopened.goto(`/chat/${threadId}`);
  await expect(reopened.getByText("Here is the table.")).toBeVisible();
  await expectTable(reopened);
  expect(calls).toEqual([]);
});

test("an unknown component fails the Answer with a Retry, and the retry shows the table", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  await ask(page, `[table-bad] Compare ${Date.now()}`);

  await expect(page.locator("p[role=alert]")).toContainText("The Model could not finish the Answer", { timeout: 30_000 });
  await expect(page.getByText("Unknown component")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.getByRole("button", { name: "Retry" }).click();
  await expectTable(page);
});
