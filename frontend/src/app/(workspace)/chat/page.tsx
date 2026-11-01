import { CircleAlert } from "lucide-react";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { Chat } from "@/components/chat";
import { fetchModels } from "@/lib/backend";

export default async function ChatPage() {
  const models = await fetchModels((await cookies()).toString());
  if (models.length === 0) {
    const t = await getTranslations("chat");
    return (
      <p role="status" className="mx-auto flex max-w-3xl items-start gap-2 p-4 text-sm text-muted-foreground">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("noProvider")}
      </p>
    );
  }
  return <Chat models={models} />;
}
