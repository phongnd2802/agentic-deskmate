import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export default function globalSetup() {
  const root = resolve(process.cwd(), "..");
  const creds: { emailA: string; passwordA: string; emailB: string; passwordB: string } = {
    emailA: `e2e-a-${Date.now()}@example.com`,
    passwordA: "secret1234",
    emailB: `e2e-b-${Date.now()}@example.com`,
    passwordB: "secret1234",
  };

  for (const [email, org] of [
    [creds.emailA, `E2E Org A ${Date.now()}`],
    [creds.emailB, `E2E Org B ${Date.now()}`],
  ]) {
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "backend",
        "uv",
        "run",
        "python",
        "-m",
        "app.cli",
        "create-organization",
        "--name",
        org,
        "--admin-email",
        email,
        "--password",
        (email === creds.emailA ? creds.passwordA : creds.passwordB),
      ],
      { cwd: root, stdio: "inherit" },
    );
  }

  mkdirSync(resolve(process.cwd(), "test-results"), { recursive: true });
  writeFileSync(
    resolve(process.cwd(), "test-results", "e2e-credentials.json"),
    JSON.stringify(creds),
  );
}