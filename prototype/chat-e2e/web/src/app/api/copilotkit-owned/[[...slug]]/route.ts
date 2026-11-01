import { routes } from "@/lib/runtime";

// shortcut: trusts the cookie value as the user id. The product would ask FastAPI who the session belongs to.
const identifyUser = (req: Request) => {
  const id = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  return id ? { id, name: id } : undefined;
};

export const { GET, POST } = routes("/api/copilotkit-owned", { identifyUser, forwardHeaders: { allow: ["cookie"] } });
