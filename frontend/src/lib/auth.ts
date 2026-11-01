import { cookies } from "next/headers";

import { fetchCurrentUser } from "@/lib/backend";

export async function getCurrentUser() {
  return fetchCurrentUser((await cookies()).toString());
}
