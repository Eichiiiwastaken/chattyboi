"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import { AlertTriangleIcon, QuoteIcon, RefreshCcwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GenerationError } from "@/hooks/use-active-chat";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { ToolApprovalButtons } from "./tool-approval-buttons";
import { Weather } from "./weather";

type QuoteSelectionState = {
  left: number;
  text: string;
  top: number;
};

type SelectionEndpoint = "start" | "end";

type SelectionDragEndpoint = {
  endpoint: SelectionEndpoint;
  timestamp: number;
};

type SelectionPointerStart = {
  left: number;
  top: number;
};

type TextPosition = {
  offset: number;
  textNode: Text;
};

const QUOTE_ACTION_GAP = 8;
const QUOTE_ACTION_HEIGHT = 28;
const QUOTE_ACTION_WIDTH = 38;

function getValueSizeHint(value: unknown): number {
  if (typeof value === "string") {
    return value.length;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length;
  }

  return value == null ? 0 : 1;
}

function isRuntimeErrorPart(
  part: unknown
): part is { errorText: string; type: "error" } {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "error" &&
    "errorText" in part &&
    typeof part.errorText === "string"
  );
}

export function getMessageRenderSignature(message: ChatMessage) {
  return message.parts
    .map((part) => {
      const runtimePart: unknown = part;

      if (isRuntimeErrorPart(runtimePart)) {
        return `error:${runtimePart.errorText.length}:${runtimePart.errorText.slice(0, 32)}:${runtimePart.errorText.slice(-32)}`;
      }

      if (part.type === "text") {
        return `text:${part.text.length}:${part.text.slice(0, 32)}:${part.text.slice(-32)}`;
      }

      if (part.type === "reasoning" && "text" in part) {
        return `reasoning:${part.text.length}:${part.text.slice(0, 32)}:${part.text.slice(-32)}`;
      }

      const state = "state" in part ? String(part.state) : "";
      const toolCallId = "toolCallId" in part ? String(part.toolCallId) : "";
      const inputLength = "input" in part ? getValueSizeHint(part.input) : 0;
      const outputLength = "output" in part ? getValueSizeHint(part.output) : 0;

      return `${part.type}:${state}:${toolCallId}:${inputLength}:${outputLength}`;
    })
    .join("|");
}

function isUsableRect(rect: DOMRect) {
  return rect.width > 0 || rect.height > 0;
}

function getVisualEndRect(rects: DOMRect[]) {
  const usableRects = rects.filter(isUsableRect);

  return usableRects.reduce<DOMRect | null>((endRect, rect) => {
    if (!endRect) {
      return rect;
    }

    const isLowerLine = rect.top > endRect.top + 4;
    const isSameLineFurtherRight =
      Math.abs(rect.top - endRect.top) <= 4 && rect.right > endRect.right;

    return isLowerLine || isSameLineFurtherRight ? rect : endRect;
  }, null);
}

function getVisualStartRect(rects: DOMRect[]) {
  const usableRects = rects.filter(isUsableRect);

  return usableRects.reduce<DOMRect | null>((startRect, rect) => {
    if (!startRect) {
      return rect;
    }

    const isHigherLine = rect.top < startRect.top - 4;
    const isSameLineFurtherLeft =
      Math.abs(rect.top - startRect.top) <= 4 && rect.left < startRect.left;

    return isHigherLine || isSameLineFurtherLeft ? rect : startRect;
  }, null);
}

function isSelectionBackward(selection: Selection) {
  if (!selection.anchorNode || !selection.focusNode) {
    return false;
  }

  if (selection.anchorNode === selection.focusNode) {
    return selection.focusOffset < selection.anchorOffset;
  }

  const directionRange = document.createRange();
  directionRange.setStart(selection.anchorNode, selection.anchorOffset);
  directionRange.setEnd(selection.focusNode, selection.focusOffset);
  const isBackward = directionRange.collapsed;
  directionRange.detach();

  return isBackward;
}

function getTextNodeAtEdge(node: Node, edge: "first" | "last"): Text | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    return textNode.data.trim() ? textNode : null;
  }

  const childNodes = Array.from(node.childNodes);
  const orderedNodes = edge === "first" ? childNodes : childNodes.reverse();

  for (const childNode of orderedNodes) {
    const textNode = getTextNodeAtEdge(childNode, edge);

    if (textNode) {
      return textNode;
    }
  }

  return null;
}

