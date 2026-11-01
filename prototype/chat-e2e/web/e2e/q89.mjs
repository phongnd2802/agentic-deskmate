// Q8 identity and single-turn, Q9 i18n and slots, plus follow-ups on Q4 and Q6.
import { ask, BASE, browser, consoleLog, mark, netlog, save, settings, shot, since } from "./lib.mjs";
const b = await browser();
const out = {};

async function chat(query, cookie) {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 800 } });
  if (cookie) await ctx.addCookies([{ name: "session", value: cookie, url: BASE }]);
  const page = await ctx.newPage();
  page.net = netlog(page);
  page.con = consoleLog(page);
  await page.goto(`${BASE}/?${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("textarea", { timeout: 120000 });
  await page.waitForTimeout(3500);
  return page;
}
const done = (p) => p.context().close();
const waitRun = async (page, m) => { for (let i = 0; i < 200 && !since(m, "on_complete").length; i++) await page.waitForTimeout(100); };

// Cookie through CopilotRuntime, with and without forwardHeaders.allow
for (const [name, query] of [["cookie-default-policy", "nofollow=1&rt=default"], ["cookie-allow-policy", "nofollow=1"]]) {
  const m = mark();
  const page = await chat(query, "user-a-session");
  await ask(page, "hello");
  await waitRun(page, m);
  const r = since(m, "run_request")[0];
  out[name] = { cookieAtFastAPI: r.cookie, modelIdAtFastAPI: r.model_id };
  await done(page);
}

// Model picker in the composer changes forwardedProps
{
  const m = mark();
  const page = await chat("nofollow=1&picker=1&vi=1");
  await page.locator('[data-testid="model"]').selectOption("model-b");
  await page.waitForTimeout(300);
  await shot(page, "q9-vietnamese-model-picker.png");
  await ask(page, "hello");
  await page.waitForTimeout(2000);
  out.modelPicker = {
    modelIdAtFastAPI: since(m, "run_request")[0].model_id,
    placeholder: await page.locator("textarea").getAttribute("placeholder"),
    disclaimer: (await page.locator("body").innerText()).includes("AI có thể mắc lỗi."),
  };
  await done(page);
}

// Composer lock after one Answer, for a text Answer and a Generative UI Answer
for (const [name, prompt] of [["lock-text", "hello"], ["lock-ogui", "slider"]]) {
  const page = await chat("nofollow=1&lock=1");
  await ask(page, prompt);
  await page.locator('[data-testid="locked"]').waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  out[name] = {
    locked: await page.locator('[data-testid="locked"]').count(),
    textareas: await page.locator("textarea").count(),
    frames: await page.locator("iframe.websandbox__frame").count(),
  };
  await shot(page, `q8-${name}.png`);
  await done(page);
}

// Second run rejected by the backend
await settings({ single_turn: true });
for (const mode of ["event", "http"]) {
  await settings({ reject_mode: mode });
  const m = mark();
  const page = await chat("nofollow=1");
  await ask(page, "hello");
  await page.waitForTimeout(2500);
  await ask(page, "second question");
  await page.waitForTimeout(3000);
  out[`reject-${mode}`] = {
    rejected: since(m, "run_rejected").length,
    errorShownByPage: await page.locator('[data-testid="error"]').allInnerTexts(),
    banner: await page.locator('[data-testid="copilot-error-banner"]').allInnerTexts(),
    composerUsable: await page.locator("textarea").isEnabled(),
    isRunning: await page.evaluate(() => window.__agent.isRunning),
    bodyText: (await page.locator("body").innerText()).slice(0, 200),
    console: page.con.filter((l) => /^error/.test(l) && !/404/.test(l)).map((l) => l.slice(0, 140)).slice(-3),
  };
  await shot(page, `q8-reject-${mode}.png`);
  await done(page);
}

// Default followUp behaviour under the single-turn rule: the follow-up must not look like a second turn.
{
  await settings({ reject_mode: "event" });
  const m = mark();
  const page = await chat("");
  await ask(page, "slider");
  await page.waitForTimeout(5000);
  out["single-turn-with-followup"] = {
    runs: since(m, "run_request").map((r) => r.follow_up),
    rejected: since(m, "run_rejected").length,
    error: await page.locator('[data-testid="error"]').allInnerTexts(),
  };
  await done(page);
}
await settings({ single_turn: false, reject_mode: "event" });

// identifyUser closes the cross-identity read
{
  const thread = crypto.randomUUID();
  const a = await chat(`nofollow=1&rt=owned&thread=${thread}`, "user-a");
  await ask(a, "my private salary data is 12345");
  await a.waitForTimeout(3000);
  const stranger = await b.newContext();
  await stranger.addCookies([{ name: "session", value: "user-b", url: BASE }]);
  const body = { threadId: thread, runId: crypto.randomUUID(), state: {}, messages: [], tools: [], context: [], forwardedProps: {} };
  const headers = { "content-type": "application/json", accept: "text/event-stream" };
  const asB = await stranger.request.post(`${BASE}/api/copilotkit-owned/agent/default/connect`, { headers, data: body });
  const asOwner = await a.context().request.post(`${BASE}/api/copilotkit-owned/agent/default/connect`, { headers, data: body });
  const bText = await asB.text();
  const stopB = await stranger.request.post(`${BASE}/api/copilotkit-owned/agent/default/stop/${thread}`, { headers: { "content-type": "application/json" }, data: {} });
  const noCookie = await b.newContext();
  const asAnon = await noCookie.request.post(`${BASE}/api/copilotkit-owned/agent/default/connect`, { headers, data: body });
  const anonText = await asAnon.text();
  out.identifyUser = {
    userB: { status: asB.status(), leaked: bText.includes("12345"), sample: bText.slice(0, 160) },
    owner: { status: asOwner.status(), sees: (await asOwner.text()).includes("12345") },
    stopAsB: { status: stopB.status(), body: (await stopB.text()).slice(0, 120) },
    anonymous: { status: asAnon.status(), leaked: anonText.includes("12345") },
  };
  await done(a);
  await stranger.close();
  await noCookie.close();
}

// Q4 follow-ups: autosize fix and hydrate after /connect has settled
{
  const thread = crypto.randomUUID();
  const page = await chat(`nofollow=1&thread=${thread}`);
  await ask(page, "tall slider");
  await page.frameLocator("iframe.websandbox__frame").locator("#val").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  await done(page);
  const fresh = crypto.randomUUID();
  await fetch(`http://localhost:8100/debug/clone/${thread}/${fresh}`, { method: "POST" });
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  await p.goto(`${BASE}/reopen/${fresh}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.frameLocator("iframe.websandbox__frame").locator("#val").waitFor({ timeout: 60000 });
  await p.waitForTimeout(3000);
  out.reopenAutosizeFixed = { height: await p.locator("iframe.websandbox__frame").evaluate((e) => e.getBoundingClientRect().height) };
  await p.close();

  const h = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const net = netlog(h);
  await h.goto(`${BASE}/hydrate/${fresh}?delay=4000`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await h.waitForTimeout(9000);
  const frames = await h.locator("iframe.websandbox__frame").count();
  out.hydrateAfterConnect = {
    frames, body: (await h.locator("body").innerText()).slice(0, 200),
    slider: frames ? await (async () => { const f = h.frameLocator("iframe.websandbox__frame"); await f.locator("#s").fill("33"); return f.locator("#val").textContent(); })() : null,
    composer: await h.locator("textarea").count(), net: [...new Set(net)],
  };
  await shot(h, "q4-hydrate-after-connect.png");
  await h.close();
}

// Q6 follow-up: host page frame-src against sandbox self-navigation
{
  const m = mark();
  const page = await chat("nofollow=1&hostcsp=1");
  await ask(page, "cspnav");
  await page.waitForTimeout(6000);
  out.navigationHostCsp = {
    evilHits: since(m, "evil_hit").map((h) => h.path),
    frameCount: await page.locator("iframe.websandbox__frame").count(),
    frames: page.frames().map((f) => f.url().slice(0, 60)),
    violations: page.con.filter((l) => /Content Security Policy|frame-src/.test(l)).slice(-2),
  };
  await shot(page, "q6-navigation-host-csp.png");
  await done(page);

  const page2 = await chat("nofollow=1&hostcsp=1");
  await ask(page2, "slider");
  const f = page2.frameLocator("iframe.websandbox__frame");
  await f.locator("#val").waitFor({ timeout: 30000 }).catch(() => {});
  await page2.waitForTimeout(1500);
  await f.locator("#s").fill("64").catch(() => {});
  out.sliderUnderHostCsp = { value: await f.locator("#val").textContent({ timeout: 3000 }).catch((e) => `err ${e.message.slice(0, 80)}`) };
  await done(page2);
}

save("q8-q9-result.json", out);
console.log(JSON.stringify(out, null, 1));
await b.close();
