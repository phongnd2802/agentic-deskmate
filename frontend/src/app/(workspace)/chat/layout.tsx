import { cookies } from "next/headers";

import { ConversationList } from "@/components/conversation-list";
import { fetchConversations } from "@/lib/backend";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const conversations = await fetchConversations((await cookies()).toString());

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <ConversationList conversations={conversations} />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
