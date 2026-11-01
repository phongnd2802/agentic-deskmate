import { routes } from "@/lib/runtime";

// Cookie must be listed: the default policy only forwards authorization and x-*.
export const { GET, POST } = routes("/api/copilotkit", { forwardHeaders: { allow: ["cookie", "authorization", "x-deskmate-test"] } });
