import { expect, test } from "@playwright/test";

import { readCredentials, signIn } from "./auth";

test("a second session cannot read a run through /connect, and no session is refused", async ({ browser }) => {
  const { emailA, passwordA, emailB, passwordB } = readCredentials();

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await signIn(pageA, emailA, passwordA);

  let threadId: string | null = null;
  pageA.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/api/copilotkit")) return;
    try {
      const body = req.postDataJSON() as { threadId?: string; runId?: string } | null;
      if (body?.threadId && body?.runId && !threadId) threadId = body.threadId;
    } catch {
      // ignore non-JSON
    }
  });

  await pageA.goto("/chat");
  await pageA.waitForResponse((r) => new URL(r.url()).pathname === "/api/copilotkit/info");
  const composer = pageA.getByRole("textbox").first();
  await composer.fill("What is this skeleton?");
  await composer.press("Enter");
  await expect(pageA.getByText("The walking skeleton is working.")).toBeVisible({ timeout: 30000 });
  expect(threadId).toBeTruthy();

  const runBody = {
    threadId,
    runId: "connect-b",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };

  // Second signed-in user: no answer content.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await signIn(pageB, emailB, passwordB);
  const respB = await pageB.request.post("/api/copilotkit/agent/default/connect", { data: runBody });
  const textB = await respB.text();
  expect(textB).not.toContain("Scripted Answer");

  // No session at all: refused.
  const ctxC = await browser.newContext();
  const respC = await ctxC.request.post("/api/copilotkit/agent/default/connect", { data: runBody });
  const textC = await respC.text();
  expect(textC).not.toContain("Scripted Answer");

  // No session on /run is also refused.
  const respRun = await ctxC.request.post("/api/copilotkit/agent/default/run", {
    data: { ...runBody, messages: [{ id: "m1", role: "user", content: "hi" }] },
  });
  expect(respRun.ok()).toBeFalsy();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});