function getAdjacentTextNode(
  node: Node,
  root: HTMLElement,
  direction: "next" | "previous"
) {
  let currentNode: Node | null = node;

  while (currentNode && currentNode !== root) {
    let sibling =
      direction === "previous"
        ? currentNode.previousSibling
        : currentNode.nextSibling;

    while (sibling) {
      const textNode = getTextNodeAtEdge(
        sibling,
        direction === "previous" ? "last" : "first"
      );

      if (textNode) {
        return textNode;
      }

      sibling =
        direction === "previous"
          ? sibling.previousSibling
          : sibling.nextSibling;
    }

    currentNode = currentNode.parentNode;
  }

  return null;
}

function findTextPosition(
  textNode: Text,
  endpoint: SelectionEndpoint,
  offset: number
): TextPosition | null {
  if (endpoint === "end") {
    for (
      let index = Math.min(offset - 1, textNode.length - 1);
      index >= 0;
      index -= 1
    ) {
      if (textNode.data[index]?.trim()) {
        return { offset: index, textNode };
      }
    }

    return null;
  }

  for (let index = Math.max(offset, 0); index < textNode.length; index += 1) {
    if (textNode.data[index]?.trim()) {
      return { offset: index, textNode };
    }
  }

  return null;
}

function getElementFocusTextPosition(
  focusNode: Node,
  focusOffset: number,
  endpoint: SelectionEndpoint
) {
  const childNodes = Array.from(focusNode.childNodes);

  if (endpoint === "end") {
    for (
      let index = Math.min(focusOffset, childNodes.length) - 1;
      index >= 0;
      index -= 1
    ) {
      const textNode = getTextNodeAtEdge(childNodes[index], "last");
      const position =
        textNode && findTextPosition(textNode, endpoint, textNode.length);

      if (position) {
        return position;
      }
    }

    return null;
  }

  for (
    let index = Math.max(focusOffset, 0);
    index < childNodes.length;
    index += 1
  ) {
    const textNode = getTextNodeAtEdge(childNodes[index], "first");
    const position = textNode && findTextPosition(textNode, endpoint, 0);

    if (position) {
      return position;
    }
  }

  return null;
}

function getSelectionFocusTextPosition(
  selection: Selection,
  root: HTMLElement,
  endpoint: SelectionEndpoint
): TextPosition | null {
  const focusNode = selection.focusNode;

  if (!(focusNode && root.contains(focusNode))) {
    return null;
  }

  if (focusNode.nodeType === Node.TEXT_NODE) {
    const textNode = focusNode as Text;
    const position = findTextPosition(
      textNode,
      endpoint,
      selection.focusOffset
    );

    if (position) {
      return position;
    }

    const adjacentTextNode = getAdjacentTextNode(
      textNode,
      root,
      endpoint === "end" ? "previous" : "next"
    );

    return adjacentTextNode
      ? findTextPosition(
          adjacentTextNode,
          endpoint,
          endpoint === "end" ? adjacentTextNode.length : 0
        )
      : null;
  }

  const position = getElementFocusTextPosition(
    focusNode,
    selection.focusOffset,
    endpoint
  );

  if (position) {
    return position;
  }

  const adjacentTextNode = getAdjacentTextNode(
    focusNode,
    root,
    endpoint === "end" ? "previous" : "next"
  );

  return adjacentTextNode
    ? findTextPosition(
        adjacentTextNode,
        endpoint,
        endpoint === "end" ? adjacentTextNode.length : 0
      )
    : null;
}

function getTextPositionRect(
  position: TextPosition,
  endpoint: SelectionEndpoint
) {
  const characterRange = document.createRange();
  characterRange.setStart(position.textNode, position.offset);
  characterRange.setEnd(position.textNode, position.offset + 1);
  const characterRect =
    endpoint === "start"
      ? getVisualStartRect(Array.from(characterRange.getClientRects()))
      : getVisualEndRect(Array.from(characterRange.getClientRects()));
  characterRange.detach();

  return characterRect;
}

function getSelectionFocusTextRect(
  selection: Selection,
  root: HTMLElement,
  endpoint: SelectionEndpoint
) {
  const position = getSelectionFocusTextPosition(selection, root, endpoint);

  return position ? getTextPositionRect(position, endpoint) : null;
}

