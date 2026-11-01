"use client";

import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";

/** Markdown rendered by the same renderer as a live Answer, so a reopened Conversation looks identical. */
export function AnswerText({ text }: { text: string }) {
  return (
    <div data-copilotkit>
      <div className="cpk:prose">
        <CopilotChatAssistantMessage.MarkdownRenderer content={text} />
      </div>
    </div>
  );
}
