"use client";
// Comparison for Q4: hydrate CopilotChat from stored Answers with agent.setMessages.
import { CopilotChat, CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import { use, useEffect, useState } from "react";
import { tableCatalog } from "@/lib/catalog";
import { contentFromArgs, sandboxFunctions, secureActivityRenderers } from "@/lib/ogui";

const a2ui = { catalog: tableCatalog };
const ogui = { sandboxFunctions };
const parse = (a: any) => { try { return typeof a === "string" ? JSON.parse(a) : a; } catch { return null; } };

function toMessages(answers: any[]) {
  const out: any[] = [{ id: "u", role: "user", content: "(stored question)" }];
  for (const [i, a] of answers.entries()) {
    a.parts.forEach((p: any, j: number) => {
      const id = `${i}-${j}`;
      if (p.type === "text") out.push({ id, role: "assistant", content: p.text });
      const args = p.type === "tool" ? parse(p.args) : null;
      if (args && p.name === "generateSandboxedUi")
        out.push({ id, role: "activity", activityType: "open-generative-ui", content: contentFromArgs(args) });
      if (args && p.name === "render_a2ui")
        out.push({ id, role: "activity", activityType: "a2ui-surface", content: { a2ui_operations: [
          { version: "v0.9", createSurface: { surfaceId: args.surfaceId, catalogId: "copilotkit://deskmate-tables" } },
          { version: "v0.9", updateComponents: { surfaceId: args.surfaceId, components: args.components } },
        ] } });
    });
  }
  return out;
}

function Inner({ id }: { id: string }) {
  const { agent, isReady } = useAgent({ agentId: "default" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || !isReady) return; // before isReady the hook returns a throwaway provisional agent
    const delay = Number(new URLSearchParams(location.search).get("delay") ?? 0); // after /connect has settled
    fetch(`/api/backend/answers/${id}`).then((r) => r.json()).then((answers) => {
      setTimeout(() => agent.setMessages(toMessages(answers)), delay);
      setLoaded(true);
    });
  }, [agent, id, loaded, isReady]);
  return <CopilotChat threadId={id} />;
}

export default function Hydrate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div style={{ height: "100vh" }}>
      <CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={a2ui} openGenerativeUI={ogui} renderActivityMessages={secureActivityRenderers} enableInspector={false}>
        <Inner id={id} />
      </CopilotKitProvider>
    </div>
  );
}
