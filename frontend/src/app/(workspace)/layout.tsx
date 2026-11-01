import { getTranslations } from "next-intl/server";

import { Sidebar } from "@/components/sidebar";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("workspace");
  const items = [
    { href: "/dashboard", label: t("nav.dashboard") },
    { href: "/chat", label: t("nav.chat") },
    { href: "/agents", label: t("nav.agents") },
    { href: "/knowledge-bases", label: t("nav.knowledgeBases") },
  ];

  return (
    <div className="flex h-dvh">
      <Sidebar name={t("name")} navLabel={t("navLabel")} items={items} />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
