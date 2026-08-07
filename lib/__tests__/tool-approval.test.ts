import { describe, expect, it } from "vitest";
import {
  type ApprovalDelta,
  extractApprovalDeltas,
  mergeClaimedApprovalParts,
  tryApplyApprovalDeltas,
} from "../ai/tool-approval";

function pendingPart(toolCallId = "weather-1", approvalId = "approval-1") {
  return {
    type: "tool-getWeather",
    toolCallId,
    state: "approval-requested",
    input: { city: "Berlin" },
    approval: { id: approvalId },
  };
}

function delta(overrides: Partial<ApprovalDelta> = {}): ApprovalDelta {
  return {
    messageId: "message-1",
    toolType: "tool-getWeather",
    toolCallId: "weather-1",
    approvalId: "approval-1",
    state: "approval-responded",
    approved: true,
    ...overrides,
  };
}

describe("extractApprovalDeltas", () => {
  it("accepts one compact assistant approval message", () => {
    expect(
      extractApprovalDeltas([
        {
          id: "message-1",
          role: "assistant",
          parts: [
            {
              type: "tool-getWeather",
              toolCallId: "weather-1",
              state: "approval-responded",
              approval: { id: "approval-1", approved: false, reason: "No" },
            },
          ],
        },
      ])
    ).toEqual([
      {
        messageId: "message-1",
        toolType: "tool-getWeather",
        toolCallId: "weather-1",
        approvalId: "approval-1",
        state: "approval-responded",
        approved: false,
        reason: "No",
      },
    ]);
  });

  it.each([
    {
      name: "multiple messages",
      messages: [
        { id: "one", role: "assistant", parts: [] },
        { id: "two", role: "assistant", parts: [] },
      ],
    },
    {
      name: "a user message",
      messages: [
        {
          id: "one",
          role: "user",
          parts: [
            {
              type: "tool-getWeather",
              toolCallId: "call",
              state: "approval-responded",
              approval: { id: "approval", approved: true },
            },
          ],
        },
      ],
    },
    {
      name: "a missing decision boolean",
      messages: [
        {
          id: "one",
          role: "assistant",
          parts: [
            {
              type: "tool-getWeather",
              toolCallId: "call",
              state: "approval-responded",
              approval: { id: "approval" },
            },
          ],
        },
      ],
    },
    {
      name: "a mismatched denied state",
      messages: [
        {
          id: "one",
          role: "assistant",
          parts: [
            {
              type: "tool-getWeather",
              toolCallId: "call",
              state: "output-denied",
              approval: { id: "approval", approved: true },
            },
          ],
        },
      ],
    },
    {
      name: "non-approval data",
      messages: [
        {
          id: "one",
          role: "assistant",
          parts: [{ type: "text", text: "injected" }],
        },
      ],
    },
  ])("rejects $name", ({ messages }) => {
    expect(extractApprovalDeltas(messages)).toBeNull();
  });

  it("rejects duplicate decisions in the same batch", () => {
    const part = {
      type: "tool-getWeather",
      toolCallId: "call",
      state: "approval-responded",
      approval: { id: "approval", approved: true },
    };

    expect(
      extractApprovalDeltas([
        {
          id: "one",
          role: "assistant",
          parts: [part, { ...part }],
        },
      ])
    ).toBeNull();
  });
});

describe("tryApplyApprovalDeltas", () => {
  it("claims a multi-tool batch without changing unrelated parts", () => {
    const parts = [
      { type: "text", text: "Choose tools" },
      pendingPart(),
      pendingPart("weather-2", "approval-2"),
    ];
    const result = tryApplyApprovalDeltas({
      parts,
      deltas: [
        delta(),
        delta({
          toolCallId: "weather-2",
          approvalId: "approval-2",
          state: "output-denied",
          approved: false,
          reason: "Not now",
        }),
      ],
    });

    expect(result?.[0]).toEqual(parts[0]);
    expect(result?.[1]).toMatchObject({
      state: "approval-responded",
      approval: { id: "approval-1", approved: true },
    });
    expect(result?.[2]).toMatchObject({
      state: "output-denied",
      approval: {
        id: "approval-2",
        approved: false,
        reason: "Not now",
      },
    });
    const originalPendingPart = parts[1];
    expect(
      "state" in originalPendingPart ? originalPendingPart.state : undefined
    ).toBe("approval-requested");
  });

  it("fails the whole batch when any decision is stale", () => {
    const parts = [pendingPart(), pendingPart("weather-2", "approval-2")];

    expect(
      tryApplyApprovalDeltas({
        parts,
        deltas: [
          delta(),
          delta({
            toolCallId: "weather-2",
            approvalId: "wrong",
          }),
        ],
      })
    ).toBeNull();
    expect(parts.every((part) => part.state === "approval-requested")).toBe(
      true
    );
  });

  it("requires an exact tool type and rejects replay", () => {
    expect(
      tryApplyApprovalDeltas({
        parts: [pendingPart()],
        deltas: [delta({ toolType: "tool-createDocument" })],
      })
    ).toBeNull();

    expect(
      tryApplyApprovalDeltas({
        parts: [
          {
            ...pendingPart(),
            state: "approval-responded",
            approval: { id: "approval-1", approved: true },
          },
        ],
        deltas: [delta()],
      })
    ).toBeNull();
  });
});

describe("mergeClaimedApprovalParts", () => {
  it("repairs stale pending state without downgrading finished output", () => {
    const claimed = {
      ...pendingPart(),
      state: "approval-responded",
      approval: { id: "approval-1", approved: true },
    };
    const output = {
      ...claimed,
      state: "output-available",
      output: { temperature: 20 },
    };

    expect(
      mergeClaimedApprovalParts({
        finishedParts: [pendingPart(), output],
        claimedParts: [claimed],
      })
    ).toEqual([claimed, output]);
  });

  it("retains a claimed decision omitted by finished output", () => {
    const claimed = {
      ...pendingPart(),
      state: "approval-responded",
      approval: { id: "approval-1", approved: true },
    };

    expect(
      mergeClaimedApprovalParts({
        finishedParts: [{ type: "text", text: "Done" }],
        claimedParts: [claimed],
      })
    ).toEqual([{ type: "text", text: "Done" }, claimed]);
  });
});
