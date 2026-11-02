"use client";

import {
  GenerateSandboxedUiArgsSchema,
  OpenGenerativeUIActivityRenderer,
  OpenGenerativeUIContentSchema,
  SandboxFunctionsContext,
  useFrontendTool,
  type SandboxFunction,
} from "@copilotkit/react-core/v2";
import { LayoutTemplate } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Content = z.infer<typeof OpenGenerativeUIContentSchema>;

// Typed as the stock renderer's props say, though it reads only the content.
const StockRenderer = OpenGenerativeUIActivityRenderer as (props: { content: Content }) => ReactElement;

// ADR-0004. 'unsafe-inline' is needed because the sandbox injects generated code as inline scripts.
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

// The sandbox cannot see the host's CSS variables, so their resolved values go in with the code.
// shortcut: read once when the sandbox is built, so a theme switch needs a reload; upgrade with a theme switcher.
function sandboxHead() {
  const root = getComputedStyle(document.documentElement);
  const tokens = ["background", "foreground", "muted-foreground", "muted", "border", "primary", "primary-foreground"]
    .map((name) => `--${name}:${root.getPropertyValue(`--${name}`).trim()}`)
    .join(";");
  // Ours comes first, so generated code cannot run before the policy applies.
  return (
    `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<style>:root{${tokens};color-scheme:${root.colorScheme || "light"}}` +
    "body{margin:0;font:14px/20px system-ui,sans-serif;color:var(--foreground);background:var(--background)}</style></head>"
  );
}

/**
 * Both live and reopened Generative UI render here. The stock renderer is given html only once it is complete,
 * because its streaming preview has no CSP. Until then, and while the sandbox loads, the User sees a placeholder.
 */
