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

export type ConversationSummary = components["schemas"]["ConversationSummaryOut"];
export type Conversation = components["schemas"]["ConversationOut"];

/** null when the backend says 404 or 422 (not there, or not a valid ID); any other failure throws, so an outage never reads as "empty". */
async function fetchJson<T>(path: string, cookie: string): Promise<T | null> {
  const response = await fetch(`${backendUrl}${path}`, { headers: { cookie }, cache: "no-store" });
  if (response.status === 404 || response.status === 422) return null;
  if (!response.ok) throw new Error(`Backend ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** The signed-in User's own Conversations, newest first. */
export async function fetchConversations(cookie: string): Promise<ConversationSummary[]> {
  return (await fetchJson<ConversationSummary[]>("/conversations", cookie)) ?? [];
}

/** One Conversation of the signed-in User; null when it is not theirs or does not exist. */
export function fetchConversation(cookie: string, id: string): Promise<Conversation | null> {
  return fetchJson<Conversation>(`/conversations/${encodeURIComponent(id)}`, cookie);
}

export type ChoosableModel = components["schemas"]["ChoosableModelOut"];
export type Provider = components["schemas"]["ProviderOut"];

/** The Models the signed-in User's Organization offers. */
export async function fetchModels(cookie: string): Promise<ChoosableModel[]> {
  return (await fetchJson<ChoosableModel[]>("/models", cookie)) ?? [];
}

/** The Organization's Providers; the backend refuses anyone but an Admin. */
export async function fetchProviders(cookie: string): Promise<Provider[]> {
  return (await fetchJson<Provider[]>("/providers", cookie)) ?? [];
}

export type OrganizationUser = components["schemas"]["UserOut"];

/** The Organization's Users; the backend refuses anyone but an Admin. */
export async function fetchUsers(cookie: string): Promise<OrganizationUser[]> {
  return (await fetchJson<OrganizationUser[]>("/users", cookie)) ?? [];
}

export type LinkPreview = components["schemas"]["LinkPreviewOut"];

/** Who an Invitation or password reset link is for, or the error code saying why it cannot be used. No session: the link is the proof. */
export async function fetchLinkPreview(kind: "invitations" | "password-resets", token: string): Promise<LinkPreview | { code: string }> {
  const response = await fetch(`${backendUrl}/${kind}/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (response.ok) return (await response.json()) as LinkPreview;
  const body = await response.json().catch(() => null);
  return { code: typeof body?.detail?.code === "string" ? body.detail.code : "generic" };
}
