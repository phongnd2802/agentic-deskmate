"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { navLinkClass } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import type { ConversationSummary } from "@/lib/backend";

export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  const t = useTranslations("chat");
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex max-h-40 w-full shrink-0 flex-col gap-2 border-b border-sidebar-border bg-sidebar p-2 text-sidebar-foreground md:max-h-none md:w-56 md:border-b-0 md:border-r">
      {/* A fresh ?n= makes the Chat page start a new Conversation even when it is already open. */}
      <Button variant="outline" onClick={() => router.push(`/chat?n=${Date.now()}`)}>
        <Plus aria-hidden />
        {t("newConversation")}
      </Button>
      <nav aria-label={t("conversations")} className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">{t("noConversations")}</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conversation) => {
              const href = `/chat/${conversation.id}`;
              return (
                <li key={conversation.id}>
                  <Link
                    href={href}
                    title={conversation.question}
                    aria-current={pathname === href ? "page" : undefined}
                    className={navLinkClass(pathname === href)}
                  >
                    <span className="truncate">{conversation.question}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
