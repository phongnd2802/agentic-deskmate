"use client";
import { CopilotChat, CopilotChatInput, CopilotKitProvider, GenerateSandboxedUiArgsSchema, useAgent, useFrontendTool } from "@copilotkit/react-core/v2";
import { useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { tableCatalog } from "@/lib/catalog";
import { sandboxFunctions, secureActivityRenderers } from "@/lib/ogui";

const a2ui = { catalog: tableCatalog };
const noRenderers: any[] = [];
const noFunctions: any[] = [];
const oguiPlain = { sandboxFunctions: noFunctions };
const oguiFn = { sandboxFunctions };
const VI = {
  chatInputPlaceholder: "Nhập câu hỏi...",
  chatInputToolbarSendButtonLabel: "Gửi",
  chatInputToolbarStopButtonLabel: "Dừng",
  chatDisclaimerText: "AI có thể mắc lỗi.",
};

const Composer = createContext<any>(null);

function Input(props: any) {
  const { locked, picker, model, setModel } = useContext(Composer);
  if (locked) return <div data-testid="locked" role="status" style={{ padding: 16 }}>Conversation complete. Start a new one to ask again.</div>;
  const select = (
    <select aria-label="Model" data-testid="model" value={model} onChange={(e) => setModel(e.target.value)}>
      <option value="model-a">Model A</option>
      <option value="model-b">Model B</option>
    </select>
  );
  // picker=2 replaces the composer's add-menu button, so the picker sits inside the composer itself.
  if (picker === "2") return <CopilotChatInput {...props} addMenuButton={() => select} />;
  return <div>{picker && select}<CopilotChatInput {...props} /></div>;
}

// Replaces the built-in generateSandboxedUi (followUp: true) so the tool does not trigger a second run.
function NoFollowUp() {
  useFrontendTool({
    name: "generateSandboxedUi",
    description: "Render sandboxed UI",
    parameters: GenerateSandboxedUiArgsSchema,
    followUp: false,
    handler: async () => "UI generated",
  });
  return null;
}

function Chat({ thread, labels, onLock }: any) {
  const [error, setError] = useState<string>();
  const { agent } = useAgent({ agentId: "default" });
  useEffect(() => {
    (window as any).__agent = agent;
    const sub = agent.subscribe({
      onRunFinalized: () => { onLock(agent.messages.some((m: any) => m.role === "assistant")); },
    });
    return () => sub.unsubscribe();
  }, [agent, onLock]);
  return (
    <>
      {error && <div role="alert" data-testid="error" style={{ color: "#b00", padding: 8 }}>{error}</div>}
      <CopilotChat threadId={thread} labels={labels} input={Input as any} onError={(e: any) => setError(`${e.code ?? ""} ${e.error?.message}`)} />
    </>
  );
}

function App() {
  const q = useSearchParams();
  const [model, setModel] = useState("model-a");
  const [done, setDone] = useState(false);
  const thread = useMemo(() => q.get("thread") ?? crypto.randomUUID(), [q]);
  const lock = q.get("lock") === "1";
  const composer = useMemo(() => ({ locked: lock && done, picker: q.get("picker"), model, setModel }), [lock, done, q, model]);
  const properties = useMemo(() => ({ modelId: model }), [model]);
  const csp = q.get("csp") !== "off"; // csp=off keeps CopilotKit's stock renderer, for comparison
  return (
    <div style={{ height: "100vh" }}>
      <CopilotKitProvider
        runtimeUrl={q.get("rt") ? `/api/copilotkit-${q.get("rt")}` : "/api/copilotkit"}
        properties={properties}
        openGenerativeUI={q.get("fn") === "1" ? oguiFn : oguiPlain}
        a2ui={a2ui}
        renderActivityMessages={csp ? secureActivityRenderers : noRenderers}
        enableInspector={false}
      >
        <Composer.Provider value={composer}>
          {q.get("nofollow") === "1" && <NoFollowUp />}
          <Chat thread={thread} labels={q.get("vi") === "1" ? VI : undefined} onLock={setDone} />
        </Composer.Provider>
      </CopilotKitProvider>
    </div>
  );
}

export default function Page() {
  return <Suspense><App /></Suspense>;
}
