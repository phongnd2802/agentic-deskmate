"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { useTranslations } from "next-intl";

export default function ChatPage() {
  const t = useTranslations("chat");

  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <div className="h-dvh">
        <CopilotChat
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
    </CopilotKitProvider>
  );
}
