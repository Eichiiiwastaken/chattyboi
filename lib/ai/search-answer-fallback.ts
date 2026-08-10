import type { InferUIMessageChunk } from "ai";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

// Search results are usually short. This keeps a provider that ignores its token
// limit from flooding the browser with an unrenderable response.
export const MAX_SEARCH_ANSWER_CHARACTERS = 16_000;
export const MAX_SEARCH_ANSWER_TOKENS = 4096;

function searchResultCount(output: unknown) {
  if (
    output &&
    typeof output === "object" &&
    "results" in output &&
    Array.isArray(output.results)
  ) {
    return output.results.length;
  }

  return 0;
}

export function withSearchAnswerFallback(
  stream: ReadableStream<InferUIMessageChunk<ChatMessage>>,
  context: {
    chatId: string;
    maxAnswerCharacters?: number;
    modelId: string;
  }
) {
  const maxAnswerCharacters =
    context.maxAnswerCharacters ?? MAX_SEARCH_ANSWER_CHARACTERS;
  let sawSearchOutput = false;
  let sawText = false;
  let sawTextAfterSearch = false;
  let searchAnswerLength = 0;
  let answerWasTruncated = false;
  let sawFinish = false;
  let sawError = false;

  return stream.pipeThrough(
    new TransformStream<InferUIMessageChunk<ChatMessage>>({
      transform(chunk, controller) {
        if (
          chunk.type === "tool-output-available" &&
          searchResultCount(chunk.output) > 0
        ) {
          sawSearchOutput = true;
        }

        if (chunk.type === "text-delta" && chunk.delta.trim().length > 0) {
          sawText = true;
        }

        if (chunk.type === "error") {
          sawError = true;
        }

        if (sawSearchOutput && chunk.type === "text-delta") {
          const remaining = maxAnswerCharacters - searchAnswerLength;
          const delta = chunk.delta.slice(0, Math.max(remaining, 0));

          if (delta.trim().length > 0) {
            sawTextAfterSearch = true;
          }

          searchAnswerLength += delta.length;
          answerWasTruncated ||= delta.length < chunk.delta.length;

          if (delta.length > 0) {
            controller.enqueue({ ...chunk, delta });
          }
          return;
        }

        if (chunk.type === "finish") {
          sawFinish = true;

          // The UI renders stream error chunks in the standard generation-error
          // card. Do not add a second, plain-text fallback below it.
          if (sawError) {
            controller.enqueue(chunk);
            return;
          }

          if (sawSearchOutput && !sawTextAfterSearch) {
            console.error("Search turn finished without answer text", context);
            enqueueError(
              controller,
              "I found search results, but the model finished without producing a visible answer. Please retry the message; the search results above did come back successfully."
            );
          } else if (
            sawSearchOutput &&
            (answerWasTruncated || chunk.finishReason === "length")
          ) {
            console.warn("Search answer was truncated", {
              ...context,
              finishReason: chunk.finishReason,
              visibleCharacterCount: searchAnswerLength,
            });
            enqueueNotice(
              controller,
              "_This response reached its length limit and may be incomplete. Please ask a narrower follow-up or retry the question._"
            );
          } else if (!sawText) {
            console.error("Assistant turn finished without answer text", {
              ...context,
              finishReason: chunk.finishReason,
            });
            enqueueError(
              controller,
              getEmptyResponseNotice(chunk.finishReason)
            );
          }
        }

        controller.enqueue(chunk);
      },
      flush(controller) {
        if (sawFinish) {
          return;
        }

        if (sawError) {
          return;
        }

        console.error("Assistant stream ended without a finish event", context);
        enqueueError(
          controller,
          sawText
            ? "The response ended unexpectedly and may be incomplete. Please retry if anything is missing."
            : "The response ended unexpectedly before the model produced an answer. Your message was kept; please retry."
        );
      },
    })
  );
}

function getEmptyResponseNotice(finishReason: string | undefined) {
  if (finishReason === "length") {
    return "The model reached a context or output limit before it produced a visible answer. Your message was kept; please retry, or send the relevant PDFs in smaller batches.";
  }

  if (finishReason === "content-filter") {
    return "The model stopped before producing a visible answer because its content filter was triggered. Try rephrasing the request.";
  }

  return "The model finished without producing a visible answer. Your message was kept; please retry. If this chat is very long, start a new chat or re-attach only the relevant files.";
}

function enqueueNotice(
  controller: TransformStreamDefaultController<
    InferUIMessageChunk<ChatMessage>
  >,
  text: string
) {
  const id = generateUUID();
  controller.enqueue({ type: "text-start", id });
  controller.enqueue({ type: "text-delta", id, delta: text });
  controller.enqueue({ type: "text-end", id });
}

function enqueueError(
  controller: TransformStreamDefaultController<
    InferUIMessageChunk<ChatMessage>
  >,
  errorText: string
) {
  controller.enqueue({ type: "error", errorText });
}
