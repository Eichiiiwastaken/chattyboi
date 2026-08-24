import { GitForkIcon, InfoIcon, RefreshCcwIcon } from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MODELS_API_PATH } from "@/lib/ai/model-api";
import type { ChatModel, ModelCapabilities } from "@/lib/ai/models";
import type { ChatMessage } from "@/lib/types";
import { getTextFromMessage } from "@/lib/utils";
import {
  MessageAction as Action,
  MessageActions as Actions,
} from "../ai-elements/message";
import { CopyIcon, PencilEditIcon } from "./icons";
import { MessageStats } from "./message-stats";
import { ModelPickerContent } from "./model-picker";

export function PureMessageActions({
  chatId: _chatId,
  message,
  isLoading,
  onBranch,
  onEdit,
  onRetry,
  selectedModelId,
  statsForNerds,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  onBranch?: (message: ChatMessage, modelId?: string) => Promise<void> | void;
  onEdit?: () => void;
  onRetry?: (message: ChatMessage, modelId?: string) => Promise<void> | void;
  selectedModelId: string;
  statsForNerds?: boolean;
}) {
  const [_, copyToClipboard] = useCopyToClipboard();

  if (isLoading) {
    return null;
  }

  const textFromParts = getTextFromMessage(message).trim();

  const handleCopy = async () => {
    if (!textFromParts) {
      toast.error("There is no text to copy.");
      return;
    }

    await copyToClipboard(textFromParts);
    toast.success("Copied to clipboard");
  };

  if (message.role === "user") {
    return (
      <Actions className="-mr-0.5 gap-0.5 justify-end opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
        {onRetry && (
          <RetryMenu
            message={message}
            onRetry={onRetry}
            selectedModelId={selectedModelId}
          />
        )}
        {onBranch && (
          <BranchMenu
            message={message}
            onBranch={onBranch}
            selectedModelId={selectedModelId}
          />
        )}
        {onEdit && (
          <Action
            className="size-7 text-muted-foreground/50 hover:text-foreground"
            data-testid="message-edit-button"
            onClick={onEdit}
            tooltip="Edit"
          >
            <PencilEditIcon />
          </Action>
        )}
        <Action
          className="size-7 text-muted-foreground/50 hover:text-foreground"
          onClick={handleCopy}
          tooltip="Copy"
        >
          <CopyIcon />
        </Action>
      </Actions>
    );
  }

  return (
    <Actions className="-ml-0.5 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
      <Action
        className="text-muted-foreground/50 hover:text-foreground"
        onClick={handleCopy}
        tooltip="Copy"
      >
        <CopyIcon />
      </Action>
      {onBranch && (
        <BranchMenu
          message={message}
          onBranch={onBranch}
          selectedModelId={selectedModelId}
        />
      )}
      {onRetry && (
        <RetryMenu
          message={message}
          onRetry={onRetry}
          selectedModelId={selectedModelId}
        />
      )}
      {statsForNerds && <MessageStats message={message} />}
    </Actions>
  );
}

function BranchMenu({
  message,
  onBranch,
  selectedModelId,
}: {
  message: ChatMessage;
  onBranch: (message: ChatMessage, modelId?: string) => Promise<void> | void;
  selectedModelId: string;
}) {
  const [open, setOpen] = useState(false);
  const [isBranching, setIsBranching] = useState(false);
  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${MODELS_API_PATH}`,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { revalidateOnFocus: false }
  );

  const capabilities: Record<string, ModelCapabilities> | undefined =
    modelsData?.capabilities ?? modelsData;
  const allModels: ChatModel[] = modelsData?.models ?? [];

  const branch = (modelId?: string) => {
    setOpen(false);
    setIsBranching(true);
    Promise.resolve(onBranch(message, modelId))
      .catch(() => undefined)
      .finally(() => {
        setIsBranching(false);
      });
  };

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <ModelSelectorTrigger asChild>
              <Button
                aria-label="Branch off"
                className="size-7 text-muted-foreground/50 hover:text-foreground"
                data-testid="message-branch-button"
                disabled={isBranching}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <GitForkIcon className="size-4" />
              </Button>
            </ModelSelectorTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Branch off</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ModelSelectorContent
        className="w-[390px] overflow-visible"
        commandProps={{
          className: "overflow-visible p-0",
          shouldFilter: false,
        }}
      >
        <div className="border-border/50 border-b p-1.5">
          <button
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            onClick={() => branch()}
            type="button"
          >
            <GitForkIcon className="size-4 shrink-0 text-primary" />
            <span className="flex-1">Branch off</span>
            <InfoIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-3 px-2 py-2 text-muted-foreground text-xs">
            <span className="h-px flex-1 bg-border/60" />
            <span>or switch model</span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
        </div>
        <ModelPickerContent
          capabilities={capabilities}
          models={allModels}
          onSelectModel={(modelId) => branch(modelId)}
          selectedModelId={selectedModelId}
        />
      </ModelSelectorContent>
    </ModelSelector>
  );
}

function RetryMenu({
  message,
  onRetry,
  selectedModelId,
}: {
  message: ChatMessage;
  onRetry: (message: ChatMessage, modelId?: string) => Promise<void> | void;
  selectedModelId: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${MODELS_API_PATH}`,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { revalidateOnFocus: false }
  );

  const capabilities: Record<string, ModelCapabilities> | undefined =
    modelsData?.capabilities ?? modelsData;
  const allModels: ChatModel[] = modelsData?.models ?? [];

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <ModelSelectorTrigger asChild>
              <Button
                aria-label="Retry"
                className="size-7 text-muted-foreground/50 hover:text-foreground"
                data-testid="message-retry-button"
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <RefreshCcwIcon className="size-4" />
              </Button>
            </ModelSelectorTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Retry</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ModelSelectorContent
        className="w-[390px] overflow-visible"
        commandProps={{
          className: "overflow-visible p-0",
          shouldFilter: false,
        }}
      >
        <div className="border-border/50 border-b p-1.5">
          <button
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            onClick={() => {
              setOpen(false);
              Promise.resolve(onRetry(message)).catch(() => undefined);
            }}
            type="button"
          >
            <RefreshCcwIcon className="size-4 shrink-0 text-primary" />
            <span className="flex-1">Retry same</span>
            <InfoIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-3 px-2 py-2 text-muted-foreground text-xs">
            <span className="h-px flex-1 bg-border/60" />
            <span>or switch model</span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
        </div>
        <ModelPickerContent
          capabilities={capabilities}
          models={allModels}
          onSelectModel={(modelId) => {
            setOpen(false);
            Promise.resolve(onRetry(message, modelId)).catch(() => undefined);
          }}
          selectedModelId={selectedModelId}
        />
      </ModelSelectorContent>
    </ModelSelector>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.statsForNerds !== nextProps.statsForNerds) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    if (prevProps.onRetry !== nextProps.onRetry) {
      return false;
    }
    if (prevProps.onBranch !== nextProps.onBranch) {
      return false;
    }
    return true;
  }
);
