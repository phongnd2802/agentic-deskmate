import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

// Server-side only: the browser never talks to FastAPI (ADR-0003).
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

export function routes(basePath: string) {
  const runtime = new CopilotRuntime({
    agents: { default: new HttpAgent({ url: `${backendUrl}/agent` }) },
    forwardHeaders: { allow: ["cookie"] },
    identifyUser: async (request: Request) => {
      const response = await fetch(`${backendUrl}/auth/me`, {
        headers: { cookie: request.headers.get("cookie") ?? "" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Not signed in");
      const user = (await response.json()) as { id: string };
      return { id: user.id, name: user.id };
    },
  });
  const handler = createCopilotRuntimeHandler({ basePath, runtime });

  return { GET: handler, POST: handler };
}
