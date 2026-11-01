"use client";

import { CopilotChat, CopilotChatInput, CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import { CircleAlert, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";

const AGENT_ID = "default";

// The composer is locked once the Conversation has its Answer; the slot component reads this.
const LockedContext = createContext(false);

function ComposerOrLock(props: ComponentProps<typeof CopilotChatInput>) {
  const t = useTranslations("chat");
  if (useContext(LockedContext)) {
    return (
      <p role="status" className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 pb-4 text-sm text-muted-foreground">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("locked")}
      </p>
    );
  }
  return <CopilotChatInput {...props} />;
}

// The slot expects CopilotChatInput's static parts too, which the composer keeps using.
const Composer = Object.assign(ComposerOrLock, CopilotChatInput);

function ConversationChat({ threadId }: { threadId: string }) {
  const t = useTranslations("chat");
  const router = useRouter();
  const { agent } = useAgent({ agentId: AGENT_ID });
  const [answered, setAnswered] = useState(false);
  // CopilotChat does not display errors, so a refused question is shown here.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subscription = agent.subscribe({
      onRunStartedEvent: () => setError(null),
      onRunErrorEvent: ({ event }) => {
        const key = `error.${event.code}`;
        setError(event.code && t.has(key) ? t(key) : t("error.generic"));
      },
      onRunFinishedEvent: () => {
        setAnswered(true);
        router.refresh(); // the new Conversation appears in the list
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, router, t]);

  return (
    <LockedContext.Provider value={answered}>
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <CopilotChat
            agentId={AGENT_ID}
            threadId={threadId}
            input={Composer}
            labels={{
              chatInputPlaceholder: t("inputPlaceholder"),
              chatInputToolbarSendButtonLabel: t("sendButton"),
              chatInputToolbarStopButtonLabel: t("stopButton"),
              chatDisclaimerText: t("disclaimer"),
              chatInputToolbarStartTranscribeButtonLabel: t("startTranscribeButton"),
              chatInputToolbarCancelTranscribeButtonLabel: t("cancelTranscribeButton"),
              chatInputToolbarFinishTranscribeButtonLabel: t("finishTranscribeButton"),
              chatInputToolbarAddButtonLabel: t("addButton"),
              chatInputToolbarToolsButtonLabel: t("toolsButton"),
              assistantMessageToolbarCopyCodeLabel: t("copyCode"),
              assistantMessageToolbarCopyCodeCopiedLabel: t("copiedCode"),
              assistantMessageToolbarCopyMessageLabel: t("copyMessage"),
              assistantMessageToolbarThumbsUpLabel: t("thumbsUp"),
              assistantMessageToolbarThumbsDownLabel: t("thumbsDown"),
              assistantMessageFeedbackCommentPlaceholder: t("feedbackCommentPlaceholder"),
              assistantMessageFeedbackCommentSubmitLabel: t("feedbackCommentSubmit"),
              assistantMessageToolbarReadAloudLabel: t("readAloud"),
              assistantMessageToolbarRegenerateLabel: t("regenerate"),
              assistantMessageToolbarInspectorLabel: t("inspector"),
              assistantMessageToolbarInspectorDescription: t("inspectorDescription"),
              assistantMessageToolbarInspectorLocalOnlyLabel: t("inspectorLocalOnly"),
              assistantMessageToolbarInspectorLocalOnlyDescription: t("inspectorLocalOnlyDescription"),
              assistantMessageToolbarInspectorTitle: t("inspectorTitle"),
              assistantMessageToolbarInspectorHideLabel: t("inspectorHide"),
              assistantMessageToolbarInspectorHideDescription: t("inspectorHideDescription"),
              userMessageToolbarCopyMessageLabel: t("copyUserMessage"),
              userMessageToolbarEditMessageLabel: t("editMessage"),
              userMessageToolbarPreviousBranchLabel: t("previousBranch"),
              userMessageToolbarNextBranchLabel: t("nextBranch"),
              chatToggleOpenLabel: t("toggleOpen"),
              chatToggleCloseLabel: t("toggleClose"),
              chatScrollToBottomLabel: t("scrollToBottom"),
              modalHeaderTitle: t("modalTitle"),
              welcomeMessageText: t("welcome"),
              reasoningMessageThinkingLabel: t("thinking"),
              chatInputSlashMenuLabel: t("slashMenu"),
              chatInputSlashMenuEmptyText: t("slashMenuEmpty"),
              attachmentRemoveButtonLabel: t("removeAttachment"),
              attachmentPlayVideoButtonLabel: t("playVideo"),
              attachmentPreviewCloseButtonLabel: t("closePreview"),
              modalHeaderCloseButtonLabel: t("close"),
              modalHeaderThreadsButtonLabel: t("openThreads"),
              sidebarLabel: t("sidebar"),
            }}
          />
        </div>
        {error && (
          <p role="alert" className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 pb-2 text-sm text-destructive">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </LockedContext.Provider>
  );
}

export default function ChatPage() {
  // Every new ?n= value is a new Conversation: the Conversation ID is the AG-UI threadId.
  const fresh = useSearchParams().get("n");
  const [threadId, setThreadId] = useState<string>();
  useEffect(() => setThreadId(crypto.randomUUID()), [fresh]);

  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      {threadId && <ConversationChat key={threadId} threadId={threadId} />}
    </CopilotKitProvider>
  );
}
