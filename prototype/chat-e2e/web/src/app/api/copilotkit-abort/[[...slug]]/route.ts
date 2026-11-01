import { routes } from "@/lib/runtime";

// Stops the run when the browser disconnects (tab close).
export const { GET, POST } = routes("/api/copilotkit-abort", { stopOnDisconnect: true });
