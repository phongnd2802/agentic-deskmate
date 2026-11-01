// Q4: capture an Answer, then re-render it after a full reload in a fresh browser context.
import { ask, BASE, browser, consoleLog, mark, netlog, save, shot, since } from "./lib.mjs";
const b = await browser();
const thread = crypto.randomUUID();

const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
await page.goto(`${BASE}/?thread=${thread}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("textarea", { timeout: 120000 });
await page.waitForTimeout(3500);
const m = mark();
await ask(page, "draw a slider");
await page.frameLocator("iframe.websandbox__frame").locator("#val").waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);
const onComplete = since(m, "on_complete");
const tee = since(m, "stream_tee_closed");
await page.close();

// Second context = nothing cached in memory. A table Answer goes into another Conversation.
const thread2 = crypto.randomUUID();
const page2 = await b.newPage({ viewport: { width: 1000, height: 900 } });
await page2.goto(`${BASE}/?thread=${thread2}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page2.waitForSelector("textarea", { timeout: 120000 });
await page2.waitForTimeout(1500);
await ask(page2, "show a table");
await page2.locator('[data-testid="a2ui-table"]').waitFor({ timeout: 30000 });
await page2.waitForTimeout(1500);
await page2.close();

const stored = await fetch(`http://localhost:8100/answers/${thread}`).then((r) => r.json());
const out = { thread, thread2, onComplete, tee, stored };

for (const [route, name] of [["reopen", "q4-reopen"], ["hydrate", "q4-hydrate"]]) {
  for (const id of [thread, thread2]) {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
    const p = await ctx.newPage();
    const con = consoleLog(p);
    const net = netlog(p);
    const mk = mark();
    await p.goto(`${BASE}/${route}/${id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await p.waitForTimeout(9000);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForTimeout(6000);
    const frames = await p.locator("iframe.websandbox__frame").count();
    let slider = null;
    if (frames) {
      const f = p.frameLocator("iframe.websandbox__frame").first();
      await f.locator("#s").fill("55").catch(() => {});
      slider = await f.locator("#val").textContent().catch((e) => `err ${e.message.slice(0, 80)}`);
    }
    const key = `${route}:${id === thread ? "ogui" : "table"}`;
    await shot(p, `${name}-${id === thread ? "ogui" : "table"}.png`);
    out[key] = {
      frames, slider,
      tableRows: await p.locator('[data-testid="a2ui-table"] tbody tr').count(),
      bodyText: (await p.locator("body").innerText()).slice(0, 240),
      frameHeight: frames ? await p.locator("iframe.websandbox__frame").first().evaluate((e) => e.getBoundingClientRect().height) : null,
      net: [...new Set(net)], backendRunsDuringView: since(mk, "run_request").length,
      errors: con.filter((l) => /^(error|pageerror)/.test(l)).slice(-5),
    };
    await ctx.close();
  }
}
save("q4-result.json", out);
console.log(JSON.stringify({ ...out, onComplete: undefined, tee: undefined, stored: stored.map((s) => ({ status: s.status, source: s.source, kinds: s.parts.map((p) => p.type) })) }, null, 1));
await b.close();
