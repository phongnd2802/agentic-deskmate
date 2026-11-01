import { expect, test } from "@playwright/test";

const FINAL_LINE = "The walking skeleton is working.";

test("a question streams a Markdown Answer with formatted code", async ({ page }) => {
  const ready = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/copilotkit/info");
  await page.goto("/chat");
  await ready;

  const composer = page.getByRole("textbox").first();
  await composer.fill("What is this skeleton?");

  // Start sampling inside the page before the run, so no part of the Answer can
  // be missed: a proxy that buffered it would show it missing or already complete,
  // never in two distinct partial states.
  const answerStates = page.evaluate(
    ({ finalLine }) =>
      new Promise<string[]>((resolve) => {
        const states: string[] = [];
        const timer = setInterval(() => {
          // textContent is cheap; innerText would force a layout on every sample.
          const text = document.querySelector("main")?.textContent ?? "";
          const start = text.indexOf("Scripted Answer");
          if (start === -1) return;

          const state = text.slice(start);
          if (states.at(-1) !== state) states.push(state);
          if (state.includes(finalLine)) {
            clearInterval(timer);
            resolve(states);
          }
        }, 10);
        setTimeout(() => {
          clearInterval(timer);
          resolve(states);
        }, 30_000);
      }),
    { finalLine: FINAL_LINE },
  );

  await composer.press("Enter");
  const states = await answerStates;

  const partialStates = states.filter((state) => !state.includes(FINAL_LINE));
  expect(
    partialStates.length,
    "the Answer must be visible in at least two distinct non-final states, or it was buffered somewhere",
  ).toBeGreaterThanOrEqual(2);

  await expect(page.getByRole("heading", { name: "Scripted Answer" })).toBeVisible();
  await expect(page.getByText("CopilotRuntime")).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "def greet" })).toBeVisible();
});
