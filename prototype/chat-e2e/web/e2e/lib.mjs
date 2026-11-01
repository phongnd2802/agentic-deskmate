// Shared helpers for the throwaway verification scripts.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const EVID = path.resolve(import.meta.dirname, "../../evidence");
export const BASE = "http://localhost:3100";
export const LOG = path.join(EVID, "backend-log.jsonl");

export async function browser() {
  return chromium.launch({
    headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  });
}

export const logLines = () =>
  fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
export const mark = () => logLines().length;
export const since = (n, kind) => logLines().slice(n).filter((l) => !kind || l.kind === kind);

export const settings = (s) =>
  fetch("http://localhost:8100/debug/settings", { method: "POST", body: JSON.stringify(s) }).then((r) => r.json());

export async function ask(page, text) {
  const box = page.locator("textarea").first();
  await box.fill(text);
  await box.press("Enter");
}

export const shot = (page, name) => page.screenshot({ path: path.join(EVID, name), fullPage: false });
export const save = (name, data) => fs.writeFileSync(path.join(EVID, name), JSON.stringify(data, null, 2));

/** Records every call the page makes to /api/*, so "no run" claims are observed, not assumed. */
export function netlog(page) {
  const calls = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) calls.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return calls;
}

export const consoleLog = (page) => {
  const out = [];
  page.on("console", (m) => out.push(`${m.type()}: ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => out.push(`pageerror: ${e.message.slice(0, 300)}`));
  return out;
};
