// Q1 Open Generative UI, Q2 A2UI, Q3 tool filtering.
import { ask, BASE, browser, consoleLog, mark, netlog, save, shot, since } from "./lib.mjs";
const b = await browser();

async function open(url) {
  const page = await b.newPage({ viewport: { width: 1000, height: 800 } });
  page.con = consoleLog(page);
  page.net = netlog(page);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("textarea", { timeout: 120000 });
  await page.waitForTimeout(3500);
  return page;
}

// Q1
{
  const m = mark();
  const page = await open(`${BASE}/?csp=off`);
  await ask(page, "draw a slider");
  const frame = page.frameLocator("iframe.websandbox__frame");
  await frame.locator("#val").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  const before = await frame.locator("#val").textContent();
  const runsBefore = page.net.filter((c) => c.endsWith("/run")).length;
  await frame.locator("#s").fill("73");
  const afterSlider = await frame.locator("#val").textContent();
  await frame.locator("#b").click();
  const afterButton = await frame.locator("#val").textContent();
  await page.waitForTimeout(1000);
  const runsAfter = page.net.filter((c) => c.endsWith("/run")).length;
  await shot(page, "q1-open-generative-ui.png");
  const sandbox = await page.locator("iframe.websandbox__frame").getAttribute("sandbox");
  const allowAttr = await page.locator("iframe.websandbox__frame").getAttribute("allow");
  const result = {
    before, afterSlider, afterButton, runsBefore, runsAfter, sandbox, allowAttr,
    backendRuns: since(m, "run_request").map((r) => ({ follow_up: r.follow_up, roles: r.roles })),
    thread: since(m, "run_request")[0]?.thread,
    agentMessages: await page.evaluate(() => window.__agent.messages.map((m) => ({ role: m.role, activityType: m.activityType, content: typeof m.content === "string" ? m.content.slice(0, 60) : undefined, toolCalls: m.toolCalls?.map((t) => t.function.name) }))),
    net: page.net, console: page.con.filter((l) => /error|warn/i.test(l)).slice(-8),
  };
  save("q1-result.json", result);
  console.log("Q1", JSON.stringify(result, null, 1));
  await page.close();
}

// Q2
{
  const m = mark();
  const page = await open(`${BASE}/`);
  await ask(page, "show a table");
  await page.waitForTimeout(5000);
  const rows = await page.locator('[data-testid="a2ui-table"] tbody tr').count();
  const text = rows ? await page.locator('[data-testid="a2ui-table"]').innerText() : (await page.locator("body").innerText()).slice(0, 600);
  await shot(page, "q2-a2ui-table.png");
  const result = {
    rows, text,
    backendRuns: since(m, "run_request").map((r) => ({ follow_up: r.follow_up, roles: r.roles, tools: r.tools })),
    onComplete: since(m, "on_complete").map((r) => r.parts),
    agentMessages: await page.evaluate(() => window.__agent.messages.map((m) => ({ role: m.role, activityType: m.activityType, content: m.role === "activity" ? m.content : undefined, toolCalls: m.toolCalls?.map((t) => t.function.name) }))),
    console: page.con.filter((l) => /error|warn/i.test(l)).slice(-8),
  };
  save("q2-result.json", result);
  console.log("Q2", JSON.stringify(result, null, 1).slice(0, 3000));
  await page.close();
}

// Q3: same keyword, three routes, plus an unrouted control.
{
  const out = {};
  for (const [name, prompt] of [
    ["control", "show a table"],
    ["ogui-only", "route:ogui show a table"],
    ["ogui-only-slider", "route:ogui slider"],
    ["a2ui-only", "route:a2ui show a table"],
    ["a2ui-only-slider", "route:a2ui slider"],
    ["none", "route:none slider"],
  ]) {
    const m = mark();
    const page = await open(`${BASE}/`);
    await ask(page, prompt);
    await page.waitForTimeout(3000);
    const req = since(m, "run_request")[0];
    const model = since(m, "model_called")[0];
    out[name] = {
      prompt,
      clientSent: req.tools,
      modelSaw: model.tools,
      instructionsHead: model.instructions.split("\n")[0],
      renderedFrame: await page.locator("iframe.websandbox__frame").count(),
      renderedTable: await page.locator('[data-testid="a2ui-table"]').count(),
      parts: since(m, "on_complete")[0]?.parts.map((p) => p.text ?? p.name),
    };
    await page.close();
  }
  save("q3-result.json", out);
  console.log("Q3", JSON.stringify(out, null, 1));
}
await b.close();
