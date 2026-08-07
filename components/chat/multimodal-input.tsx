"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import equal from "fast-deep-equal";
import {
  AlertTriangleIcon,
  BrainIcon,
  ChevronDownIcon,
  GaugeIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useIsMobile } from "@/hooks/use-mobile";
import { MODELS_API_PATH } from "@/lib/ai/model-api";
import {
  type ChatModel,
  DEFAULT_CHAT_MODEL,
  type ModelCapabilities,
  titleModel,
} from "@/lib/ai/models";
import type { ReasoningEffort } from "@/lib/ai/reasoning";
import { markdownFromClipboard } from "@/lib/markdown/clipboard";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  StopIcon,
  T3AttachIcon,
  T3GlobeIcon,
  T3GlobeOffIcon,
  T3SendIcon,
} from "./icons";
import { ModelPickerContent } from "./model-picker";
import { PreviewAttachment } from "./preview-attachment";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import {
  type SlashCommand,
  SlashCommandMenu,
  slashCommands,
} from "./slash-commands";
import type { VisibilityType } from "./visibility-selector";

function setCookie(name: string, value: string) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: needed for client-side cookie setting
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}

function modelFromId(modelId: string): ChatModel {
  const [provider = "unknown", ...rest] = modelId.split("/");
  const name = rest.length > 0 ? rest.join("/") : modelId;

  return {
    id: modelId,
    name,
    provider,
    description: "",
  };
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages: _messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType: _selectedVisibilityType,
  selectedModelId,
  onModelChange,
  selectedReasoningEffort,
  onReasoningEffortChange,
  editingMessage,
  onCancelEdit,
  isLoading: _isLoading,
  isOneTimeChat,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage:
    | UseChatHelpers<ChatMessage>["sendMessage"]
    | (() => Promise<void>);
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  selectedReasoningEffort: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  editingMessage?: ChatMessage | null;
  onCancelEdit?: () => void;
  isLoading?: boolean;
  isOneTimeChat?: boolean;
}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { setTheme, resolvedTheme } = useTheme();
  const { webSearchEnabled, setWebSearchEnabled, setSearchSources } =
    useActiveChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousChatIdRef = useRef(chatId);
  const { width } = useWindowSize();
  const hasAutoFocused = useRef(false);
  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        if (window.innerWidth >= 768) {
          textareaRef.current?.focus();
        }
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

  useEffect(() => {
    if (previousChatIdRef.current === chatId) {
      return;
    }

    previousChatIdRef.current = chatId;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatId]);

  useEffect(() => {
    if (!editingMessage) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editingMessage]);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${MODELS_API_PATH}`,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { revalidateOnFocus: false }
  );
  const capabilities: Record<string, ModelCapabilities> | undefined =
    modelsData?.capabilities ?? modelsData;
  const supportsAttachments = Boolean(
    capabilities?.[selectedModelId]?.vision ||
      capabilities?.[selectedModelId]?.file
  );
  const supportsReasoning = Boolean(capabilities?.[selectedModelId]?.reasoning);

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
    }
  }, [localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = event.target.value;
    setInput(val);

    if (val.startsWith("/") && !val.includes(" ")) {
      setSlashOpen(true);
      setSlashQuery(val.slice(1));
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    setSlashOpen(false);
    setInput("");
    switch (cmd.action) {
      case "new":
        router.push("/");
        break;
      case "temporary":
        router.push("/?temporary=true");
        break;
      case "clear":
        setMessages(() => []);
        break;
      case "rename":
        toast("Rename is available from the sidebar chat menu.");
        break;
      case "model": {
        const modelBtn = document.querySelector<HTMLButtonElement>(
          "[data-testid='model-selector']"
        );
        modelBtn?.click();
        break;
      }
      case "theme":
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        break;
      case "delete":
        if (isOneTimeChat) {
          setMessages(() => []);
          router.push("/");
          toast.success("One-time chat cleared");
          break;
        }
        toast("Delete this chat?", {
          action: {
            label: "Delete",
            onClick: async () => {
              const response = await fetch(
                `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatId}`,
                { method: "DELETE" }
              );

              if (!response.ok) {
                toast.error("Failed to delete chat");
                return;
              }

              await mutate(unstable_serialize(getChatHistoryPaginationKey));
              router.push("/");
              toast.success("Chat deleted");
            },
          },
        });
        break;
      default:
        break;
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<
    Array<{ name: string; url?: string; contentType?: string }>
  >([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const submitForm = useCallback(() => {
    if (!isOneTimeChat) {
      router.push(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`);
    }

    if (!webSearchEnabled) {
      setSearchSources(null);
    }

    sendMessage(
      {
        role: "user",
        parts: [
          ...attachments.map((attachment) => ({
            type: "file" as const,
            url: attachment.url,
            filename: attachment.name,
            mediaType: attachment.contentType,
          })),
          {
            type: "text",
            text: input,
          },
        ],
      },
      webSearchEnabled && input.trim()
        ? { body: { webSearchEnabled: true } }
        : undefined
    );

    setAttachments([]);
    setLocalStorageInput("");
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
    router,
    webSearchEnabled,
    setSearchSources,
    isOneTimeChat,
  ]);

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/files/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (response.ok) {
        const data = await response.json();
        const { url, contentType } = data;

        return {
          url,
          name: file.name || "Pasted image",
          contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (error) {
      console.error("Failed to upload file:", error);
      toast.error("Failed to upload file, please try again!");
    }
  }, []);

  const uploadFiles = useCallback(
    async (files: File[], fallbackName = "Pasted image") => {
      if (files.length === 0) {
        return;
      }

      const queueItems = files.map((file) => ({
        name: file.name || fallbackName,
        url: URL.createObjectURL(file),
        contentType: file.type,
      }));

      setUploadQueue((prev) => [...prev, ...queueItems]);

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) =>
            attachment !== undefined &&
            attachment.url !== undefined &&
            attachment.contentType !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...(successfullyUploadedAttachments as Attachment[]),
        ]);
      } catch (error) {
        console.error("Failed to upload files:", error);
        toast.error("Failed to upload files");
      } finally {
        setUploadQueue((prev) => {
          for (const item of queueItems) {
            if (item.url?.startsWith("blob:")) {
              URL.revokeObjectURL(item.url);
            }
          }

          return prev.filter(
            (item) => !queueItems.some((queued) => queued.url === item.url)
          );
        });
      }
    },
    [setAttachments, uploadFile]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      await uploadFiles(files);

      if (event.target) {
        event.target.value = "";
      }
    },
    [uploadFiles]
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const fileItems = Array.from(items).filter(
        (item) => item.kind === "file" && item.type.startsWith("image/")
      );
      const files = fileItems
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      const plainText = event.clipboardData.getData("text/plain");
      const pastedText = markdownFromClipboard(
        event.clipboardData.getData("text/html"),
        plainText
      );
      const shouldReplaceText = pastedText !== plainText;
      const shouldHandleFiles = files.length > 0;

      if (!shouldReplaceText && !shouldHandleFiles) {
        return;
      }

      event.preventDefault();

      if (pastedText) {
        const textarea = event.currentTarget;
        const selectionStart = textarea.selectionStart;
        const selectionEnd = textarea.selectionEnd;
        const nextValue =
          input.slice(0, selectionStart) +
          pastedText +
          input.slice(selectionEnd);
        const nextCaretPosition = selectionStart + pastedText.length;

        setInput(nextValue);
        window.requestAnimationFrame(() => {
          textarea.setSelectionRange(nextCaretPosition, nextCaretPosition);
        });
      }

      if (!shouldHandleFiles) {
        return;
      }

      if (!supportsAttachments) {
        toast.error("The selected model doesn't support image uploads.");
        return;
      }

      try {
        await uploadFiles(files, "Pasted image");
      } catch (_error) {
        toast.error("Failed to upload pasted image(s)");
      }
    },
    [input, setInput, supportsAttachments, uploadFiles]
  );

  useEffect(() => {
    const hasDraggedFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const resetDragState = () => {
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = supportsAttachments ? "copy" : "none";
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

      if (dragDepthRef.current === 0) {
        setIsDraggingFiles(false);
      }
    };

    const handleDrop = async (event: DragEvent) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      resetDragState();

      if (!supportsAttachments) {
        toast.error("The selected model doesn't support file uploads.");
        return;
      }

      const files = Array.from(event.dataTransfer?.files ?? []);
      await uploadFiles(files);
    };

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, [supportsAttachments, uploadFiles]);

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {isDraggingFiles && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-primary/70 border-dashed bg-background/70 text-sm font-medium text-foreground shadow-inner backdrop-blur-sm">
          Drop files to attach
        </div>
      )}

      {editingMessage && onCancelEdit && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>Editing message</span>
          <button
            className="rounded px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              onCancelEdit();
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}

      {supportsAttachments && (
        <input
          accept="image/jpeg,image/png,application/pdf"
          aria-hidden="true"
          className="pointer-events-none fixed -top-4 -left-4 size-0.5 opacity-0"
          multiple
          onChange={handleFileChange}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
      )}

      <div className="relative">
        {slashOpen && (
          <SlashCommandMenu
            onClose={() => setSlashOpen(false)}
            onSelect={handleSlashSelect}
            query={slashQuery}
            selectedIndex={slashIndex}
          />
        )}
      </div>

      <PromptInput
        className="[&>div]:rounded-2xl [&>div]:border [&>div]:border-border/30 [&>div]:bg-card/70 [&>div]:shadow-[var(--shadow-composer)] [&>div]:transition-shadow [&>div]:duration-300 [&>div]:focus-within:shadow-[var(--shadow-composer-focus)]"
        onSubmit={() => {
          if (input.startsWith("/")) {
            const query = input.slice(1).trim();
            const cmd = slashCommands.find((c) => c.name === query);
            if (cmd) {
              handleSlashSelect(cmd);
            }
            return;
          }
          if (!input.trim() && attachments.length === 0) {
            return;
          }
          if (status === "ready" || status === "error") {
            submitForm();
          } else {
            stop();
          }
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex w-full self-start flex-row gap-2 overflow-x-auto px-3 pt-3 no-scrollbar"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url)
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
            ))}

            {uploadQueue.map((item) => (
              <PreviewAttachment
                attachment={{
                  url: item.url || "",
                  name: item.name,
                  contentType: item.contentType || "",
                }}
                isUploading={true}
                key={item.url || item.name}
              />
            ))}
          </div>
        )}
        <PromptInputTextarea
          className="min-h-20 px-4 pt-3.5 pb-1.5 text-[16px] leading-relaxed placeholder:text-muted-foreground/35 sm:min-h-24 sm:text-[13px]"
          data-testid="multimodal-input"
          onChange={handleInput}
          onKeyDown={(e) => {
            if (slashOpen) {
              const filtered = slashCommands.filter((cmd) =>
                cmd.name.startsWith(slashQuery.toLowerCase())
              );
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => Math.min(i + 1, filtered.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (filtered[slashIndex]) {
                  handleSlashSelect(filtered[slashIndex]);
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlashOpen(false);
                return;
              }
            }
            if (e.key === "Escape" && editingMessage && onCancelEdit) {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          onPaste={handlePaste}
          placeholder={
            editingMessage ? "Edit your message..." : "Ask anything..."
          }
          ref={textareaRef}
          value={input}
        />
        <PromptInputFooter className="flex-wrap items-end gap-2 px-3 pb-3">
          <PromptInputTools className="min-w-0 flex-1 overflow-hidden">
            <WebSearchButton
              enabled={webSearchEnabled}
              onToggle={setWebSearchEnabled}
              status={status}
            />
            {supportsAttachments && (
              <AttachmentsButton
                fileInputRef={fileInputRef}
                selectedModelId={selectedModelId}
                status={status}
              />
            )}
            {supportsReasoning && (
              <ReasoningEffortButton
                onChange={onReasoningEffortChange}
                selectedEffort={selectedReasoningEffort}
                status={status}
              />
            )}
            <ModelSelectorCompact
              onModelChange={onModelChange}
              selectedModelId={selectedModelId}
            />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className={cn(
                "h-9 w-9 shrink-0 rounded-xl transition-all duration-200 sm:h-7 sm:w-7",
                input.trim() || status === "streaming"
                  ? "bg-foreground text-background hover:opacity-85 active:scale-95"
                  : "bg-muted text-muted-foreground/25 cursor-not-allowed"
              )}
              data-testid="send-button"
              disabled={
                status !== "streaming" &&
                (!input.trim() || uploadQueue.length > 0)
              }
              onStop={stop}
              status={status}
              variant="secondary"
            >
              <T3SendIcon size={18} />
            </PromptInputSubmit>
          )}
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    if (
      prevProps.selectedReasoningEffort !== nextProps.selectedReasoningEffort
    ) {
      return false;
    }
    if (prevProps.editingMessage !== nextProps.editingMessage) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.messages.length !== nextProps.messages.length) {
      return false;
    }

    return true;
  }
);

