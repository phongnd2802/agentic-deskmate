import type { components } from "@/lib/api-types";

// Server-side only: the browser never talks to FastAPI (ADR-0003).
export const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

export type CurrentUser = components["schemas"]["CurrentUserOut"];

/** Ask FastAPI who the session cookie belongs to; null when signed out or unreachable. */
export async function fetchCurrentUser(cookie: string): Promise<CurrentUser | null> {
  try {
    const response = await fetch(`${backendUrl}/auth/me`, { headers: { cookie }, cache: "no-store" });
    return response.ok ? ((await response.json()) as CurrentUser) : null;
  } catch {
    return null;
  }
}
