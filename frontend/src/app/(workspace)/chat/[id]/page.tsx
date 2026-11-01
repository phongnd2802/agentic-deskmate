import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AnswerText } from "@/components/answer-text";
import { fetchConversation } from "@/lib/backend";

// A read-only page: it runs no agent and mounts no CopilotChat.
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversation = await fetchConversation((await cookies()).toString(), id);
  if (!conversation) notFound();
  const t = await getTranslations("chat");

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <p aria-label={t("question")} className="ml-auto w-fit max-w-prose whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-prose">
        {conversation.question}
      </p>
      {conversation.answers.map((answer) => (
        <section key={answer.id} aria-label={t("answer")}>
          {answer.parts.map((part, index) => part.type === "text" && <AnswerText key={index} text={part.text} />)}
        </section>
      ))}
    </div>
  );
}
