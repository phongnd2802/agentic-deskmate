// Q4 follow-ups: hydrate on a thread unknown to the runtime, autosize on reopen, nofollow override,
// and whether a second browser identity can read a thread through /connect.
import { ask, BASE, browser, consoleLog, mark, netlog, save, shot, since } from "./lib.mjs";
const b = await browser();
const out = {};

async function chat(url) {
  const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
  page.net = netlog(page);
  page.con = consoleLog(page);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("textarea", { timeout: 120000 });
  await page.waitForTimeout(3500);
  return page;
}

// Followup override
{
  const m = mark();
  const thread = crypto.randomUUID();
  const page = await chat(`${BASE}/?thread=${thread}&nofollow=1`);
  await ask(page, "tall slider");
  const f = page.frameLocator("iframe.websandbox__frame");
  await f.locator("#val").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  await f.locator("#s").fill("44");
  out.nofollow = {
    runs: page.net.filter((c) => c.endsWith("/run")).length,
    backend: since(m, "run_request").map((r) => r.follow_up),
    tools: since(m, "run_request")[0]?.tools,
    slider: await f.locator("#val").textContent(),
    liveFrameHeight: await page.locator("iframe.websandbox__frame").evaluate((e) => e.getBoundingClientRect().height),
    messages: await page.evaluate(() => window.__agent.messages.map((m) => m.role + (m.activityType ? ":" + m.activityType : ""))),
    warnings: page.con.filter((l) => /warning|error/.test(l)).slice(-4),
  };
  await shot(page, "q1-nofollow.png");
  await page.close();

  // Reopen autosize: stored initialHeight is 60, content is taller.
  const fresh = crypto.randomUUID();
  await fetch(`http://localhost:8100/debug/clone/${thread}/${fresh}`, { method: "POST" });
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  await p.goto(`${BASE}/reopen/${fresh}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.frameLocator("iframe.websandbox__frame").locator("#val").waitFor({ timeout: 60000 });
  await p.waitForTimeout(2500);
  out.reopenAutosize = { height: await p.locator("iframe.websandbox__frame").evaluate((e) => e.getBoundingClientRect().height) };
  await shot(p, "q4-reopen-autosize.png");
  await p.close();

  // Hydrate on an id the runtime never saw.
  const h = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const net = netlog(h);
  const con = consoleLog(h);
  const mk = mark();
  await h.goto(`${BASE}/hydrate/${fresh}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await h.waitForTimeout(7000);
  const frames = await h.locator("iframe.websandbox__frame").count();
  out.hydrateFresh = {
    frames,
    body: (await h.locator("body").innerText()).slice(0, 240),
    slider: frames ? await (async () => { const f = h.frameLocator("iframe.websandbox__frame"); await f.locator("#s").fill("33"); return f.locator("#val").textContent(); })() : null,
    composerPresent: await h.locator("textarea").count(),
    net: [...new Set(net)], backendRuns: since(mk, "run_request").length,
    errors: con.filter((l) => /^(error|pageerror)/.test(l)).slice(-4),
  };
  await shot(h, "q4-hydrate-fresh-id.png");
  await h.close();
}

// Can another identity read a Conversation through the runtime? Fresh context, no shared state.
{
  const thread = crypto.randomUUID();
  const ctxA = await b.newContext();
  await ctxA.addCookies([{ name: "session", value: "user-a", url: BASE }]);
  const a = await ctxA.newPage();
  await a.goto(`${BASE}/?thread=${thread}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await a.waitForSelector("textarea", { timeout: 120000 });
  await a.waitForTimeout(1500);
  await ask(a, "my private salary data is 12345");
  await a.waitForTimeout(3000);
  await ctxA.close();

  const ctxB = await b.newContext();
  await ctxB.addCookies([{ name: "session", value: "user-b", url: BASE }]);
  const r = await ctxB.request.post(`${BASE}/api/copilotkit/agent/default/connect`, {
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    data: { threadId: thread, runId: crypto.randomUUID(), state: {}, messages: [], tools: [], context: [], forwardedProps: {} },
  });
  const body = await r.text();
  out.crossUserConnect = { status: r.status(), leaked: body.includes("12345"), sample: body.slice(0, 400) };
  await ctxB.close();
}

save("q4b-result.json", out);
console.log(JSON.stringify(out, null, 1));
await b.close();
