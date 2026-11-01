"use client";
// ADR-0002 read-only reopen: no CopilotKitProvider, no CopilotChat, no agent run.
import { A2UIProvider, A2UIRenderer, initializeDefaultCatalog, injectStyles, useA2UIActions, viewerTheme } from "@copilotkit/a2ui-renderer";
import { SandboxFunctionsContext } from "@copilotkit/react-core/v2";
import { use, useEffect, useState } from "react";
import { tableCatalog } from "@/lib/catalog";
import { contentFromArgs, sandboxFunctions, SecureOgui } from "@/lib/ogui";

const parse = (a: any) => { try { return typeof a === "string" ? JSON.parse(a) : a; } catch { return null; } };

function Feed({ operations }: { operations: any[] }) {
  const { processMessages } = useA2UIActions();
  useEffect(() => processMessages(operations), [operations, processMessages]);
  return null;
}

function StoredTable({ args }: { args: any }) {
  const [ops] = useState(() => {
    initializeDefaultCatalog();
    injectStyles();
    return [
      { version: "v0.9", createSurface: { surfaceId: args.surfaceId, catalogId: "copilotkit://deskmate-tables" } },
      { version: "v0.9", updateComponents: { surfaceId: args.surfaceId, components: args.components } },
    ];
  });
  return (
    // onAction is a no-op: reopen is read-only, a surface action must not start a run.
    <A2UIProvider theme={viewerTheme} catalog={tableCatalog} onAction={() => {}}>
      <Feed operations={ops} />
      <A2UIRenderer surfaceId={args.surfaceId} />
    </A2UIProvider>
  );
}

// The renderer only measures height on the generating true-to-false edge, once the sandbox exists.
// Stored content starts false, so without this the frame stays at initialHeight and clips.
function StoredOgui({ args }: { args: any }) {
  const [c, setC] = useState(() => ({ ...contentFromArgs(args), generating: true }));
  useEffect(() => {
    const t = setTimeout(() => setC((p) => ({ ...p, generating: false })), 600);
    return () => clearTimeout(t);
  }, []);
  return <SecureOgui content={c} />;
}

function Part({ part }: { part: any }) {
  if (part.type === "text") return <p data-testid="stored-text">{part.text}</p>;
  const args = parse(part.args);
  if (!args) return <p data-testid="stored-partial">[{part.name}: stopped before the arguments were complete]</p>;
  if (part.name === "generateSandboxedUi") return <StoredOgui args={args} />;
  if (part.name === "render_a2ui") return <StoredTable args={args} />;
  return null;
}

export default function Reopen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [answers, setAnswers] = useState<any[]>();
  useEffect(() => { fetch(`/api/backend/answers/${id}`).then((r) => r.json()).then(setAnswers); }, [id]);
  return (
    <SandboxFunctionsContext.Provider value={sandboxFunctions}>
      <main style={{ maxWidth: 800, margin: "0 auto", fontFamily: "sans-serif" }}>
        <h1>Stored Conversation</h1>
        {answers?.map((a) => (
          <article key={a.id} data-testid="answer" data-status={a.status}>
            <small>{a.status}</small>
            {a.parts.map((p: any, i: number) => <Part key={i} part={p} />)}
          </article>
        ))}
      </main>
    </SandboxFunctionsContext.Provider>
  );
}
