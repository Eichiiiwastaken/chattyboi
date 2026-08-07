import { z } from "zod";
import { MAX_CONTEXT_FILES, MAX_CONTEXT_MESSAGES } from "@/lib/ai/chat-context";
import { REASONING_EFFORTS } from "@/lib/ai/reasoning";

export const MAX_CHAT_TEXT_LENGTH = 100_000;

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().max(MAX_CHAT_TEXT_LENGTH),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  filename: z.string().min(1).max(100),
  url: z.string().min(1),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(["user"]),
    parts: z
      .array(partSchema)
      .min(1)
      .max(MAX_CONTEXT_FILES + 4),
  })
  .superRefine((message, context) => {
    const textLength = message.parts.reduce(
      (total, part) => total + (part.type === "text" ? part.text.length : 0),
      0
    );
    const fileCount = message.parts.filter(
      (part) => part.type === "file"
    ).length;

    if (textLength > MAX_CHAT_TEXT_LENGTH) {
      context.addIssue({
        code: "custom",
        message: `Message text must be at most ${MAX_CHAT_TEXT_LENGTH} characters.`,
      });
    }

    if (fileCount > MAX_CONTEXT_FILES) {
      context.addIssue({
        code: "custom",
        message: `Please attach at most ${MAX_CONTEXT_FILES} files.`,
      });
    }

    if (
      fileCount === 0 &&
      !message.parts.some(
        (part) => part.type === "text" && part.text.trim().length > 0
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "A message must contain text or an attachment.",
      });
    }
  });

const toolApprovalMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.record(z.unknown())).max(100),
});

export const postRequestBodySchema = z
  .object({
    id: z.string().uuid(),
    message: userMessageSchema.optional(),
    messages: z
      .array(toolApprovalMessageSchema)
      .max(MAX_CONTEXT_MESSAGES)
      .optional(),
    trigger: z
      .enum(["submit-message", "regenerate-message", "resume-stream"])
      .optional(),
    messageId: z.string().optional(),
    selectedChatModel: z.string(),
    selectedReasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    selectedVisibilityType: z.enum(["public", "private"]),
    webSearchEnabled: z.boolean().optional(),
    isOneTimeChat: z.boolean().optional(),
    clientContextWasTruncated: z.boolean().optional(),
  })
  .superRefine((body, context) => {
    if (body.message && body.messages) {
      context.addIssue({
        code: "custom",
        message: "Send either message or messages, not both.",
        path: ["messages"],
      });
    }

    if (body.trigger === "resume-stream") {
      context.addIssue({
        code: "custom",
        message: "Streams must be resumed through the stream endpoint.",
        path: ["trigger"],
      });
      return;
    }

    const hasApprovalDelta =
      body.messages?.some((currentMessage) =>
        currentMessage.parts.some(
          (part) =>
            part.state === "approval-responded" ||
            part.state === "output-denied"
        )
      ) ?? false;

    if (
      body.isOneTimeChat &&
      !body.message &&
      (body.messages?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "One-time chat requires at least one message.",
        path: ["messages"],
      });
    }

    if (
      !body.isOneTimeChat &&
      body.trigger !== "regenerate-message" &&
      !body.message &&
      !hasApprovalDelta
    ) {
      context.addIssue({
        code: "custom",
        message: "Chat submission requires a user message or tool approval.",
        path: ["message"],
      });
    }
  });

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
