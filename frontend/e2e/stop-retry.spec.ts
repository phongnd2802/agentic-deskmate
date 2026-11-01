import { expect, test, type Page } from "@playwright/test";

import { openChat, readCredentials, signIn, submit } from "./auth";

// These tests span several runs and first compiles under Next dev, which outlast the default 30s in CI.
test.describe.configure({ timeout: 120_000 });

const FINAL_LINE = "The walking skeleton is working.";

async function askMarked(page: Page, question: string): Promise<string> {
  await page.getByRole("textbox").first().fill(question);
  return submit(page);
}

/** The stored statuses of a Conversation, as its read-only page shows them. */
async function statuses(page: Page, threadId: string): Promise<string[]> {
  const reader = await page.context().newPage();
  try {
    await reader.goto(`/chat/${threadId}`);
    const answers = await reader.getByLabel("Answer").allTextContents();
    return answers.map((text) => (text.includes("Stopped") ? "stopped" : text.includes("Failed") ? "failed" : "complete"));
  } finally {
    await reader.close();
  }
}

test("Stop keeps the partial Answer as stopped, and Retry adds a new Answer", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const threadId = await askMarked(page, `[stall] Stop me ${Date.now()}`);

  await expect(page.getByText("Started writing.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Stopped" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeFocused();
  await expect(page.getByText("Started writing.")).toBeVisible();
  await expect.poll(() => statuses(page, threadId)).toEqual(["stopped"]);

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("textbox").first()).toBeFocused();
  await expect(page.getByText(FINAL_LINE)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => statuses(page, threadId)).toEqual(["stopped", "complete"]);
  await expect(page.getByText("Started writing.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("a Model failure shows a readable error and Retry answers", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const threadId = await askMarked(page, `[fail] Break ${Date.now()}`);

  await expect(page.locator("p[role=alert]")).toContainText("The Model could not finish the Answer");
  await expect(page.locator("p[role=alert]")).not.toContainText("scripted failure");
  await expect.poll(() => statuses(page, threadId)).toEqual(["failed"]);

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(FINAL_LINE)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => statuses(page, threadId)).toEqual(["failed", "complete"]);
});

test("closing the tab mid-run still stores a complete Answer", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const context = page.context();
  const threadId = await askMarked(page, `Close the tab ${Date.now()}`);
  // Mid-run: the Answer has begun but is not finished.
  await expect(page.getByText("Scripted Answer")).toBeVisible({ timeout: 30_000 });
  await page.close();

  const reader = await context.newPage();
  await expect.poll(() => statuses(reader, threadId), { timeout: 30_000 }).toEqual(["complete"]);
});

test("a retry can be stopped like any Answer", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  // The first attempt fails, then the retry stalls.
  const threadId = await askMarked(page, `[fail][stall] Stop the retry ${Date.now()}`);
  await expect(page.locator("p[role=alert]")).toContainText("The Model could not finish the Answer");

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Started writing.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("This Conversation has its Answer.")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Stopped" })).toBeVisible();
  await expect.poll(() => statuses(page, threadId)).toEqual(["failed", "stopped"]);
});

test("a retry refused right after Stop keeps Retry and shows why", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const threadId = await askMarked(page, `[stall] Retry too soon ${Date.now()}`);
  await expect(page.getByText("Started writing.")).toBeVisible({ timeout: 30_000 });

  // The backend may still be winding down the stopped run, so refuse the first retry the way it does then.
  let refused = false;
  await page.route("**/api/copilotkit/agent/default/run", async (route) => {
    if (refused || !route.request().postDataJSON().forwardedProps?.retry) return route.continue();
    refused = true;
    const body = route.request().postDataJSON();
    const events = [
      { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
      { type: "RUN_ERROR", code: "answer_in_progress", message: "An Answer is still being written." },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });

  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByRole("button", { name: "Retry" }).click(); // without waiting for the Answer to be stored

  await expect(page.locator("p[role=alert]")).toContainText("An Answer is still being written.");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(FINAL_LINE)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => statuses(page, threadId)).toEqual(["stopped", "complete"]);
});
