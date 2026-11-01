import { cookies } from "next/headers";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

export type CurrentUser = {
  id: string;
  email: string;
  role: "admin" | "member";
  locale: string;
  organization: { id: string; name: string };
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieHeader = (await cookies()).toString();
  try {
    const response = await fetch(`${backendUrl}/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as CurrentUser;
  } catch {
    return null;
  }
}
