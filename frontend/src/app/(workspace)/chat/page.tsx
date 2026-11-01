"use client";

import { CopilotChat, CopilotChatInput, CopilotKitProvider, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { CircleAlert, CircleStop, Lock, RotateCcw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

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
  const { copilotkit } = useCopilotKit();
  const [answered, setAnswered] = useState(false);
  // How the last run ended when it left no complete Answer; a retry is offered for both.
  const [ended, setEnded] = useState<"stopped" | "failed" | null>(null);
  const endedRef = useRef(ended);
  endedRef.current = ended;
  // A retry is in flight: the composer shows Stop again and the Retry button waits for its outcome.
  const [retrying, setRetrying] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  // CopilotChat does not display errors, so a refused question is shown here.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subscription = agent.subscribe({
      onRunStartedEvent: () => setError(null),
      onRunErrorEvent: ({ event }) => {
        setRetrying(false);
        // Stop aborts the browser's request, which the client reports as a run error with code "abort".
        const stopped = event.code === "abort";
        const failed = event.code === "model_failed";
        const key = `error.${event.code}`;
        if (!stopped) setError(event.code && t.has(key) ? t(key) : t("error.generic"));
        if (stopped || failed) {
          setEnded(stopped ? "stopped" : "failed");
          setAnswered(true);
          router.refresh();
        } else if (endedRef.current) {
          setAnswered(true); // a refused retry leaves the earlier outcome and its Retry in place
        }
      },
      onRunFinishedEvent: () => {
        setRetrying(false);
        setEnded(null);
        setAnswered(true);
        router.refresh(); // the new Conversation appears in the list
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, router, t]);

  // Focus follows the controls: Retry after a run ends, the composer once Retry has gone.
  useEffect(() => {
    if (retrying) chatRef.current?.querySelector("textarea")?.focus();
    else if (ended) retryRef.current?.focus();
  }, [ended, retrying]);

  const retry = () => {
    setRetrying(true);
    setAnswered(false);
    void copilotkit.runAgent({ agent, forwardedProps: { retry: true } });
  };

  return (
    <LockedContext.Provider value={answered}>
      <div className="flex h-full flex-col">
        <div ref={chatRef} className="min-h-0 flex-1">
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
        {(error || ended) && !retrying && (
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 pb-2 text-sm">
            {ended === "stopped" && !error ? (
              <p role="status" className="flex items-start gap-2 text-warning">
                <CircleStop aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t("stopped")}
              </p>
            ) : (
              <p role="alert" className="flex items-start gap-2 text-destructive">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}
            {ended && (
              <Button ref={retryRef} variant="outline" size="sm" onClick={retry}>
                <RotateCcw aria-hidden />
                {t("retry")}
              </Button>
            )}
          </div>
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
