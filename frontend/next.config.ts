import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl({
  agentRules: false,
  // ADR-0004: the sandbox's CSP cannot stop generated code from navigating its own frame away, so no page that renders
  // Generative UI may allow any frame. The header is bound when a document loads and Chat is reached by client-side
  // navigation from any page, so every page sends it. The sandbox itself is an srcdoc frame, which this does not cover.
  headers: async () => [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-src 'none'" }] }],
  serverExternalPackages: ["@copilotkit/runtime", "pino", "pino-pretty"],
});
