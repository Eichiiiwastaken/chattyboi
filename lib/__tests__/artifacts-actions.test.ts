import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getDocumentById: vi.fn(),
  getSuggestionsByDocumentId: vi.fn(),
}));

vi.mock("@/app/(auth)/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/queries", () => ({
  getDocumentById: mocks.getDocumentById,
  getSuggestionsByDocumentId: mocks.getSuggestionsByDocumentId,
}));

import { getSuggestions } from "@/artifacts/actions";

describe("getSuggestions ownership guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getDocumentById.mockResolvedValue({
      id: "doc-1",
      userId: "user-1",
    });
    mocks.getSuggestionsByDocumentId.mockResolvedValue([
      { id: "sug-1", documentId: "doc-1" },
    ]);
  });

  it("rejects unauthenticated requests before querying", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(getSuggestions({ documentId: "doc-1" })).rejects.toThrow(
      /sign in/
    );

    expect(mocks.getDocumentById).not.toHaveBeenCalled();
    expect(mocks.getSuggestionsByDocumentId).not.toHaveBeenCalled();
  });

  it("rejects missing document before querying suggestions", async () => {
    mocks.getDocumentById.mockResolvedValue(null);

    await expect(getSuggestions({ documentId: "doc-missing" })).rejects.toThrow(
      /not found/
    );

    expect(mocks.getSuggestionsByDocumentId).not.toHaveBeenCalled();
  });

  it("rejects foreign-owned document before querying suggestions", async () => {
    mocks.getDocumentById.mockResolvedValue({
      id: "doc-1",
      userId: "user-2",
    });

    await expect(getSuggestions({ documentId: "doc-1" })).rejects.toThrow(
      /belongs to another user/
    );

    expect(mocks.getSuggestionsByDocumentId).not.toHaveBeenCalled();
  });

  it("returns suggestions for authenticated owner", async () => {
    const result = await getSuggestions({ documentId: "doc-1" });

    expect(result).toEqual([{ id: "sug-1", documentId: "doc-1" }]);
    expect(mocks.getSuggestionsByDocumentId).toHaveBeenCalledWith({
      documentId: "doc-1",
    });
  });
});
