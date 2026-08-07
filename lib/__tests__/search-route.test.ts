import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ipAddressSpy: vi.fn(),
  checkIpRateLimitSpy: vi.fn(),
  authSpy: vi.fn(),
  searchWebSpy: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({ ipAddress: mocks.ipAddressSpy }));
vi.mock("@/lib/ratelimit", () => ({
  checkIpRateLimit: mocks.checkIpRateLimitSpy,
}));
vi.mock("@/app/(auth)/auth", () => ({ auth: mocks.authSpy }));
vi.mock("@/lib/ai/tools/web-search", () => ({ searchWeb: mocks.searchWebSpy }));

import { POST } from "@/app/(chat)/api/search/route";
import { ChatbotError } from "@/lib/errors";

describe("POST /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSpy.mockResolvedValue({ user: { id: "test-user" } });
    mocks.ipAddressSpy.mockReturnValue("203.0.113.1");
    mocks.checkIpRateLimitSpy.mockResolvedValue(undefined);
    mocks.searchWebSpy.mockResolvedValue({ results: [] });
  });

  it("passes ipAddress() result to checkIpRateLimit, not raw x-forwarded-for", async () => {
    const request = new Request("http://localhost/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "1.2.3.4",
      },
      body: JSON.stringify({ query: "test" }),
    });

    const response = await POST(request);

    expect(mocks.ipAddressSpy).toHaveBeenCalledWith(request);
    expect(mocks.checkIpRateLimitSpy).toHaveBeenCalledWith("203.0.113.1");
    expect(response.status).toBe(200);
  });

  it("calls checkIpRateLimit with undefined when ipAddress returns nothing", async () => {
    mocks.ipAddressSpy.mockReturnValue(undefined);

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });

    await POST(request);
    expect(mocks.checkIpRateLimitSpy).toHaveBeenCalledWith(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.authSpy.mockResolvedValue(null);

    const request = new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(mocks.checkIpRateLimitSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid search body", async () => {
    const request = new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns the structured 429 response when the rate limit is exceeded", async () => {
    mocks.checkIpRateLimitSpy.mockRejectedValue(
      new ChatbotError("rate_limit:chat")
    );

    const response = await POST(
      new Request("http://localhost/api/search", {
        body: JSON.stringify({ query: "test" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: "rate_limit:chat",
    });
  });
});