function getSelectedTextEndpointRect(
  range: Range,
  root: HTMLElement,
  endpoint: SelectionEndpoint
) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let rect: DOMRect | null = null;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;

    if (!(textNode.data.trim() && range.intersectsNode(textNode))) {
      continue;
    }

    const start = textNode === range.startContainer ? range.startOffset : 0;
    const end =
      textNode === range.endContainer ? range.endOffset : textNode.length;

    if (endpoint === "start") {
      for (let offset = start; offset < end; offset += 1) {
        if (!textNode.data[offset]?.trim()) {
          continue;
        }

        const characterRange = document.createRange();
        characterRange.setStart(textNode, offset);
        characterRange.setEnd(textNode, offset + 1);
        const characterRect = getVisualStartRect(
          Array.from(characterRange.getClientRects())
        );
        characterRange.detach();

        if (characterRect) {
          return characterRect;
        }
      }

      continue;
    }

    for (let offset = end - 1; offset >= start; offset -= 1) {
      if (!textNode.data[offset]?.trim()) {
        continue;
      }

      const characterRange = document.createRange();
      characterRange.setStart(textNode, offset);
      characterRange.setEnd(textNode, offset + 1);
      const characterRect = getVisualEndRect(
        Array.from(characterRange.getClientRects())
      );
      characterRange.detach();

      if (characterRect) {
        rect = characterRect;
      }

      break;
    }
  }

  return rect;
}

function getSelectionPosition(rect: DOMRect, endpoint: SelectionEndpoint) {
  const horizontalAnchor =
    endpoint === "start"
      ? rect.left + QUOTE_ACTION_WIDTH / 2
      : rect.right - QUOTE_ACTION_WIDTH / 2;
  const verticalAnchor =
    endpoint === "start"
      ? rect.top - QUOTE_ACTION_GAP - QUOTE_ACTION_HEIGHT / 2
      : rect.bottom + QUOTE_ACTION_GAP + QUOTE_ACTION_HEIGHT / 2;

  return {
    left: Math.min(
      Math.max(horizontalAnchor, QUOTE_ACTION_WIDTH / 2 + 8),
      window.innerWidth - QUOTE_ACTION_WIDTH / 2 - 8
    ),
    top: Math.min(
      Math.max(verticalAnchor, QUOTE_ACTION_HEIGHT / 2 + 8),
      window.innerHeight - QUOTE_ACTION_HEIGHT / 2 - 8
    ),
  };
}

