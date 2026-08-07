import type { DBMessage } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages } from "@/lib/utils";

export interface ApprovalDelta {
  messageId: string;
  toolType: string;
  toolCallId: string;
  approvalId: string;
  state: "approval-responded" | "output-denied";
  approved: boolean;
  reason?: string;
}

/**
 * Parse the compact client payload without trusting any of its tool data.
 * Approval submissions always target one assistant message and contain only
 * decision parts; anything else is rejected as an invalid delta.
 */
export function extractApprovalDeltas(
  messages: Array<{
    id: string;
    role?: string;
    parts?: Record<string, unknown>[];
  }>
): ApprovalDelta[] | null {
  if (messages.length !== 1) {
    return null;
  }

  const deltas: ApprovalDelta[] = [];
  const seen = new Set<string>();
  const [message] = messages;

  if (message?.role !== "assistant" || !message.id || !message.parts?.length) {
    return null;
  }

  for (const part of message.parts) {
    if (
      (part.state !== "approval-responded" && part.state !== "output-denied") ||
      typeof part.type !== "string" ||
      !part.type.startsWith("tool-") ||
      typeof part.toolCallId !== "string" ||
      !part.toolCallId ||
      typeof part.approval !== "object" ||
      part.approval === null ||
      Array.isArray(part.approval)
    ) {
      return null;
    }

    const approval = part.approval as Record<string, unknown>;
    if (
      typeof approval.id !== "string" ||
      !approval.id ||
      typeof approval.approved !== "boolean" ||
      (approval.reason !== undefined &&
        (typeof approval.reason !== "string" ||
          approval.reason.length > 1000)) ||
      (part.state === "output-denied" && approval.approved)
    ) {
      return null;
    }

    const key = `${part.toolCallId}\0${approval.id}`;
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);

    deltas.push({
      messageId: message.id,
      toolType: part.type,
      toolCallId: part.toolCallId,
      approvalId: approval.id,
      state: part.state,
      approved: approval.approved,
      ...(typeof approval.reason === "string"
        ? { reason: approval.reason }
        : {}),
    });
  }

  return deltas;
}

/**
 * Apply a complete approval batch to a private copy of persisted parts. A
 * mismatch makes the whole batch fail, so the transaction never partially
 * commits a multi-tool decision.
 *
 * This is the pure validation / transition logic; callers must wrap it in a
 * database transaction or row lock to serialise concurrent claimants.
 */
export function tryApplyApprovalDeltas({
  parts,
  deltas,
}: {
  parts: Record<string, unknown>[];
  deltas: ApprovalDelta[];
}): Record<string, unknown>[] | null {
  if (deltas.length === 0) {
    return null;
  }

  const updated = parts.map((part) => ({ ...part }));

  for (const delta of deltas) {
    const matchingIndexes = updated.flatMap((part, index) => {
      const approval =
        typeof part.approval === "object" &&
        part.approval !== null &&
        !Array.isArray(part.approval)
          ? (part.approval as Record<string, unknown>)
          : null;

      return part.type === delta.toolType &&
        part.toolCallId === delta.toolCallId &&
        part.state === "approval-requested" &&
        approval?.id === delta.approvalId
        ? [index]
        : [];
    });

    if (matchingIndexes.length !== 1) {
      return null;
    }

    const index = matchingIndexes[0];
    const part = updated[index];
    const approval = part.approval as Record<string, unknown>;
    updated[index] = {
      ...part,
      state: delta.state,
      approval: {
        ...approval,
        approved: delta.approved,
        ...(delta.reason === undefined ? {} : { reason: delta.reason }),
      },
    };
  }

  return updated;
}

/**
 * Merge the persisted (claimed) approval parts into finished stream parts so
 * that `onFinish` persistence preserves the claimed decision even when the
 * stream output differs. The finished parts are the base; a claimed
 * `approval-responded` or `output-denied` part overrides a stale
 * `approval-requested` part with the same toolCallId, but a more advanced
 * finished state (e.g. `output-available`) is kept as-is. Persisted approval
 * parts that are absent from the finished parts are appended.
 */
export function mergeClaimedApprovalParts({
  finishedParts,
  claimedParts,
}: {
  finishedParts: Record<string, unknown>[];
  claimedParts: Record<string, unknown>[];
}): Record<string, unknown>[] {
  const claimedApprovalMap = new Map<string, Record<string, unknown>>();

  for (const p of claimedParts) {
    if (p.state === "approval-responded" || p.state === "output-denied") {
      claimedApprovalMap.set(String(p.toolCallId ?? ""), p);
    }
  }

  const usedClaimedKeys = new Set<string>();

  const merged = finishedParts.map((p) => {
    const key = p.toolCallId ? String(p.toolCallId) : "";
    if (!key || !claimedApprovalMap.has(key)) {
      return p;
    }

    const claimed = claimedApprovalMap.get(key);
    if (!claimed) {
      return p;
    }

    if (p.state === "approval-requested") {
      usedClaimedKeys.add(key);
      return { ...p, ...claimed };
    }

    usedClaimedKeys.add(key);
    return p;
  });

  for (const [key, claimedPart] of claimedApprovalMap) {
    if (!usedClaimedKeys.has(key)) {
      merged.push(claimedPart);
    }
  }

  return merged;
}

/**
 * Build UI messages from previously read DB rows, replacing any message that
 * was claimed with its freshly persisted version so the model sees the
 * committed decision instead of the stale `approval-requested` state.
 */
export function buildUiMessagesWithClaims({
  messagesFromDb,
  claimedMessages,
}: {
  messagesFromDb: DBMessage[];
  claimedMessages: DBMessage[];
}): ChatMessage[] {
  const claimedMap = new Map(claimedMessages.map((m) => [m.id, m]));
  const dbUiMessages = convertToUIMessages(messagesFromDb);

  return dbUiMessages.map((msg) => {
    const claimed = claimedMap.get(msg.id);
    if (!claimed) {
      return msg;
    }
    return convertToUIMessages([claimed])[0] as ChatMessage;
  }) as ChatMessage[];
}
