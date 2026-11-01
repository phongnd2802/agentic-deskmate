// Q6 sandbox CSP, Q7 sandbox functions. Evil hits are read from the backend log: only observed traffic counts.
import { ask, BASE, browser, consoleLog, mark, netlog, save, shot, since } from "./lib.mjs";
const b = await browser();
const out = {};

async function chat(query) {
  const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
  page.net = netlog(page);
  page.con = consoleLog(page);
  await page.goto(`${BASE}/?nofollow=1&${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("textarea", { timeout: 120000 });
  await page.waitForTimeout(3500);
  return page;
}
const hits = (m) => since(m, "evil_hit").map((h) => h.path);

async function probe(name, query) {
  const m = mark();
  const page = await chat(query);
  await ask(page, "run csp probe");
  const f = page.frameLocator("iframe.websandbox__frame");
  await f.locator("#r").waitFor({ timeout: 60000 });
  await page.waitForTimeout(7000);
  const report = JSON.parse((await f.locator("#r").textContent()) || "{}");
  const canvasPainted = await f.locator("#c").evaluate((c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v) => v !== 0));
  out[name] = { query, report, canvasPainted, evilHits: hits(m) };
  await shot(page, `q6-${name}.png`);
  await page.close();
}

await probe("final-csp-on", "");
await probe("final-csp-off", "csp=off");

// Streaming preview: html arrives slowly and attacks before the final sandbox exists.
for (const [name, query] of [["preview-csp-off", "csp=off"], ["preview-csp-on", ""]]) {
  const m = mark();
  const page = await chat(query);
  await ask(page, "preview attack");
  await page.waitForTimeout(9000);
  out[name] = { query, evilHits: hits(m), frames: await page.locator("iframe.websandbox__frame").count() };
  await shot(page, `q6-${name}.png`);
  await page.close();
}

// Navigation is not a CSP fetch directive. This is the one to watch.
{
  const m = mark();
  const page = await chat("");
  await ask(page, "cspnav");
  await page.waitForTimeout(6000);
  const frames = page.frames().map((f) => f.url()).filter((u) => !u.startsWith(BASE));
  out["navigation-csp-on"] = { evilHits: hits(m), since: since(m, "evil_hit").map((h) => ({ path: h.path, query: h.query })), frames };
  await shot(page, "q6-navigation.png");
  await page.close();
}

// Q7: only openLink registered.
{
  const m = mark();
  const page = await chat("fn=1");
  const dialogs = [];
  const popups = [];
  page.on("popup", (p) => { popups.push(p.url()); p.close(); });
  let answer = true;
  page.on("dialog", async (d) => { dialogs.push(d.message()); answer ? await d.accept() : await d.dismiss(); });
  await ask(page, "sandboxfn");
  const f = page.frameLocator("iframe.websandbox__frame");
  await f.locator("#open").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  const runsBefore = page.net.filter((c) => c.endsWith("/run")).length;
  const backendBefore = since(m, "run_request").length;
  answer = false;
  await f.locator("#open").click();
  await page.waitForTimeout(800);
  answer = true;
  await f.locator("#open").click();
  await page.waitForTimeout(3500);
  await f.locator("#prompt").click();
  await page.waitForTimeout(2000);
  out.q7 = {
    log: await f.locator("#r").textContent(),
    dialogs, popups,
    contextDescriptions: since(m, "run_request")[0].context.map((c) => c.description).filter((d) => /Sandbox functions/.test(d)),
    runsBefore, runsAfter: page.net.filter((c) => c.endsWith("/run")).length,
    backendRunsBefore: backendBefore, backendRunsAfter: since(m, "run_request").length,
    evilHits: hits(m),
    errors: page.con.filter((l) => /^(pageerror)/.test(l)).slice(-3),
  };
  await page.bringToFront(); await shot(page, "q7-sandbox-functions.png");
  await page.close();
}

// Q7 control: same code with no functions registered at all.
{
  const m = mark();
  const page = await chat("");
  await ask(page, "sandboxfn");
  const f = page.frameLocator("iframe.websandbox__frame");
  await f.locator("#open").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  await f.locator("#prompt").click();
  await page.waitForTimeout(800);
  out.q7NoFunctions = { log: await f.locator("#r").textContent(), backendRuns: since(m, "run_request").length };
  await page.close();
}
save("q6-q7-result.json", out);
console.log(JSON.stringify(out, null, 1));
await b.close();