function PureAttachmentsButton({
  fileInputRef,
  status,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>["status"];
  selectedModelId: string;
}) {
  return (
    <Button
      className="h-9 w-9 shrink-0 rounded-lg border border-border/40 p-1 text-foreground transition-colors hover:border-border hover:text-foreground sm:h-7 sm:w-7"
      data-testid="attachments-button"
      disabled={status !== "ready"}
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      variant="ghost"
    >
      <T3AttachIcon size={16} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureWebSearchButton({
  enabled,
  onToggle,
  status,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  status: UseChatHelpers<ChatMessage>["status"];
}) {
  return (
    <Button
      className={cn(
        "h-9 w-9 shrink-0 rounded-lg border p-1 transition-colors sm:h-7 sm:w-7",
        enabled
          ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
          : "border-border/40 text-foreground hover:border-border hover:text-foreground"
      )}
      data-testid="web-search-button"
      disabled={status !== "ready"}
      onClick={(event) => {
        event.preventDefault();
        onToggle(!enabled);
      }}
      variant="ghost"
    >
      {enabled ? <T3GlobeIcon size={16} /> : <T3GlobeOffIcon size={16} />}
    </Button>
  );
}

const WebSearchButton = memo(PureWebSearchButton);

const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
};

function PureReasoningEffortButton({
  selectedEffort,
  onChange,
  status,
}: {
  selectedEffort: ReasoningEffort;
  onChange?: (effort: ReasoningEffort) => void;
  status: UseChatHelpers<ChatMessage>["status"];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            "h-9 shrink-0 rounded-lg border px-2 text-[12px] transition-colors sm:h-7",
            selectedEffort === "auto"
              ? "border-border/40 text-foreground hover:border-border hover:text-foreground"
              : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
          )}
          data-testid="reasoning-effort-button"
          disabled={status !== "ready"}
          type="button"
          variant="ghost"
        >
          <BrainIcon className="size-3.5" />
          <span className="hidden max-w-16 truncate sm:inline">
            {reasoningEffortLabels[selectedEffort]}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <GaugeIcon className="size-3.5" />
          <span>Reasoning level</span>
        </div>
        <DropdownMenuRadioGroup
          onValueChange={(value) => onChange?.(value as ReasoningEffort)}
          value={selectedEffort}
        >
          {(["auto", "low", "medium", "high"] as const).map((effort) => (
            <DropdownMenuRadioItem key={effort} value={effort}>
              {reasoningEffortLabels[effort]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ReasoningEffortButton = memo(PureReasoningEffortButton);

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${MODELS_API_PATH}`,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { revalidateOnFocus: false }
  );

  const capabilities: Record<string, ModelCapabilities> | undefined =
    modelsData?.capabilities ?? modelsData;
  const dynamicModels: ChatModel[] | undefined = modelsData?.models;
  const activeModels =
    dynamicModels === undefined
      ? [titleModel]
      : dynamicModels.length > 0
        ? dynamicModels
        : [];
  const hasConfiguredModels = activeModels.length > 0;

  const selectedModel =
    activeModels.find((m: ChatModel) => m.id === selectedModelId) ??
    (dynamicModels === undefined
      ? modelFromId(selectedModelId)
      : (activeModels.find((m: ChatModel) => m.id === DEFAULT_CHAT_MODEL) ??
        activeModels[0] ??
        titleModel));

  useEffect(() => {
    if (
      dynamicModels &&
      dynamicModels.length > 0 &&
      selectedModel.id !== selectedModelId
    ) {
      onModelChange?.(selectedModel.id);
      setCookie("chat-model", selectedModel.id);
    }
  }, [dynamicModels, onModelChange, selectedModel.id, selectedModelId]);

  const [provider] = (selectedModel.id ?? "").split("/");

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          className="h-9 min-w-0 max-w-[min(52vw,220px)] justify-between gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground sm:h-7 sm:max-w-[200px]"
          data-testid="model-selector"
          variant="ghost"
        >
          {hasConfiguredModels && provider ? (
            <ModelSelectorLogo provider={provider} />
          ) : (
            <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
          )}
          <ModelSelectorName>
            {hasConfiguredModels ? selectedModel.name : "No models configured"}
          </ModelSelectorName>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        className="w-[390px] overflow-visible"
        commandProps={{
          className: "overflow-visible p-0",
          shouldFilter: false,
        }}
      >
        {hasConfiguredModels ? (
          <ModelPickerContent
            capabilities={capabilities}
            models={activeModels}
            onSelectModel={(modelId) => {
              onModelChange?.(modelId);
              setCookie("chat-model", modelId);
              setOpen(false);
              if (isMobile) {
                return;
              }
              setTimeout(() => {
                document
                  .querySelector<HTMLTextAreaElement>(
                    "[data-testid='multimodal-input']"
                  )
                  ?.focus();
              }, 50);
            }}
            selectedModelId={selectedModel.id}
          />
        ) : (
          <div className="px-3 py-3 text-[13px]">
            <p className="font-medium text-foreground">No configured models</p>
            <p className="mt-1 text-muted-foreground leading-5">
              Add OPENCODE_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or
              AI_GATEWAY_API_KEY.
            </p>
          </div>
        )}
      </ModelSelectorContent>
    </ModelSelector>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="h-9 w-9 shrink-0 rounded-xl bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed sm:h-7 sm:w-7"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
