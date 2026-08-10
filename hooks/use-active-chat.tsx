"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { selectChatRequestMessages } from "@/lib/ai/chat-request";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { isReasoningEffort, type ReasoningEffort } from "@/lib/ai/reasoning";
import { isResearchMode, type ResearchMode } from "@/lib/ai/research";
import type { Settings, Vote } from "@/lib/db/schema";
import { ChatbotError, getErrorMessageFromUnknown } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";

type SearchSource = {
  title: string;
  url: string;
};

export type GenerationError = {
  message: string;
  detail?: string;
};

type ChatData = {
  hasMoreMessages: boolean;
  oldestMessageId: string | null;
  messages: ChatMessage[];
  visibility: VisibilityType;
  userId: string | null;
  isReadonly: boolean;
  lastModelId: string | null;
};

const STOPPED_STREAM_RESUME_SUPPRESSION_MS = 10_000;
// Rendering every streamed token can overwhelm React's external-store
// subscription path, particularly while a reasoning model emits a burst of
// small deltas. Keep the UI responsive while coalescing those updates.
const STREAM_RENDER_THROTTLE_MS = 50;

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  resumeStream: UseChatHelpers<ChatMessage>["resumeStream"];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  showCreditCardAlert: boolean;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: (enabled: boolean) => void;
  researchMode: ResearchMode;
  setResearchMode: (mode: ResearchMode) => void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  searchSources: SearchSource[] | null;
  setSearchSources: (sources: SearchSource[] | null) => void;
  generationError: GenerationError | null;
  clearGenerationError: () => void;
  setGenerationErrorFromUnknown: (error: unknown) => void;
  settings: Settings | null;
  isOneTimeChat: boolean;
  isNewChat: boolean;
  hasMoreMessages: boolean;
  isLoadingEarlierMessages: boolean;
  loadEarlierMessages: () => Promise<boolean>;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

function getCookieValue(name: string): string | null {
  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1];

  return cookie ? decodeURIComponent(cookie) : null;
}