function QuoteSelectionPopover({
  children,
  className,
  onQuote,
}: {
  children: ReactNode;
  className?: string;
  onQuote?: (text: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selectionDragEndpointRef = useRef<SelectionDragEndpoint | null>(null);
  const selectionPointerStartRef = useRef<SelectionPointerStart | null>(null);
  const isPointerSelectingRef = useRef(false);
  const [portalElement, setPortalElement] = useState<HTMLElement | null>(null);
  const [selection, setSelection] = useState<QuoteSelectionState | null>(null);

  const hideSelection = useCallback(() => {
    selectionDragEndpointRef.current = null;
    selectionPointerStartRef.current = null;
    isPointerSelectingRef.current = false;
    setSelection(null);
  }, []);

  const updateSelection = useCallback(() => {
    if (!onQuote) {
      return;
    }

    if (isPointerSelectingRef.current) {
      return;
    }

    const activeSelection = window.getSelection();
    const root = rootRef.current;

    if (!(activeSelection && root && activeSelection.rangeCount > 0)) {
      hideSelection();
      return;
    }

    const range = activeSelection.getRangeAt(0);
    const ancestor =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentNode;

    if (!(ancestor && root.contains(ancestor))) {
      hideSelection();
      return;
    }

    const selectedText = activeSelection.toString().trim();

    if (!selectedText) {
      hideSelection();
      return;
    }

    const rangeRects = Array.from(range.getClientRects());
    const recentDragEndpoint = selectionDragEndpointRef.current;
    const endpoint =
      recentDragEndpoint && Date.now() - recentDragEndpoint.timestamp < 750
        ? recentDragEndpoint.endpoint
        : isSelectionBackward(activeSelection)
          ? "start"
          : "end";
    const focusTextRect = getSelectionFocusTextRect(
      activeSelection,
      root,
      endpoint
    );
    const endpointRect =
      focusTextRect ?? getSelectedTextEndpointRect(range, root, endpoint);
    const fallbackRect =
      (endpoint === "start"
        ? getVisualStartRect(rangeRects)
        : getVisualEndRect(rangeRects)) ?? range.getBoundingClientRect();
    const rect =
      endpointRect && isUsableRect(endpointRect) ? endpointRect : fallbackRect;

    if (!rect || !isUsableRect(rect)) {
      hideSelection();
      return;
    }

    setSelection({
      ...getSelectionPosition(rect, endpoint),
      text: selectedText,
    });
  }, [hideSelection, onQuote]);

  useEffect(() => {
    if (!onQuote) {
      return;
    }

    setPortalElement(document.body);

    document.addEventListener("selectionchange", updateSelection);

    return () => {
      document.removeEventListener("selectionchange", updateSelection);
    };
  }, [onQuote, updateSelection]);

  useEffect(() => {
    if (!onQuote) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      const root = rootRef.current;
      selectionPointerStartRef.current =
        root && event.target instanceof Node && root.contains(event.target)
          ? {
              left: event.clientX,
              top: event.clientY,
            }
          : null;
      isPointerSelectingRef.current = Boolean(selectionPointerStartRef.current);
      selectionDragEndpointRef.current = null;

      if (selectionPointerStartRef.current) {
        setSelection(null);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const pointerStart = selectionPointerStartRef.current;

      if (!pointerStart) {
        return;
      }

      const horizontalDelta = event.clientX - pointerStart.left;
      const verticalDelta = event.clientY - pointerStart.top;
      const endpoint =
        Math.abs(verticalDelta) > 4
          ? verticalDelta < 0
            ? "start"
            : "end"
          : horizontalDelta < 0
            ? "start"
            : "end";

      selectionPointerStartRef.current = null;
      isPointerSelectingRef.current = false;
      selectionDragEndpointRef.current = {
        endpoint,
        timestamp: Date.now(),
      };
      requestAnimationFrame(updateSelection);
    };

    const handlePointerCancel = () => {
      selectionPointerStartRef.current = null;
      isPointerSelectingRef.current = false;
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [onQuote, updateSelection]);

  useEffect(() => {
    if (!selection) {
      return;
    }

    window.addEventListener("resize", hideSelection);
    window.addEventListener("scroll", hideSelection, true);

    return () => {
      window.removeEventListener("resize", hideSelection);
      window.removeEventListener("scroll", hideSelection, true);
    };
  }, [hideSelection, selection]);

  const quoteSelection = useCallback(() => {
    if (!selection) {
      return;
    }

    onQuote?.(selection.text);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [onQuote, selection]);

  if (!onQuote) {
    return children;
  }

  const selectionAction =
    selection && portalElement
      ? createPortal(
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Quote selection"
                  className="fixed z-50 flex h-7 w-[38px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-popover text-popover-foreground shadow-[var(--shadow-float)] backdrop-blur transition-transform duration-150 hover:scale-105 hover:bg-muted"
                  onClick={quoteSelection}
                  onMouseDown={(event) => event.preventDefault()}
                  style={{ left: selection.left, top: selection.top }}
                  type="button"
                >
                  <QuoteIcon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>
                <p>Quote selection</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>,
          portalElement
        )
      : null;

  return (
    <div className={className} ref={rootRef}>
      {children}
      {selectionAction}
    </div>
  );
}

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  selectedModelId,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
  onBranchMessage,
  onQuoteSelection,
  onRetryMessage,
  generationError,
  searchSources,
  statsForNerds,
  messageSignature: _messageSignature,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  messageSignature?: string;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  selectedModelId?: string;
  requiresScrollPadding: boolean;
  onEdit?: (message: ChatMessage) => void;
  onBranchMessage?: (
    message: ChatMessage,
    modelId?: string
  ) => Promise<void> | void;
  onQuoteSelection?: (text: string) => void;
  onRetryMessage?: (message: ChatMessage, modelId?: string) => void;
  generationError?: GenerationError | null;
  searchSources?: Array<{ title: string; url: string }> | null;
  statsForNerds?: boolean;
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div
      className="flex flex-row justify-end gap-2"
      data-testid={"message-attachments"}
    >
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            name: attachment.filename ?? "file",
            contentType: attachment.mediaType,
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
        };
      }
      return acc;
    },
    { text: "", isStreaming: false, rendered: false }
  ) ?? { text: "", isStreaming: false, rendered: false };

  const parts = message.parts?.map((part, index) => {
    const runtimePart: unknown = part;
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;

    if (isRuntimeErrorPart(runtimePart)) {
      return (
        <AssistantErrorBlock
          key={key}
          message={runtimePart.errorText || "The assistant response failed."}
        />
      );
    }

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return (
          <MessageReasoning
            isLoading={isLoading || mergedReasoning.isStreaming}
            key={key}
            reasoning={mergedReasoning.text}
          />
        );
      }
      return null;
    }

    if (type === "text") {
      return (
        <MessageContent
          className={cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(88%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)] sm:max-w-[min(80%,56ch)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse isStreaming={isLoading}>
            {sanitizeText(part.text)}
          </MessageResponse>
        </MessageContent>
      );
    }

    if (type === "tool-getWeather") {
      const { toolCallId, state } = part;
      const approvalId = (part as { approval?: { id: string } }).approval?.id;
      const isDenied =
        state === "output-denied" ||
        (state === "approval-responded" &&
          (part as { approval?: { approved?: boolean } }).approval?.approved ===
            false);
      const widthClass = "w-[min(100%,450px)]";

      if (state === "output-available") {
        if (
          part.output &&
          typeof part.output === "object" &&
          "error" in part.output
        ) {
          return (
            <div className={widthClass} key={toolCallId}>
              <Tool className="w-full" defaultOpen={true}>
                <ToolHeader state={state} type="tool-getWeather" />
                <ToolContent>
                  <div className="px-4 py-3 text-muted-foreground text-sm">
                    {part.output.error}
                  </div>
                </ToolContent>
              </Tool>
            </div>
          );
        }
        return (
          <div className={widthClass} key={toolCallId}>
            <Weather weatherAtLocation={part.output} />
          </div>
        );
      }

      if (isDenied) {
        return (
          <div className={widthClass} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state="output-denied" type="tool-getWeather" />
              <ToolContent>
                <div className="px-4 py-3 text-muted-foreground text-sm">
                  Weather lookup was denied.
                </div>
              </ToolContent>
            </Tool>
          </div>
        );
      }

      if (state === "approval-responded") {
        return (
          <div className={widthClass} key={toolCallId}>
            <Tool className="w-full" defaultOpen={true}>
              <ToolHeader state={state} type="tool-getWeather" />
              <ToolContent>
                <ToolInput input={part.input} />
              </ToolContent>
            </Tool>
          </div>
        );
      }

      return (
        <div className={widthClass} key={toolCallId}>
          <Tool className="w-full" defaultOpen={true}>
            <ToolHeader state={state} type="tool-getWeather" />
            <ToolContent>
              {(state === "input-available" ||
                state === "approval-requested") && (
                <ToolInput input={part.input} />
              )}
              {state === "approval-requested" && approvalId && (
                <ToolApprovalButtons
                  disabled={isLoading}
                  onApprove={() => {
                    addToolApprovalResponse({
                      id: approvalId,
                      approved: true,
                    });
                  }}
                  onDeny={() => {
                    addToolApprovalResponse({
                      id: approvalId,
                      approved: false,
                      reason: "User denied weather lookup",
                    });
                  }}
                />
              )}
            </ToolContent>
          </Tool>
        </div>
      );
    }

    if (type === "tool-webSearch") {
      const { toolCallId, state } = part;
      const output = "output" in part ? part.output : null;
      const results =
        output &&
        typeof output === "object" &&
        "results" in output &&
        Array.isArray(output.results)
          ? output.results
          : [];

      return (
        <Tool
          className="w-[min(100%,520px)]"
          defaultOpen={true}
          key={toolCallId}
        >
          <ToolHeader state={state} type="tool-webSearch" />
          <ToolContent>
            {"input" in part && <ToolInput input={part.input} />}
            {state === "output-available" && results.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {results.map((result: { title?: string; url?: string }) => (
                  <a
                    className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    href={result.url}
                    key={result.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {result.title || result.url}
                  </a>
                ))}
              </div>
            )}
            {state === "output-available" && results.length === 0 && (
              <ToolOutput
                errorText={undefined}
                output={
                  output && typeof output === "object" && "error" in output
                    ? output.error
                    : "No search results found."
                }
              />
            )}
          </ToolContent>
        </Tool>
      );
    }

    if (type === "tool-createDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={toolCallId}
          >
            Error creating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <DocumentPreview
          isReadonly={isReadonly}
          key={toolCallId}
          result={part.output}
        />
      );
    }

    if (type === "tool-updateDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={toolCallId}
          >
            Error updating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <div className="relative" key={toolCallId}>
          <DocumentPreview
            args={{ ...part.output, isUpdate: true }}
            isReadonly={isReadonly}
            result={part.output}
          />
        </div>
      );
    }

    if (type === "tool-requestSuggestions") {
      const { toolCallId, state } = part;

      return (
        <Tool
          className="w-[min(100%,450px)]"
          defaultOpen={true}
          key={toolCallId}
        >
          <ToolHeader state={state} type="tool-requestSuggestions" />
          <ToolContent>
            {state === "input-available" && <ToolInput input={part.input} />}
            {state === "output-available" && (
              <ToolOutput
                errorText={undefined}
                output={
                  "error" in part.output ? (
                    <div className="rounded border p-2 text-red-500">
                      Error: {String(part.output.error)}
                    </div>
                  ) : (
                    <DocumentToolResult
                      isReadonly={isReadonly}
                      result={part.output}
                      type="request-suggestions"
                    />
                  )
                }
              />
            )}
          </ToolContent>
        </Tool>
      );
    }

    return null;
  });

  const actions = !isReadonly && (
    <MessageActions
      chatId={chatId}
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onBranch={onBranchMessage}
      onEdit={onEdit ? () => onEdit(message) : undefined}
      onRetry={onRetryMessage}
      selectedModelId={selectedModelId ?? ""}
      statsForNerds={statsForNerds}
    />
  );

  const content = isThinking ? (
    <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
      <Shimmer className="font-medium" duration={1}>
        Thinking...
      </Shimmer>
    </div>
  ) : (
    <>
      {attachments}
      {parts}
      {generationError && (
        <AssistantErrorBlock
          detail={generationError.detail}
          message={generationError.message}
          onRetry={onRetryMessage ? () => onRetryMessage(message) : undefined}
        />
      )}
      {actions}
      {isAssistant && searchSources && searchSources.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground/70">
            Sources
          </p>
          <div className="flex flex-wrap gap-1.5">
            {searchSources.map((source) => (
              <a
                className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                href={source.url}
                key={source.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {source.title}
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        // content-visibility breaks the selection rects used by the quote popover.
        !onQuoteSelection &&
          "[contain-intrinsic-size:auto_160px] [content-visibility:auto]",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3"
        )}
      >
        {isAssistant && (
          <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <SparklesIcon size={13} />
            </div>
          </div>
        )}
        <QuoteSelectionPopover
          className={
            isAssistant ? "flex min-w-0 flex-1 flex-col gap-2" : "contents"
          }
          onQuote={onQuoteSelection}
        >
          {content}
        </QuoteSelectionPopover>
      </div>
    </div>
  );
};

export function AssistantErrorBlock({
  detail,
  message,
  onRetry,
}: {
  detail?: string;
  message: string;
  onRetry?: () => void;
}) {
  const [firstLine, ...restLines] = message.split(/\r?\n/);
  const detailText = detail ?? restLines.join("\n").trim();
  const primaryMessage = detail ? message : firstLine;

  return (
    <div
      className="max-w-[min(100%,720px)] rounded-xl border border-rose-300/70 bg-rose-50 px-4 py-3 text-rose-950 shadow-[var(--shadow-card)] dark:border-rose-900/80 dark:bg-rose-950/35 dark:text-rose-100"
      data-testid="generation-error-message"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-300" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[13px] leading-5">Generation failed</p>
          <p className="mt-1 break-words text-[13px] leading-5 text-rose-900/85 dark:text-rose-100/85">
            {primaryMessage}
          </p>
          {detailText && (
            <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-rose-900/70 dark:text-rose-100/70">
              {detailText}
            </p>
          )}
        </div>
        {onRetry && (
          <Button
            className="h-8 shrink-0 border-rose-300 text-rose-950 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-900/50"
            onClick={onRetry}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCcwIcon className="size-3.5" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.message === nextProps.message &&
    prevProps.messageSignature === nextProps.messageSignature &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.selectedModelId === nextProps.selectedModelId &&
    prevProps.requiresScrollPadding === nextProps.requiresScrollPadding &&
    prevProps.generationError === nextProps.generationError &&
    prevProps.searchSources === nextProps.searchSources &&
    prevProps.statsForNerds === nextProps.statsForNerds &&
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onQuoteSelection === nextProps.onQuoteSelection &&
    prevProps.onRetryMessage === nextProps.onRetryMessage &&
    prevProps.addToolApprovalResponse === nextProps.addToolApprovalResponse
);

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message w-full"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
          <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
            <SparklesIcon size={13} />
          </div>
        </div>

        <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
          <Shimmer className="font-medium" duration={1}>
            Thinking...
          </Shimmer>
        </div>
      </div>
    </div>
  );
};
