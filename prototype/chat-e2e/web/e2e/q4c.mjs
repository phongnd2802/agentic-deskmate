// Q4: hydration, using the agent only once useAgent reports isReady, with and without waiting for /connect.
import { ask, BASE, browser, consoleLog, mark, netlog, save, shot, since } from "./lib.mjs";
const b = await browser();
const page = await b.newPage();
const thread = crypto.randomUUID();
await page.goto(`${BASE}/?nofollow=1&thread=${thread}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("textarea", { timeout: 120000 });
await page.waitForTimeout(3500);
await ask(page, "tall slider");
await page.frameLocator("iframe.websandbox__frame").locator("#val").waitFor({ timeout: 60000 });
await page.waitForTimeout(2000);
await page.close();
const out = {};
for (const delay of [0, 4000]) {
  const fresh = crypto.randomUUID();
  await fetch(`http://localhost:8100/debug/clone/${thread}/${fresh}`, { method: "POST" });
  const h = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const net = netlog(h);
  const con = consoleLog(h);
  const m = mark();
  await h.goto(`${BASE}/hydrate/${fresh}?delay=${delay}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await h.waitForTimeout(9000);
  const frames = await h.locator("iframe.websandbox__frame").count();
  out[`delay${delay}`] = {
    frames,
    body: (await h.locator("body").innerText()).slice(0, 200),
    slider: frames ? await (async () => { const f = h.frameLocator("iframe.websandbox__frame"); await f.locator("#s").fill("33"); return f.locator("#val").textContent(); })() : null,
    frameHeight: frames ? await h.locator("iframe.websandbox__frame").evaluate((e) => e.getBoundingClientRect().height) : null,
    composer: await h.locator("textarea").count(),
    net: [...new Set(net)],
    backendRuns: since(m, "run_request").length,
    errors: con.filter((l) => /^(pageerror)/.test(l)).slice(-3),
  };
  await shot(h, `q4-hydrate-delay${delay}.png`);
  await h.close();
}
save("q4c-hydrate.json", out);
console.log(JSON.stringify(out, null, 1));
await b.close();
