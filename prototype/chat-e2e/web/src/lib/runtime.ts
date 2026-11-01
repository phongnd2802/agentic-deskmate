import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

type Opts = { forwardHeaders?: { allow: string[] }; identifyUser?: any; stopOnDisconnect?: boolean };

export function routes(basePath: string, { stopOnDisconnect, ...opts }: Opts = {}) {
  const runtime = new CopilotRuntime({
    agents: { default: new HttpAgent({ url: "http://localhost:8100/agent" }) },
    a2ui: { injectA2UITool: true },
    openGenerativeUI: true,
    ...opts,
  });
  const h = createCopilotRuntimeHandler({ basePath, runtime });
  const POST = async (req: Request) => {
    // Tab close only unsubscribes the SSE response; the runner keeps the run alive unless told to stop.
    if (stopOnDisconnect && new URL(req.url).pathname.endsWith("/run")) {
      const { threadId } = await req.clone().json();
      // ownerId "" is the anonymous owner; omitted means "server owner" and silently stops nothing.
      req.signal.addEventListener("abort", () => runtime.runner.stop({ threadId, ownerId: "" }));
    }
    return h(req);
  };
  return { GET: h, POST };
}
