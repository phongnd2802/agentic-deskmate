import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { backendUrl, fetchCurrentUser } from "@/lib/backend";

export function routes(basePath: string) {
  const runtime = new CopilotRuntime({
    agents: { default: new HttpAgent({ url: `${backendUrl}/agent` }) },
    // Turns the Model's generateSandboxedUi call into the activity the browser renders.
    openGenerativeUI: true,
    // Turns the Model's render_a2ui call into a table surface; the catalog is the browser's.
    a2ui: { injectA2UITool: true, defaultCatalogId: "copilotkit://deskmate-tables" },
    forwardHeaders: { allow: ["cookie"] },
    identifyUser: async (request: Request) => {
      const user = await fetchCurrentUser(request.headers.get("cookie") ?? "");
      if (!user) throw new Error("Not signed in");
      return { id: user.id, name: user.id };
    },
  });
  const handler = createCopilotRuntimeHandler({
    basePath,
    runtime,
    hooks: {
      // The one gate: every route (info, suggest, transcribe included) needs a valid session.
      onRequest: async ({ request }) => {
        if (!(await fetchCurrentUser(request.headers.get("cookie") ?? ""))) {
          throw new Response("Not signed in", { status: 401 });
        }
      },
    },
  });

  return { GET: handler, POST: handler };
}
