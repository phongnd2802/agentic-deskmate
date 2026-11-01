// Q5: Stop button and tab close. Each case gets its own thread and waits long enough to not bleed.
import { ask, BASE, browser, consoleLog, mark, netlog, save, settings, shot, since } from "./lib.mjs";
const b = await browser();
const out = {};

async function chat(rt) {
  const page = await b.newPage({ viewport: { width: 1000, height: 800 } });
  page.net = netlog(page);
  page.con = consoleLog(page);
  await page.goto(`${BASE}/?nofollow=1${rt ? `&rt=${rt}` : ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("textarea", { timeout: 120000 });
  await page.waitForTimeout(3500);
  return page;
}
const brief = (l) => {
  const { kind, exc, chunks_sent, status, parts, usage } = l;
  return {
    kind, exc, chunks_sent, status, usage,
    parts: parts?.map((p) => (p.type === "text" ? { text: `${p.text.length} chars` } : { tool: p.name, argsType: typeof p.args, argsLen: String(p.args).length, argsTail: String(p.args).slice(-60) })),
  };
};
const events = (m) => since(m).filter((l) => !["run_request", "model_called"].includes(l.kind)).map(brief);
const stored = (thread) =>
  fetch(`http://localhost:8100/answers/${thread}`).then((r) => r.json()).then((a) => a.map((x) => ({
    status: x.status, source: x.source,
    parts: x.parts.map((p) => (p.type === "text" ? { text: `${p.text.length} chars` } : { tool: p.name, argsType: typeof p.args, argsLen: String(p.args).length })),
  })));

async function stopCase(name, prompt, cancel) {
  await settings({ cancel });
  const m = mark();
  const page = await chat();
  await ask(page, prompt);
  await page.waitForTimeout(2500);
  const t0 = Date.now() / 1000;
  await page.locator('[data-testid="copilot-send-button"]').click();
  await page.waitForTimeout(3500);
  const thread = since(m, "run_request")[0]?.thread;
  const firstBackendReaction = since(m).find((l) => ["model_stream_interrupted", "client_disconnected"].includes(l.kind));
  out[name] = {
    prompt, cancel,
    net: page.net.filter((c) => /stop|run/.test(c)),
    stopToBackendSeconds: firstBackendReaction ? Number((firstBackendReaction.t - t0).toFixed(2)) : null,
    uiText: (await page.locator("body").innerText()).slice(0, 160),
    stillRunning: await page.evaluate(() => window.__agent.isRunning),
    stored: await stored(thread),
    events: events(m),
    errors: page.con.filter((l) => /^(error|pageerror)/.test(l)).slice(-3),
  };
  await shot(page, `q5-${name}.png`);
  await page.close();
}

async function closeCase(name, cancel, rt) {
  await settings({ cancel });
  const m = mark();
  const page = await chat(rt);
  await ask(page, "slowtext");
  await page.waitForTimeout(2500);
  const thread = since(m, "run_request")[0]?.thread;
  await page.close();
  await new Promise((r) => setTimeout(r, 20000)); // the scripted stream takes 15s when nobody cancels it
  out[name] = { cancel, rt: rt ?? "/api/copilotkit", stored: await stored(thread), events: events(m) };
}

await stopCase("stop-text", "slowtext", "listen");
await stopCase("stop-tool", "slowtool", "listen");
await stopCase("stop-text-no-listener", "slowtext", "none");
await stopCase("stop-tool-no-listener", "slowtool", "none");
await closeCase("close-tab-default", "listen"); // stop-on-disconnect variant is in q5b.mjs
await settings({ cancel: "listen" });
save("q5-result.json", out);
console.log(JSON.stringify(out, null, 1));
await b.close();
