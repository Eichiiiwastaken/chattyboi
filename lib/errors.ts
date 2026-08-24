export type ErrorType =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "offline";

export type Surface =
  | "chat"
  | "auth"
  | "api"
  | "stream"
  | "database"
  | "history"
  | "vote"
  | "document"
  | "suggestions"
  | "activate_gateway"
  | "settings";

export type ErrorCode = `${ErrorType}:${Surface}`;

export type ErrorVisibility = "response" | "log" | "none";

export type NormalizedError = {
  detail?: string;
  message: string;
};

export const visibilityBySurface: Record<Surface, ErrorVisibility> = {
  database: "log",
  chat: "response",
  auth: "response",
  stream: "response",
  api: "response",
  history: "response",
  vote: "response",
  document: "response",
  suggestions: "response",
  activate_gateway: "response",
  settings: "response",
};

export class ChatbotError extends Error {
  type: ErrorType;
  surface: Surface;
  statusCode: number;

  constructor(errorCode: ErrorCode, cause?: string) {
    super();

    const [type, surface] = errorCode.split(":");

    this.type = type as ErrorType;
    this.cause = cause;
    this.surface = surface as Surface;
    this.message = getMessageByErrorCode(errorCode);
    this.statusCode = getStatusCodeByType(this.type);
  }

  toResponse() {
    const code: ErrorCode = `${this.type}:${this.surface}`;
    const visibility = visibilityBySurface[this.surface];

    const { message, cause, statusCode } = this;

    if (visibility === "log") {
      console.error({
        code,
        message,
        cause,
      });

      return Response.json(
        { code: "", message: "We couldn't complete that request. Try again." },
        { status: statusCode }
      );
    }

    return Response.json({ code, message, cause }, { status: statusCode });
  }
}

const MAX_ERROR_DETAIL_LENGTH = 800;

function redactSensitiveErrorText(text: string) {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-...[redacted]")
    .replace(
      /\b(api[_-]?key|token|authorization|bearer)\b(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2[redacted]"
    );
}

function truncateErrorDetail(text: string) {
  return text.length > MAX_ERROR_DETAIL_LENGTH
    ? `${text.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}...`
    : text;
}

function normalizeErrorText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (value == null) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function getErrorMessageFromUnknown(
  error: unknown,
  fallback = "We couldn't complete that request. Try again."
): NormalizedError {
  if (error instanceof ChatbotError) {
    return {
      detail:
        error.cause === undefined
          ? undefined
          : truncateErrorDetail(
              redactSensitiveErrorText(String(error.cause).trim())
            ),
      message: error.message || fallback,
    };
  }

  if (error instanceof Error) {
    return {
      message: truncateErrorDetail(
        redactSensitiveErrorText(error.message || fallback)
      ),
    };
  }

  const message = normalizeErrorText(error);

  return {
    message: message
      ? truncateErrorDetail(redactSensitiveErrorText(message))
      : fallback,
  };
}

export function getMessageByErrorCode(errorCode: ErrorCode): string {
  if (errorCode.includes("database")) {
    return "The database query failed.";
  }

  switch (errorCode) {
    case "bad_request:api":
      return "We couldn't process the request. Check your input and try again.";

    case "bad_request:activate_gateway":
      return "Vercel AI Gateway needs a payment card before it can handle requests. Add one at https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card.";

    case "unauthorized:auth":
      return "You need to sign in before continuing.";
    case "forbidden:auth":
      return "Your account does not have access to this feature.";

    case "rate_limit:chat":
      return "You've reached the message limit. Try again in one hour.";
    case "bad_request:chat":
      return "The selected model provider is not configured. Please update your deployment environment and try again.";
    case "not_found:chat":
      return "The requested chat was not found. Please check the chat ID and try again.";
    case "forbidden:chat":
      return "This chat belongs to another user. Please check the chat ID and try again.";
    case "unauthorized:chat":
      return "You need to sign in to view this chat. Please sign in and try again.";
    case "offline:chat":
      return "We couldn't send your message. Check your internet connection and try again.";

    case "not_found:document":
      return "The requested document was not found. Please check the document ID and try again.";
    case "forbidden:document":
      return "This document belongs to another user. Please check the document ID and try again.";
    case "unauthorized:document":
      return "You need to sign in to view this document. Please sign in and try again.";
    case "bad_request:document":
      return "The request to create or update the document was invalid. Please check your input and try again.";

    case "unauthorized:settings":
      return "You need to sign in to view or update settings.";
    case "offline:settings":
      return "We couldn't load your settings. Check your connection and try again.";

    default:
      return "We couldn't complete that request. Try again.";
  }
}

function getStatusCodeByType(type: ErrorType) {
  switch (type) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limit":
      return 429;
    case "offline":
      return 503;
    default:
      return 500;
  }
}
