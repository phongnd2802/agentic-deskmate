import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ProvidersSettings } from "@/components/providers-settings";
import { getCurrentUser } from "@/lib/auth";
import { fetchProviders } from "@/lib/backend";

export default async function SettingsPage() {
  // Hiding the link is not the guard: the backend refuses a Member's request too.
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  return (
    <section className="max-w-5xl space-y-4 p-4">
      <ProvidersSettings providers={await fetchProviders((await cookies()).toString())} />
    </section>
  );
}
