"use client";
import { OpenGenerativeUIActivityRenderer, OpenGenerativeUIContentSchema, type SandboxFunction } from "@copilotkit/react-core/v2";
import { useMemo } from "react";
import { z } from "zod";

// ADR-0004. 'unsafe-inline' is needed by websandbox itself: its run() injects inline <script> tags.
export const CSP =
  "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

// Our <head> comes first, so a generated <head> or <script> can never run before the policy applies.
const HEAD = `<head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head>`;

/** The whole CSP enforcement: withhold html until complete (no CSP-less preview), then prepend the policy. */
export const secure = (c: any) => (c.htmlComplete ? { ...c, html: [HEAD, ...(c.html ?? [])] } : { ...c, html: undefined });

export function SecureOgui({ content, ...rest }: any) {
  const safe = useMemo(() => secure(content), [content]);
  return <OpenGenerativeUIActivityRenderer {...rest} content={safe} />;
}

export const secureActivityRenderers = [
  { activityType: "open-generative-ui", content: OpenGenerativeUIContentSchema, render: SecureOgui },
];

/** Stored tool args to the activity content the renderer expects. */
export const contentFromArgs = (a: any) => ({
  initialHeight: a.initialHeight,
  generating: false,
  css: a.css,
  cssComplete: true,
  html: [a.html ?? ""],
  htmlComplete: true,
  jsFunctions: a.jsFunctions,
  jsFunctionsComplete: true,
  jsExpressions: a.jsExpressions ?? [],
  jsExpressionsComplete: true,
});

export const openLink: SandboxFunction = {
  name: "openLink",
  description: "Opens an https link after the User confirms the full URL.",
  parameters: z.object({ url: z.string().url() }),
  handler: async (args: any) => {
    const { url } = z.object({ url: z.string().url() }).parse(args);
    if (new URL(url).protocol !== "https:") throw new Error("https only");
    if (!window.confirm(`Open this link?\n${url}`)) return { ok: false };
    window.open(url, "_blank", "noopener,noreferrer");
    return { ok: true };
  },
};
export const sandboxFunctions = [openLink];
