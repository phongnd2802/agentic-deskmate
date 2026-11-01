import { Bot, BookOpen, LayoutDashboard, MessageSquare } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const t = await getTranslations("workspace");
  const items = [
    { href: "/dashboard", label: t("nav.dashboard"), icon: <LayoutDashboard aria-hidden /> },
    { href: "/chat", label: t("nav.chat"), icon: <MessageSquare aria-hidden /> },
    { href: "/agents", label: t("nav.agents"), icon: <Bot aria-hidden /> },
    { href: "/knowledge-bases", label: t("nav.knowledgeBases"), icon: <BookOpen aria-hidden /> },
  ];

  return (
    <div className="flex h-dvh">
      <Sidebar name={t("name")} navLabel={t("navLabel")} items={items} user={user} />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}