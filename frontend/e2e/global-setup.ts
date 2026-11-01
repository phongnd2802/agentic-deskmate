import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, request, type FullConfig } from "@playwright/test";

import { signIn } from "./auth";

export default async function globalSetup(config: FullConfig) {
  const root = resolve(process.cwd(), "..");
  const stamp = Date.now();
  const creds = {
    a: { email: `e2e-a-${stamp}@example.com`, password: "secret1234" },
    b: { email: `e2e-b-${stamp}@example.com`, password: "secret1234" },
    // Organization C never gets a Provider.
    c: { email: `e2e-c-${stamp}@example.com`, password: "secret1234" },
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

  // A and B each get a Provider, so Chat has a Model to pick. The address is a public literal: saving needs no DNS.
  for (const user of [creds.a, creds.b]) {
    const api = await request.newContext({ baseURL: config.projects[0].use.baseURL });
    await api.post("/api/backend/auth/sign-in", { data: user, failOnStatusCode: true });
    await api.post("/api/backend/providers", {
      data: { name: "E2E Provider", api_type: "openai", base_url: "https://8.8.8.8/v1", api_key: "sk-e2e", models: [{ model_id: "e2e-model" }] },
      failOnStatusCode: true,
    });
    await api.dispose();
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
