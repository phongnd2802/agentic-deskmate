"use client";

import { CopilotChat, CopilotChatInput, CopilotKitProvider, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { CircleAlert, CircleStop, Lock, RotateCcw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ChoosableModel } from "@/lib/backend";

const AGENT_ID = "default";

// The composer is locked once the Conversation has its Answer; the slot component reads this.
const LockedContext = createContext(false);

// The Models to offer and the one picked; the composer slot components read this.
const ModelContext = createContext<{ models: ChoosableModel[]; selected: ChoosableModel; select: (id: string) => void } | null>(null);

// What the backend says wrote the Answer, once a run has started. After that the picker gives way to it, so a retry
// can never be labelled with a Model the User changed their mind about.
type Used = { provider_name: string; model_id: string };
const UsedContext = createContext<Used | null>(null);

const modelLabel = (model: Used) => `${model.provider_name} · ${model.model_id}`;

function ModelPicker() {
  const t = useTranslations("chat");
  const { models, selected, select } = useContext(ModelContext)!;
  const used = useContext(UsedContext);
  if (used) return <span className="px-2 font-mono text-xs text-muted-foreground">{modelLabel(used)}</span>;
  return (
    <div className="flex items-center gap-2 px-2">
      <Label htmlFor="model-picker" className="text-xs text-muted-foreground">
        {t("model")}
      </Label>
      <Select
        id="model-picker"
        value={selected.id}
        onChange={(event) => select(event.target.value)}
        className="w-auto max-w-48 sm:max-w-64"
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {modelLabel(model)}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ComposerOrLock(props: ComponentProps<typeof CopilotChatInput>) {
  const t = useTranslations("chat");
  const used = useContext(UsedContext);
  if (useContext(LockedContext)) {
    return (
      <div role="status" className="mx-auto w-full max-w-3xl space-y-1 px-4 pb-4 text-sm text-muted-foreground">
        {used && <p className="font-mono text-xs">{modelLabel(used)}</p>}
        <p className="flex items-start gap-2">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("locked")}
        </p>
      </div>
    );
  }
  return <CopilotChatInput {...props} addMenuButton={ModelPicker} />;
}

// The slot expects CopilotChatInput's static parts too, which the composer keeps using.
const Composer = Object.assign(ComposerOrLock, CopilotChatInput);

function ConversationChat({ threadId }: { threadId: string }) {
  const t = useTranslations("chat");
  const router = useRouter();
  const { agent } = useAgent({ agentId: AGENT_ID });
  const { copilotkit } = useCopilotKit();
  const [answered, setAnswered] = useState(false);
  const [used, setUsed] = useState<Used | null>(null);
  // How the last run ended when it left no complete Answer; a retry is offered for both.
  const [ended, setEnded] = useState<"stopped" | "failed" | null>(null);
  const endedRef = useRef(ended);
  endedRef.current = ended;
  // A retry is in flight: the composer shows Stop again and the Retry button waits for its outcome.
  const [retrying, setRetrying] = useState(false);
  const { selected } = useContext(ModelContext)!;
  const chatRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  // CopilotChat does not display errors, so a refused question is shown here.
  const [error, setError] = useState<string | null>(null); // a message key, so a language switch re-renders it

  useEffect(() => {
    const subscription = agent.subscribe({
      onRunStartedEvent: () => setError(null),
      onCustomEvent: ({ event }) => {
        if (event.name === "model") setUsed(event.value as Used);
      },
      onRunErrorEvent: ({ event }) => {
        setRetrying(false);
        // Stop aborts the browser's request, which the client reports as a run error with code "abort".
        const stopped = event.code === "abort";
        const failed = event.code === "model_failed";
        const key = `error.${event.code}`;
        if (!stopped) setError(event.code && t.has(key) ? key : "error.generic");
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
    void copilotkit.runAgent({ agent, forwardedProps: { retry: true, modelId: selected.id } });
  };

  return (
    <UsedContext.Provider value={used}>
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
                  {error && t(error)}
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
    </UsedContext.Provider>
  );
}

export function Chat({ models }: { models: ChoosableModel[] }) {
  // Every new ?n= value is a new Conversation: the Conversation ID is the AG-UI threadId.
  const fresh = useSearchParams().get("n");
  const [threadId, setThreadId] = useState<string>();
  useEffect(() => setThreadId(crypto.randomUUID()), [fresh]);
  const [picked, setPicked] = useState(models[0].id);
  // The list can change under an open page (an Admin edits a Provider); fall back to the first Model.
  const selected = models.find((model) => model.id === picked) ?? models[0];

  return (
    <ModelContext.Provider value={{ models, selected, select: setPicked }}>
      <CopilotKitProvider runtimeUrl="/api/copilotkit" properties={{ modelId: selected.id }}>
        {threadId && <ConversationChat key={threadId} threadId={threadId} />}
      </CopilotKitProvider>
    </ModelContext.Provider>
  );
}
