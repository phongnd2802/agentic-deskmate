import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";

import { signIn } from "./auth";

export default async function globalSetup(config: FullConfig) {
  const root = resolve(process.cwd(), "..");
  const stamp = Date.now();
  const creds = {
    a: { email: `e2e-a-${stamp}@example.com`, password: "secret1234" },
    b: { email: `e2e-b-${stamp}@example.com`, password: "secret1234" },
  };

  for (const [key, user] of Object.entries(creds)) {
    // The password travels in the environment, never on a command line where `ps` shows it.
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "-e",
        "DESKMATE_ADMIN_PASSWORD",
        "backend",
        "uv",
        "run",
        "python",
        "-m",
        "app.cli",
        "create-organization",
        "--name",
        `E2E Org ${key.toUpperCase()} ${stamp}`,
        "--admin-email",
        user.email,
      ],
      { cwd: root, stdio: "inherit", env: { ...process.env, DESKMATE_ADMIN_PASSWORD: user.password } },
    );
  }

  mkdirSync(resolve(process.cwd(), "test-results"), { recursive: true });
  writeFileSync(resolve(process.cwd(), "test-results", "e2e-credentials.json"), JSON.stringify(creds));

  // Next dev compiles /chat on first visit, which can outlast a test's timeout after a fresh image.
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: config.projects[0].use.baseURL });
  page.setDefaultTimeout(300_000);
  await signIn(page, creds.a);
  await browser.close();
}
