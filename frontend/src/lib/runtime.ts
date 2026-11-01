import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

// Server-side only: the browser never talks to FastAPI (ADR-0003).
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

export function routes(basePath: string) {
  // shortcut: no identifyUser until sign-in exists, issue 3 adds it per ADR-0003
  const runtime = new CopilotRuntime({
    agents: { default: new HttpAgent({ url: `${backendUrl}/agent` }) },
    forwardHeaders: { allow: ["cookie"] },
  });
  const handler = createCopilotRuntimeHandler({ basePath, runtime });

  return { GET: handler, POST: handler };
}
