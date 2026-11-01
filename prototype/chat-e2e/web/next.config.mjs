export default {
  typescript: { ignoreBuildErrors: true }, // throwaway code
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["@copilotkit/runtime", "pino", "pino-pretty"],
  // ADR-0003: everything except Chat is a plain proxy to FastAPI, same origin for the browser.
  rewrites: async () => [{ source: "/api/backend/:path*", destination: "http://localhost:8100/:path*" }],
  // ?hostcsp=1 only: blocks a sandbox frame navigating itself, which the frame's own CSP cannot do.
  headers: async () => [
    {
      source: "/",
      has: [{ type: "query", key: "hostcsp" }],
      headers: [{ key: "Content-Security-Policy", value: "frame-src 'none'" }],
    },
  ],
};
