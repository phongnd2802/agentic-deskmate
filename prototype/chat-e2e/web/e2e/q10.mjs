// Text fallback: what the User sees when a render tool call goes wrong, live and on reopen.
import { ask, BASE, browser, consoleLog, mark, netlog, save, shot, since } from "./lib.mjs";
const b = await browser();
const out = {};

async function chat(query) {
  const page = await b.newPage({ viewport: { width: 1000, height: 800 } });
  page.net = netlog(page);
  page.con = consoleLog(page);
  await page.goto(`${BASE}/?${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("textarea", { timeout: 120000 });
  await page.waitForTimeout(3500);
  return page;
}

for (const [name, query, prompt] of [
  ["filtered-tool-called-anyway", "nofollow=1", "route:none hallucinate"],
  ["a2ui-unknown-component", "nofollow=1", "badtable"],
  ["ogui-no-html", "nofollow=1", "nohtml"],
]) {
  const m = mark();
  const page = await chat(query);
  await ask(page, prompt);
  await page.waitForTimeout(6000);
  out[name] = {
    prompt,
    modelCalls: since(m, "model_called").map((c) => c.tools),
    frames: await page.locator("iframe.websandbox__frame").count(),
    frameShowsSlider: await page.frameLocator("iframe.websandbox__frame").locator("#val").count().catch(() => 0),
    isRunning: await page.evaluate(() => window.__agent.isRunning),
    body: (await page.locator("body").innerText()).slice(0, 260),
    stored: since(m, "on_complete").map((c) => c.parts.map((p) => p.text ?? p.name)),
    errors: page.con.filter((l) => /^(error|pageerror)/.test(l) && !/404/.test(l)).map((l) => l.slice(0, 160)).slice(-3),
  };
  await shot(page, `q10-${name}.png`);
  await page.close();
}

// A stopped Answer with truncated tool args, reopened with no agent.
{
  const m = mark();
  const page = await chat("nofollow=1");
  await ask(page, "slowtool");
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="copilot-send-button"]').click();
  await page.waitForTimeout(2000);
  const thread = since(m, "run_request")[0].thread;
  await page.close();
  const p = await b.newPage({ viewport: { width: 1000, height: 600 } });
  await p.goto(`${BASE}/reopen/${thread}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.waitForSelector('[data-testid="answer"]', { timeout: 30000 });
  await p.waitForTimeout(1500);
  out["reopen-stopped-answer"] = {
    status: await p.locator('[data-testid="answer"]').first().getAttribute("data-status"),
    text: await p.locator('[data-testid="stored-text"]').allInnerTexts(),
    partial: await p.locator('[data-testid="stored-partial"]').allInnerTexts(),
    frames: await p.locator("iframe.websandbox__frame").count(),
  };
  await shot(p, "q10-reopen-stopped-answer.png");
  await p.close();
}
save("q10-text-fallback.json", out);
console.log(JSON.stringify(out, null, 1));
await b.close();
