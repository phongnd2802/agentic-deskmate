import { routes } from "@/lib/runtime";

// Same runtime with the default forwardHeaders, to show what is dropped.
export const { GET, POST } = routes("/api/copilotkit-default");
