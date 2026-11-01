import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl({
  agentRules: false,
  serverExternalPackages: ["@copilotkit/runtime", "pino", "pino-pretty"],
});