function SandboxedUi({ content, live }: { content: Content; live: boolean }) {
  const t = useTranslations("generativeUi");
  const [head, setHead] = useState<string>();
  useEffect(() => setHead(sandboxHead()), []);
  const frame = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  // MASTER §4: a placeholder shows only for waits over 300ms. A reopened render has none and is hidden until drawn.
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = live ? setTimeout(() => setLate(true), 300) : undefined;
    return () => clearTimeout(timer);
  }, [live]);
  useEffect(() => {
    const element = frame.current!;
    const watch = new MutationObserver(() => element.querySelector("iframe") && setDrawn(true));
    watch.observe(element, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);

  const ready = !!content.htmlComplete && !!head;
  const safe = useMemo(
    // The renderer measures the sandbox's height when generating turns false, and ignores that if the sandbox is not
    // created yet, so generating stays true until the frame exists.
    () => (ready ? { ...content, html: [head!, ...(content.html ?? [])], generating: content.generating !== false || !drawn } : null),
    [content, head, ready, drawn],
  );

  return (
    <div ref={frame} className={cn("relative", !drawn && !(live && late) && "invisible")} style={drawn ? undefined : { height: content.initialHeight ?? 200 }}>
      {safe && <StockRenderer content={safe} />}
      {!drawn && live && late && (
        <div role="status" className="absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-lg bg-muted text-sm text-muted-foreground">
          <LayoutTemplate aria-hidden className="size-4" />
          {t("writing")}
        </div>
      )}
    </div>
  );
}

// True once the run that was writing the interface has stopped or failed; set by the page that owns the run.
export const RunHaltedContext = createContext(false);

function LiveGenerativeUi({ content, message, agent }: { content: Content; message: { id: string }; agent?: { messages: { id: string }[] } }) {
  const halted = useContext(RunHaltedContext);
  // A placeholder of a run that stopped or failed, or of an earlier run that a retry replaced, would wait for code that never comes.
  if (!content.htmlComplete && (halted || agent?.messages.at(-1)?.id !== message.id)) return null;
  return <SandboxedUi content={content} live />;
}

/** Registered over the stock tool so that the call is not followed by a second run (ADR-0002); the sandbox renders it. */
export function useSandboxedUiTool() {
  useFrontendTool({
    name: "generateSandboxedUi",
    description:
      "Render an interactive interface in a sandbox. html is the markup with a <head> and a <body>, css its styles, " +
      "jsFunctions the functions it calls, and jsExpressions statements run once the page has loaded, such as event listeners. " +
      "initialHeight is in pixels.",
    parameters: GenerateSandboxedUiArgsSchema.omit({ placeholderMessages: true }),
    followUp: false,
    handler: async () => "UI generated",
  });
}

/** The activity renderer to register on CopilotKitProvider in place of the stock one. */
export const generativeUiRenderers = [
  { activityType: "open-generative-ui", content: OpenGenerativeUIContentSchema, render: LiveGenerativeUi },
];

/** The tool arguments of a stored Answer, or null when they are partial or not a usable interface. */
function parseStored(raw: string) {
  try {
    // The backend's RenderArgs says the same: what it lets through must render here.
    return GenerateSandboxedUiArgsSchema.omit({ placeholderMessages: true })
      .required({ html: true })
      .refine((args) => args.html.trim() !== "")
      .parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A stored Generative UI, rendered with no agent run. */
export function StoredGenerativeUi({ args }: { args: string }) {
  const { sandboxFunctions, linkDialog } = useOpenLink();
  const parsed = useMemo(() => parseStored(args), [args]);
  const content = useMemo<Content | null>(
    () =>
      parsed && {
        initialHeight: parsed.initialHeight,
        generating: false,
        css: parsed.css,
        cssComplete: true,
        html: [parsed.html],
        htmlComplete: true,
        jsFunctions: parsed.jsFunctions,
        jsFunctionsComplete: true,
        jsExpressions: parsed.jsExpressions ?? [],
        jsExpressionsComplete: true,
      },
    [parsed],
  );
  if (!content) return null;
  return (
    <SandboxFunctionsContext.Provider value={sandboxFunctions}>
      <SandboxedUi content={content} live={false} />
      {linkDialog}
    </SandboxFunctionsContext.Provider>
  );
}

const openLinkArgs = z.object({ url: z.string().url() });

/** The one function generated code may call: open an https link once the User has seen the full address. */
export function useOpenLink() {
  const t = useTranslations("generativeUi");
  const [asking, setAsking] = useState<string | null>(null);
  const settle = useRef<((open: boolean) => void) | null>(null);
  const close = (open: boolean) => {
    const answer = settle.current;
    settle.current = null;
    answer?.(open);
    setAsking(null);
  };
  // A call never waits on a dialog that is gone.
  useEffect(() => () => settle.current?.(false), []);
  // A stable array: a new one would rebuild every sandbox.
  const sandboxFunctions = useMemo<SandboxFunction[]>(
    () => [
      {
        name: "openLink",
        description: "Opens an https link after the User confirms the full address.",
        parameters: openLinkArgs,
        handler: async (args) => {
          // What is shown and opened is the parsed address, so the host the User reads is the host that opens.
          const { href, protocol } = new URL(openLinkArgs.parse(args).url);
          if (protocol !== "https:") throw new Error("Only https links can be opened");
          // Generated code must not swap the address under an open dialog.
          if (settle.current) throw new Error("Another link is waiting for confirmation");
          const confirmed = await new Promise<boolean>((resolve) => {
            settle.current = resolve;
            setAsking(href);
          });
          if (confirmed) window.open(href, "_blank", "noopener,noreferrer");
          return { ok: confirmed };
        },
      },
    ],
    [],
  );
  const linkDialog = (
    <Dialog open={asking !== null} onOpenChange={(open) => !open && close(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("openLinkTitle")}</DialogTitle>
          <DialogDescription>{t("openLinkBody")}</DialogDescription>
        </DialogHeader>
        <p className="break-all font-mono text-sm">{asking}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => close(true)}>{t("open")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { sandboxFunctions, linkDialog };
}
