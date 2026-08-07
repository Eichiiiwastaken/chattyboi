import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AllowedUser } from "@/lib/auth/users";

const mockCompare = vi.hoisted(() => vi.fn());

vi.mock("bcryptjs", () => ({
  compare: mockCompare,
}));

const { verifyPassword } = await import("@/lib/auth/credentials");

const dummyHash = "$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhash";
const realHash = "$2a$10$realhashrealhashrealhashrealhashrealhashre";
const knownUser: AllowedUser = {
  username: "testuser",
  name: "Test User",
  passwordHash: realHash,
};

describe("verifyPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unknown user: calls compare exactly once with dummy hash, returns false even if compare returns true", async () => {
    mockCompare.mockResolvedValue(true);

    const result = await verifyPassword("any_password", undefined, dummyHash);

    expect(result).toBe(false);
    expect(mockCompare).toHaveBeenCalledTimes(1);
    expect(mockCompare).toHaveBeenCalledWith("any_password", dummyHash);
  });

  it("known wrong password: calls compare exactly once with real hash, returns false", async () => {
    mockCompare.mockResolvedValue(false);

    const result = await verifyPassword("wrong_password", knownUser, dummyHash);

    expect(result).toBe(false);
    expect(mockCompare).toHaveBeenCalledTimes(1);
    expect(mockCompare).toHaveBeenCalledWith("wrong_password", realHash);
  });

  it("known correct password: calls compare exactly once with real hash, returns true", async () => {
    mockCompare.mockResolvedValue(true);

    const result = await verifyPassword(
      "correct_password",
      knownUser,
      dummyHash
    );

    expect(result).toBe(true);
    expect(mockCompare).toHaveBeenCalledTimes(1);
    expect(mockCompare).toHaveBeenCalledWith("correct_password", realHash);
  });
});
