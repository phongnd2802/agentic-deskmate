// Production-build check: `node e2e/prod.mjs <label>` against `next start`, for one bundler at a time.
import fs from "node:fs";
import path from "node:path";
import { ask, BASE, browser, consoleLog, EVID, mark, shot, since } from "./lib.mjs";
const label = process.argv[2];
const b = await browser();
const out = {};

async function chat(query) {
  const page = await b.newPage({ viewport: { width: 1000, height: 800 } });
  page.con = consoleLog(page);
  await page.goto(`${BASE}/?${query}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("textarea", { timeout: 60000 });
  await page.waitForTimeout(3000);
  return page;
}

{
  const page = await chat("nofollow=1");
  await ask(page, "draw a slider");
  await page.waitForTimeout(5000);
  const f = page.frameLocator("iframe.websandbox__frame");
  out.frames = await page.locator("iframe.websandbox__frame").count();
  if (out.frames) {
    await f.locator("#s").fill("73", { timeout: 5000 }).catch(() => {});
    out.slider = await f.locator("#val").textContent({ timeout: 3000 }).catch((e) => `err ${e.message.slice(0, 60)}`);
  }
  out.errors = page.con.filter((l) => /OpenGenerativeUI|pageerror/.test(l)).map((l) => l.slice(0, 200));
  await shot(page, `prod-${label}-ogui.png`);
  await page.close();
}
{
  const page = await chat("nofollow=1");
  await ask(page, "show a table");
  await page.waitForTimeout(3500);
  out.tableRows = await page.locator('[data-testid="a2ui-table"] tbody tr').count();
  await page.close();
}
{
  const m = mark();
  const page = await chat("nofollow=1&picker=2&vi=1");
  await page.locator('[data-testid="model"]').selectOption("model-b");
  await page.waitForTimeout(300);
  out.pickerInsideComposer = await page.locator('[data-testid="copilot-chat-input"] [data-testid="model"]').count();
  await shot(page, "q9-model-picker-in-composer.png");
  await ask(page, "hello");
  await page.waitForTimeout(2500);
  out.pickerModelAtFastAPI = since(m, "run_request")[0]?.model_id;
  await page.close();
}
fs.writeFileSync(path.join(EVID, `prod-${label}.json`), JSON.stringify(out, null, 2));
console.log(label, JSON.stringify(out));
await b.close();
