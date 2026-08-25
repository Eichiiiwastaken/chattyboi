import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowDownIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GenerationError } from "@/hooks/use-active-chat";
import { useMessages } from "@/hooks/use-messages";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { Greeting } from "./greeting";
import {
  AssistantErrorBlock,
  getMessageRenderSignature,
  PreviewMessage,
  ThinkingMessage,
} from "./message";

type MessagesProps = {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  status: UseChatHelpers<ChatMessage>["status"];
  votes: Vote[] | undefined;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  isArtifactVisible: boolean;
  isLoading?: boolean;
  selectedModelId: string;
  generationError: GenerationError | null;
  onBranchMessage?: (
    message: ChatMessage,
    modelId?: string
  ) => Promise<void> | void;
  onEditMessage?: (message: ChatMessage) => void;
  onQuoteSelection?: (text: string) => void;
  onRetryMessage?: (message: ChatMessage, modelId?: string) => void;
  searchSources?: Array<{ title: string; url: string }> | null;
  statsForNerds?: boolean;
  hasMoreMessages?: boolean;
  isLoadingEarlierMessages?: boolean;
  onLoadEarlierMessages?: () => Promise<boolean>;
  onSelectStarterPrompt: (prompt: string) => void;
};

const INITIAL_RENDERED_MESSAGES = 100;
const RENDER_MORE_MESSAGES = 100;

function PureMessages({
  addToolApprovalResponse,
  chatId,
  status,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  isArtifactVisible,
  isLoading,
  selectedModelId,
  generationError,
  onBranchMessage,
  onEditMessage,
  onQuoteSelection,
  onRetryMessage,
  searchSources,
  statsForNerds,
  hasMoreMessages,
  isLoadingEarlierMessages,
  onLoadEarlierMessages,
  onSelectStarterPrompt,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
    reset,
  } = useMessages({
    status,
  });

  useDataStream();

  const [renderWindow, setRenderWindow] = useState({
    chatId,
    count: INITIAL_RENDERED_MESSAGES,
  });
  const renderedMessageCount =
    renderWindow.chatId === chatId
      ? renderWindow.count
      : INITIAL_RENDERED_MESSAGES;
  const firstRenderedMessageIndex = Math.max(
    0,
    messages.length - renderedMessageCount
  );
  const renderedMessages = useMemo(
    () => messages.slice(firstRenderedMessageIndex),
    [firstRenderedMessageIndex, messages]
  );

  const retryErrorMessage = generationError ? messages.at(-1) : undefined;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      reset();
      setRenderWindow({ chatId, count: INITIAL_RENDERED_MESSAGES });
    }
  }, [chatId, reset]);

  const shouldShowThinkingMessage =
    !generationError &&
    (status === "submitted" || status === "streaming") &&
    messages.at(-1)?.role !== "assistant";
  const shouldShowStandaloneError =
    generationError && messages.at(-1)?.role !== "assistant";

  return (
    <div className="relative flex-1 bg-background">
      {messages.length === 0 && !isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Greeting onSelectPrompt={onSelectStarterPrompt} />
        </div>
      )}
      <div
        className={cn(
          "absolute inset-0 touch-pan-y overflow-y-auto",
          messages.length > 0 ? "bg-background" : "bg-transparent"
        )}
        ref={messagesContainerRef}
        style={isArtifactVisible ? { scrollbarWidth: "none" } : undefined}
      >
        <div className="mx-auto flex min-h-full min-w-0 max-w-4xl flex-col gap-5 px-3 py-5 sm:px-4 md:gap-7 md:py-6">
          {(firstRenderedMessageIndex > 0 || hasMoreMessages) && (
            <button
              className="mx-auto rounded-full border border-border/50 bg-card/70 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              disabled={isLoadingEarlierMessages}
              onClick={async () => {
                if (firstRenderedMessageIndex === 0 && hasMoreMessages) {
                  const loaded = await onLoadEarlierMessages?.();
                  if (loaded === false) {
                    return;
                  }
                }
                setRenderWindow((currentWindow) => ({
                  chatId,
                  count:
                    (currentWindow.chatId === chatId
                      ? currentWindow.count
                      : INITIAL_RENDERED_MESSAGES) + RENDER_MORE_MESSAGES,
                }));
              }}
              type="button"
            >
              {isLoadingEarlierMessages
                ? "Loading earlier messages..."
                : firstRenderedMessageIndex > 0
                  ? `Show earlier messages (${firstRenderedMessageIndex})`
                  : "Load earlier messages"}
            </button>
          )}

          {renderedMessages.map((message, renderedIndex) => {
            const index = firstRenderedMessageIndex + renderedIndex;
            return (
              <PreviewMessage
                addToolApprovalResponse={addToolApprovalResponse}
                chatId={chatId}
                generationError={
                  generationError &&
                  index === messages.length - 1 &&
                  message.role === "assistant"
                    ? generationError
                    : null
                }
                isLoading={
                  status === "streaming" && messages.length - 1 === index
                }
                isReadonly={isReadonly}
                key={message.id}
                message={message}
                messageSignature={getMessageRenderSignature(message)}
                onBranchMessage={onBranchMessage}
                onEdit={onEditMessage}
                onQuoteSelection={onQuoteSelection}
                onRetryMessage={onRetryMessage}
                regenerate={regenerate}
                requiresScrollPadding={
                  hasSentMessage && index === messages.length - 1
                }
                searchSources={
                  index === messages.length - 1 ? searchSources : null
                }
                selectedModelId={selectedModelId}
                setMessages={setMessages}
                statsForNerds={statsForNerds}
              />
            );
          })}

          {shouldShowThinkingMessage && <ThinkingMessage />}

          {shouldShowStandaloneError && (
            <div
              className="group/message w-full"
              data-role="assistant"
              data-testid="message-assistant-error"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
                    <span className="text-[13px] leading-none">!</span>
                  </div>
                </div>
                <AssistantErrorBlock
                  detail={generationError.detail}
                  message={generationError.message}
                  onRetry={
                    retryErrorMessage && onRetryMessage
                      ? () => onRetryMessage(retryErrorMessage)
                      : undefined
                  }
                />
              </div>
            </div>
          )}

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </div>
      </div>

      <button
        aria-label="Scroll to bottom"
        className={`absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg transition-all duration-200 h-7 text-[10px] ${
          isAtBottom
            ? "pointer-events-none scale-90 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        }`}
        onClick={() => scrollToBottom("smooth")}
        type="button"
      >
        <ArrowDownIcon className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}

export const Messages = PureMessages;
