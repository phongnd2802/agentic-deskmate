import { readFileSync } from "node:fs";
import { expect, Page, Request } from "@playwright/test";

export type Credentials = { email: string; password: string };

export function readCredentials(): { a: Credentials; b: Credentials; c: Credentials } {
  return JSON.parse(readFileSync("test-results/e2e-credentials.json", "utf8"));
}

export async function signIn(page: Page, { email, password }: Credentials) {
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /sign in|đăng nhập/i }).click();
  await page.waitForURL("**/chat");
}

/** Open Chat with the composer ready: Enter is ignored until the agent connects. */
export async function openChat(page: Page) {
  // Leave first, so the page that sign-in redirected to cannot answer the wait below.
  await page.goto("about:blank");
  const connected = page.waitForResponse((response) => response.url().endsWith("/agent/default/connect"));
  await page.goto("/chat");
  await connected;
}

/** Send what the composer holds and return the Conversation ID, the AG-UI threadId the browser sent. */
export async function submit(page: Page): Promise<string> {
  let threadId: string | undefined;
  const onRequest = (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/agent/default/run")) threadId = request.postDataJSON().threadId;
  };
  page.on("request", onRequest);
  // shortcut: a cold page can ignore Enter with no signal we can wait for, so press again. An accepted Enter
  // empties the composer, so this never sends twice. Replace it if CopilotKit exposes a ready state.
  await expect
    .poll(
      async () => {
        if (!threadId) await page.getByRole("textbox").first().press("Enter");
        return threadId;
      },
      { timeout: 30_000, intervals: [2_000] },
    )
    .toBeTruthy();
  page.off("request", onRequest);
  return threadId!;
}
