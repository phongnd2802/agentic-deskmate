import { expect, test } from "@playwright/test";

import { openChat, readCredentials, signIn, submit } from "./auth";

test("a second session cannot read a run through /connect, and no session is refused", async ({ browser }) => {
  const { a, b } = readCredentials();

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await signIn(pageA, a);

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

  await openChat(pageA);
  const composer = pageA.getByRole("textbox").first();
  await composer.fill("What is this skeleton?");
  await submit(pageA);
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

  // Positive control: A's own /connect replays the run, so the refusals below mean something.
  const respA = await pageA.request.post("/api/copilotkit/agent/default/connect", { data: { ...runBody, runId: "connect-a" } });
  expect(respA.ok()).toBeTruthy();
  expect(await respA.text()).toContain("Scripted Answer");

  // Second signed-in user: no answer content.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await signIn(pageB, b);
  const respB = await pageB.request.post("/api/copilotkit/agent/default/connect", { data: runBody });
  const textB = await respB.text();
  expect(textB).not.toContain("Scripted Answer");

  // No session at all: refused.
  const ctxC = await browser.newContext();
  const respC = await ctxC.request.post("/api/copilotkit/agent/default/connect", { data: runBody });
  expect(respC.status()).toBe(401);
  expect(await respC.text()).not.toContain("Scripted Answer");

  // Every other runtime route is refused without a session too, /info included.
  expect((await ctxC.request.get("/api/copilotkit/info")).status()).toBe(401);
  // FastAPI's docs are not reachable through the proxy (ADR-0003).
  expect((await ctxC.request.get("/api/backend/docs")).status()).toBe(404);

  // No session on /run is also refused.
  const respRun = await ctxC.request.post("/api/copilotkit/agent/default/run", {
    data: { ...runBody, messages: [{ id: "m1", role: "user", content: "hi" }] },
  });
  expect(respRun.ok()).toBeFalsy();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});