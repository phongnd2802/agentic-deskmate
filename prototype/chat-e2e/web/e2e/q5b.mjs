// Q5: tab close through the route that calls runner.stop on req.signal abort.
import { ask, BASE, browser, mark, save, settings, since } from "./lib.mjs";
const b = await browser();
await settings({ cancel: "listen" });
const out = {};
for (const trial of [1, 2]) {
  const m = mark();
  const page = await b.newPage();
  await page.goto(`${BASE}/?nofollow=1&rt=abort`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("textarea", { timeout: 120000 });
  await page.waitForTimeout(3500);
  await ask(page, "slowtext");
  for (let i = 0; i < 300 && !since(m, "model_called").length; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(2000);
  const thread = since(m, "run_request")[0]?.thread;
  await page.close();
  await new Promise((r) => setTimeout(r, 20000));
  out[`trial${trial}`] = {
    thread,
    stored: await fetch(`http://localhost:8100/answers/${thread}`).then((r) => r.json()).then((a) => a.map((x) => ({ status: x.status, source: x.source, textChars: x.parts[0]?.text?.length }))),
    events: since(m).filter((l) => !["run_request", "model_called"].includes(l.kind)).map(({ kind, exc, chunks_sent, status }) => ({ kind, exc, chunks_sent, status })),
  };
}
save("q5b-tab-close-stop-on-abort.json", out);
console.log(JSON.stringify(out, null, 1));
await b.close();
