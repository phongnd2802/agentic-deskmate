import { expect, test, type Page } from "@playwright/test";

import { readCredentials, signIn } from "./auth";

// These tests span several sign-ins and first compiles under Next dev, which outlast the default 30s in CI.
test.describe.configure({ timeout: 120_000 });

async function openChat(page: Page) {
  const ready = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/copilotkit/info");
  await page.goto("/chat");
  await ready;
}

/** Ask in a fresh Conversation and return its ID, the AG-UI threadId the browser sent. */
async function ask(page: Page, question: string): Promise<string> {
  const run = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/agent/default/run"));
  const composer = page.getByRole("textbox").first();
  await composer.fill(question);
  await composer.press("Enter");
  const threadId = (await run).postDataJSON().threadId as string;
  await expect(page.getByText("The walking skeleton is working.")).toBeVisible({ timeout: 30_000 });
  return threadId;
}

test("the composer locks after an Answer and a new Conversation can be started", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  await ask(page, "Lock the composer");

  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("This Conversation has its Answer.")).toBeVisible();

  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByRole("textbox").first()).toBeVisible();
  await expect(page.getByText("The walking skeleton is working.")).toHaveCount(0);
});

test("a reopened Conversation is read-only Markdown with no agent run, and is private to its owner", async ({ browser, page }) => {
  const { a, b } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const question = `Reopen me ${Date.now()}`;
  const threadId = await ask(page, question);

  // The list shows it, and opening it from the list is a read-only page.
  const list = page.getByRole("navigation", { name: "Conversations" });
  await expect(list.getByRole("link", { name: question })).toBeVisible();

  const runtimeCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/copilotkit/agent")) runtimeCalls.push(request.url());
  });
  await list.getByRole("link", { name: question }).click();
  // Next dev compiles the page on first visit.
  await expect(page).toHaveURL(new RegExp(`/chat/${threadId}$`), { timeout: 60_000 });
  await page.reload();

  await expect(page.getByLabel("Question")).toHaveText(question);
  await expect(page.getByRole("heading", { name: "Scripted Answer" })).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "def greet" })).toBeVisible();
  await expect(page.getByText("**CopilotRuntime**")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(runtimeCalls).toEqual([]);

  // Another User sees neither the Conversation in their list nor its page, even knowing the ID.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, b);
  await openChat(otherPage);
  await expect(otherPage.getByRole("link", { name: question })).toHaveCount(0);
  expect((await otherPage.goto(`/chat/${threadId}`))?.status()).toBe(404);
  await expect(otherPage.getByLabel("Question")).toHaveCount(0);
  await other.close();
});

test("a second question is refused and the Chat page shows why", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const threadId = await ask(page, "The only question");

  // The composer is locked, so send the second question into the same Conversation from a new page.
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.route("**/api/copilotkit/agent/default/run", async (route) => {
    const body = route.request().postDataJSON();
    await route.continue({ postData: JSON.stringify({ ...body, threadId }) });
  });
  const composer = page.getByRole("textbox").first();
  await composer.fill("A second question");
  await composer.press("Enter");

  await expect(page.locator("p[role=alert]")).toContainText("This Conversation already has a question");
});
