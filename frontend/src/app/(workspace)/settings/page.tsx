import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ProvidersSettings } from "@/components/providers-settings";
import { getCurrentUser } from "@/lib/auth";
import { UsersSettings } from "@/components/users-settings";
import { fetchProviders, fetchUsers } from "@/lib/backend";

export default async function SettingsPage() {
  // Hiding the link is not the guard: the backend refuses a Member's request too.
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  const cookie = (await cookies()).toString();
  return (
    <section className="max-w-5xl space-y-4 p-4">
      <ProvidersSettings providers={await fetchProviders(cookie)} />
      <UsersSettings users={await fetchUsers(cookie)} />
    </section>
  );
}