export function getChatMessagesKey(chatId: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`;
}

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const isOneTimeChat = isNewChat && searchParams.get("temporary") === "true";
  const newChatIdRef = useRef(generateUUID());
  const currentChatRouteKey = `${pathname}?temporary=${isOneTimeChat}`;
  const prevChatRouteKeyRef = useRef(currentChatRouteKey);

  if (isNewChat && prevChatRouteKeyRef.current !== currentChatRouteKey) {
    newChatIdRef.current = generateUUID();
  }
  prevChatRouteKeyRef.current = currentChatRouteKey;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;
  const activeChatIdRef = useRef(chatId);
  activeChatIdRef.current = chatId;

  const [currentModelId, setCurrentModelIdState] = useState(DEFAULT_CHAT_MODEL);
  const currentModelIdRef = useRef(currentModelId);
  const setCurrentModelId = useCallback((id: string) => {
    currentModelIdRef.current = id;
    setCurrentModelIdState(id);
  }, []);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const [input, setInput] = useState("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const [researchMode, setResearchModeState] = useState<ResearchMode>("off");
  const researchModeRef = useRef<ResearchMode>(researchMode);
  const setResearchMode = useCallback((mode: ResearchMode) => {
    researchModeRef.current = mode;
    setResearchModeState(mode);
  }, []);
  const webSearchEnabled = researchMode !== "off";
  const setWebSearchEnabled = useCallback(
    (enabled: boolean) => setResearchMode(enabled ? "search" : "off"),
    [setResearchMode]
  );
  const [reasoningEffort, setReasoningEffortState] =
    useState<ReasoningEffort>("auto");
  const reasoningEffortRef = useRef(reasoningEffort);
  const setReasoningEffort = useCallback((effort: ReasoningEffort) => {
    reasoningEffortRef.current = effort;
    setReasoningEffortState(effort);
    window.localStorage.setItem("reasoning-effort", effort);
  }, []);

  useEffect(() => {
    const storedEffort = window.localStorage.getItem("reasoning-effort");
    if (isReasoningEffort(storedEffort)) {
      reasoningEffortRef.current = storedEffort;
      setReasoningEffortState(storedEffort);
    }
  }, []);
  const [searchSources, setSearchSources] = useState<SearchSource[] | null>(
    null
  );
  const [generationError, setGenerationError] =
    useState<GenerationError | null>(null);
  const clearGenerationError = useCallback(() => {
    setGenerationError(null);
  }, []);
  const setGenerationErrorFromUnknown = useCallback((error: unknown) => {
    const normalized = getErrorMessageFromUnknown(
      error,
      "The assistant response failed."
    );
    const [firstLine, ...detailLines] = normalized.message.split("\n");
    const detail = normalized.detail ?? detailLines.join("\n").trim();

    const nextError = {
      detail: detail || undefined,
      message: firstLine || "The assistant response failed.",
    };

    setGenerationError((currentError) => {
      if (
        currentError?.message === nextError.message &&
        currentError.detail === nextError.detail
      ) {
        return currentError;
      }

      return nextError;
    });
  }, []);

  const { data: chatData, isLoading } = useSWR<ChatData>(
    isNewChat ? null : getChatMessagesKey(chatId),
    fetcher,
    { revalidateOnFocus: false }
  );

  const [messagePagination, setMessagePagination] = useState({
    chatId: "",
    hasMore: false,
    isLoading: false,
    oldestMessageId: null as string | null,
  });

  useEffect(() => {
    if (!chatData || isNewChat || messagePagination.chatId === chatId) {
      return;
    }

    setMessagePagination({
      chatId,
      hasMore: chatData.hasMoreMessages,
      isLoading: false,
      oldestMessageId: chatData.oldestMessageId,
    });
  }, [chatData, chatId, isNewChat, messagePagination.chatId]);

  const { data: settingsData, error: settingsError } = useSWR<Settings>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/settings`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const settings = settingsData ?? null;

  // Apply settings defaults once on new chats
  const hasAppliedDefaultsRef = useRef(false);
  useEffect(() => {
    if (!settings || !isNewChat || hasAppliedDefaultsRef.current) {
      return;
    }
    hasAppliedDefaultsRef.current = true;

    if (settings.webSearchEnabled) {
      setResearchMode("search");
    }
  }, [settings, isNewChat, setResearchMode]);

  // Keep the messages passed to useChat referentially stable. In particular,
  // `chatData` is briefly undefined while navigating a newly submitted chat to
  // its permanent URL. Creating a new empty array on every render makes
  // useChat repeatedly synchronize its internal message store and can hit
  // React's maximum update depth as a stream finishes.
  const initialMessages = useMemo<ChatMessage[]>(
    () => (isNewChat ? [] : (chatData?.messages ?? [])),
    [chatData?.messages, isNewChat]
  );
  const visibility: VisibilityType = isNewChat
    ? "private"
    : (chatData?.visibility ?? "private");
  const manuallyStoppedChatIdsRef = useRef(new Map<string, number>());
  const regenerationRollbackRef = useRef<ChatMessage[] | null>(null);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop: stopChat,
    regenerate,
    resumeStream: resumeChatStream,
    addToolApprovalResponse,
    error: chatError,
    clearError: clearChatError,
  } = useChat<ChatMessage>({
    experimental_throttle: STREAM_RENDER_THROTTLE_MS,
    id: chatId,
    messages: initialMessages,
    generateId: generateUUID,
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      const shouldSend =
        lastMessage?.parts?.some(
          (part) =>
            "state" in part &&
            part.state === "approval-responded" &&
            "approval" in part &&
            (part.approval as { approved?: boolean })?.approved === true
        ) ?? false;

      if (shouldSend) {
        manuallyStoppedChatIdsRef.current.delete(chatId);
      }

      return shouldSend;
    },
    transport: new DefaultChatTransport({
      api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const requestMessages = selectChatRequestMessages({
          isOneTimeChat,
          messageId: request.messageId,
          messages: request.messages,
          trigger: request.trigger,
        });

        return {
          body: {
            id: request.id,
            ...requestMessages,
            trigger: request.trigger,
            messageId: request.messageId,
            selectedChatModel: currentModelIdRef.current,
            selectedReasoningEffort: reasoningEffortRef.current,
            selectedVisibilityType: visibility,
            researchMode: researchModeRef.current,
            isOneTimeChat,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: ({ isError }) => {
      // The AI SDK invokes onFinish after onError for the same failed request.
      // Failed regenerations are not persisted by the server. Restore the
      // previous client snapshot so its message IDs still match storage.
      if (isError) {
        const rollbackMessages = regenerationRollbackRef.current;
        regenerationRollbackRef.current = null;
        if (rollbackMessages) {
          setMessages(rollbackMessages);
        }
        return;
      }
      regenerationRollbackRef.current = null;
      clearGenerationError();
      if (!isOneTimeChat) {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
      }
    },
    onError: (error) => {
      if (error.message?.includes("AI Gateway requires a valid credit card")) {
        setGenerationErrorFromUnknown(error);
        setShowCreditCardAlert(true);
      } else if (error instanceof ChatbotError) {
        setGenerationErrorFromUnknown(error);
      } else {
        setGenerationErrorFromUnknown(error);
      }
    },
  });

  const stop = useCallback<UseChatHelpers<ChatMessage>["stop"]>(() => {
    // A delayed realtime stream-created event can arrive after the SDK has
    // changed the local status back to ready. Remember the user's intent so
    // that event cannot immediately reconnect the cancelled stream.
    manuallyStoppedChatIdsRef.current.set(chatId, Date.now());
    return stopChat();
  }, [chatId, stopChat]);

  const resumeStream = useCallback<UseChatHelpers<ChatMessage>["resumeStream"]>(
    (...args) => {
      const stoppedAt = manuallyStoppedChatIdsRef.current.get(chatId);
      if (stoppedAt !== undefined) {
        if (Date.now() - stoppedAt < STOPPED_STREAM_RESUME_SUPPRESSION_MS) {
          return Promise.resolve();
        }

        manuallyStoppedChatIdsRef.current.delete(chatId);
      }

      return resumeChatStream(...args);
    },
    [chatId, resumeChatStream]
  );

  const sendMessageWithErrorReset = useCallback<
    UseChatHelpers<ChatMessage>["sendMessage"]
  >(
    (...args) => {
      manuallyStoppedChatIdsRef.current.delete(chatId);
      regenerationRollbackRef.current = null;
      clearGenerationError();
      clearChatError();
      const sendPromise = sendMessage(...args);
      sendPromise.catch(setGenerationErrorFromUnknown);
      return sendPromise;
    },
    [
      clearChatError,
      clearGenerationError,
      chatId,
      sendMessage,
      setGenerationErrorFromUnknown,
    ]
  );

  const regenerateWithErrorReset = useCallback<
    UseChatHelpers<ChatMessage>["regenerate"]
  >(
    (...args) => {
      manuallyStoppedChatIdsRef.current.delete(chatId);
      regenerationRollbackRef.current = messages;
      clearGenerationError();
      clearChatError();
      const regeneratePromise = regenerate(...args);
      regeneratePromise.catch(setGenerationErrorFromUnknown);
      return regeneratePromise;
    },
    [
      clearChatError,
      clearGenerationError,
      chatId,
      messages,
      regenerate,
      setGenerationErrorFromUnknown,
    ]
  );

  useEffect(() => {
    if (status === "error" && chatError) {
      setGenerationErrorFromUnknown(chatError);
    }
  }, [chatError, setGenerationErrorFromUnknown, status]);

  const loadedChatIds = useRef(new Set<string>());

  if (isNewChat && !loadedChatIds.current.has(newChatIdRef.current)) {
    loadedChatIds.current.add(newChatIdRef.current);
  }

  useEffect(() => {
    if (loadedChatIds.current.has(chatId)) {
      return;
    }
    if (chatData?.messages) {
      loadedChatIds.current.add(chatId);
      setMessages(chatData.messages);
    }
  }, [chatId, chatData?.messages, setMessages]);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      regenerationRollbackRef.current = null;
      if (isNewChat) {
        setMessages([]);
      }
      clearGenerationError();
    }
  }, [chatId, clearGenerationError, isNewChat, setMessages]);

  const loadEarlierMessages = useCallback(async () => {
    const currentPagination =
      messagePagination.chatId === chatId
        ? messagePagination
        : {
            chatId,
            hasMore: chatData?.hasMoreMessages ?? false,
            isLoading: false,
            oldestMessageId: chatData?.oldestMessageId ?? null,
          };

    if (
      isNewChat ||
      currentPagination.isLoading ||
      !currentPagination.hasMore ||
      !currentPagination.oldestMessageId
    ) {
      return false;
    }

    setMessagePagination({ ...currentPagination, isLoading: true });

    try {
      const before = encodeURIComponent(currentPagination.oldestMessageId);
      const page = (await fetcher(
        `${getChatMessagesKey(chatId)}&before=${before}`
      )) as ChatData;
      if (activeChatIdRef.current !== chatId) {
        return false;
      }
      setMessages((currentMessages) => {
        const currentIds = new Set(
          currentMessages.map((currentMessage) => currentMessage.id)
        );
        return [
          ...page.messages.filter((message) => !currentIds.has(message.id)),
          ...currentMessages,
        ];
      });
      setMessagePagination({
        chatId,
        hasMore: page.hasMoreMessages,
        isLoading: false,
        oldestMessageId: page.oldestMessageId,
      });
      return true;
    } catch (error) {
      setMessagePagination({ ...currentPagination, isLoading: false });
      console.error("Failed to load earlier messages:", error);
      toast.error("Failed to load earlier messages. Please try again.");
      return false;
    }
  }, [
    chatData?.hasMoreMessages,
    chatData?.oldestMessageId,
    chatId,
    isNewChat,
    messagePagination,
    setMessages,
  ]);

  const lastAppliedModelForChatRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastAppliedModelForChatRef.current === chatId) {
      return;
    }

    if (isNewChat) {
      lastAppliedModelForChatRef.current = chatId;
      const cookieModel = getCookieValue("chat-model");
      if (cookieModel) {
        setCurrentModelId(cookieModel);
      }
      return;
    }

    if (!chatData) {
      return;
    }

    lastAppliedModelForChatRef.current = chatId;
    if (chatData.lastModelId) {
      setCurrentModelId(chatData.lastModelId);
    }
  }, [chatData, chatId, isNewChat, setCurrentModelId]);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q") ?? params.get("query");
    const searchParam = params.get("search");
    const researchParam = params.get("research");
    const effortParam = params.get("effort");

    if (query && !hasAppendedQueryRef.current) {
      if (settingsData === undefined && !settingsError) {
        return;
      }

      hasAppendedQueryRef.current = true;

      // Enable web search if ?search=true or ?search=1 is present
      const requestedResearchMode = isResearchMode(researchParam)
        ? researchParam
        : searchParam === "deep"
          ? "deep"
          : searchParam === "true" || searchParam === "1"
            ? "search"
            : "off";
      setResearchMode(requestedResearchMode);

      if (isReasoningEffort(effortParam)) {
        setReasoningEffort(effortParam);
      }

      const urlDefaultModel = settings?.defaultSearchModel;
      if (urlDefaultModel) {
        setCurrentModelId(urlDefaultModel);
      }

      router.replace(
        isOneTimeChat
          ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/?temporary=true`
          : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );

      const send = () => {
        sendMessageWithErrorReset(
          {
            role: "user" as const,
            parts: [{ type: "text", text: query }],
          },
          requestedResearchMode === "off"
            ? undefined
            : { body: { researchMode: requestedResearchMode } }
        );
      };

      send();
    }
  }, [
    sendMessageWithErrorReset,
    chatId,
    router,
    isOneTimeChat,
    settings?.defaultSearchModel,
    settingsData,
    settingsError,
    setReasoningEffort,
    setResearchMode,
    setCurrentModelId,
  ]);

  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);

  const { data: votes } = useSWR<Vote[]>(
    !isOneTimeChat && !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage: sendMessageWithErrorReset,
      status,
      stop,
      regenerate: regenerateWithErrorReset,
      resumeStream,
      addToolApprovalResponse,
      input,
      setInput,
      visibilityType: visibility,
      isReadonly,
      isLoading: !isNewChat && isLoading,
      votes,
      currentModelId,
      setCurrentModelId,
      showCreditCardAlert,
      setShowCreditCardAlert,
      webSearchEnabled,
      setWebSearchEnabled,
      researchMode,
      setResearchMode,
      reasoningEffort,
      setReasoningEffort,
      searchSources,
      setSearchSources,
      generationError,
      clearGenerationError,
      setGenerationErrorFromUnknown,
      settings,
      isOneTimeChat,
      isNewChat,
      hasMoreMessages:
        messagePagination.chatId === chatId
          ? messagePagination.hasMore
          : (chatData?.hasMoreMessages ?? false),
      isLoadingEarlierMessages:
        messagePagination.chatId === chatId && messagePagination.isLoading,
      loadEarlierMessages,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessageWithErrorReset,
      status,
      stop,
      regenerateWithErrorReset,
      resumeStream,
      addToolApprovalResponse,
      input,
      visibility,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      currentModelId,
      showCreditCardAlert,
      webSearchEnabled,
      setWebSearchEnabled,
      researchMode,
      setResearchMode,
      reasoningEffort,
      searchSources,
      generationError,
      clearGenerationError,
      setGenerationErrorFromUnknown,
      settings,
      isOneTimeChat,
      setReasoningEffort,
      setCurrentModelId,
      messagePagination,
      chatData?.hasMoreMessages,
      loadEarlierMessages,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
