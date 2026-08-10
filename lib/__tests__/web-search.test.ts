import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWeb } from "../ai/tools/web-search";

describe("web search", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses Exa when EXA_API_KEY is configured", async () => {
    const abortController = new AbortController();
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
    vi.stubEnv("TAVILY_API_KEY", "tavily-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              title: "Exa result",
              url: "https://example.com/exa",
              highlights: ["Relevant excerpt"],
            },
          ],
        })
      )
    );

    await expect(
      searchWeb("current news", { abortSignal: abortController.signal })
    ).resolves.toEqual({
      query: "current news",
      results: [
        {
          title: "Exa result",
          url: "https://example.com/exa",
          content: "Relevant excerpt",
        },
      ],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "exa-test-key",
        },
        signal: abortController.signal,
      })
    );
  });

  it("propagates cancellation instead of turning it into a search error", async () => {
    const abortController = new AbortController();
    const abortError = new DOMException(
      "This operation was aborted",
      "AbortError"
    );
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        abortController.abort();
        throw abortError;
      })
    );

    await expect(
      searchWeb("current news", { abortSignal: abortController.signal })
    ).rejects.toBe(abortError);
  });

  it("can force Tavily with WEB_SEARCH_PROVIDER", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
    vi.stubEnv("TAVILY_API_KEY", "tavily-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              title: "Tavily result",
              url: "https://example.com/tavily",
              content: "Tavily excerpt",
            },
          ],
        })
      )
    );

    await expect(searchWeb("current news")).resolves.toEqual({
      query: "current news",
      results: [
        {
          title: "Tavily result",
          url: "https://example.com/tavily",
          content: "Tavily excerpt",
        },
      ],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        body: JSON.stringify({
          api_key: "tavily-test-key",
          query: "current news",
          max_results: 5,
        }),
      })
    );
  });

  it("uses advanced extraction and more sources for deep research", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "tavily-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              title: "Primary source",
              url: "https://example.com/primary",
              content: "Short excerpt",
              raw_content: "Full extracted page",
            },
          ],
        })
      )
    );

    await expect(
      searchWeb("evidence query", { deepResearch: true })
    ).resolves.toEqual({
      query: "evidence query",
      results: [
        {
          title: "Primary source",
          url: "https://example.com/primary",
          content: "Full extracted page",
        },
      ],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        body: JSON.stringify({
          api_key: "tavily-test-key",
          query: "evidence query",
          max_results: 6,
          chunks_per_source: 3,
          include_raw_content: "markdown",
          search_depth: "advanced",
        }),
      })
    );
  });

  it("does not treat placeholder search keys as configured", async () => {
    vi.stubEnv("EXA_API_KEY", "replace-with-exa-api-key");
    vi.stubEnv("TAVILY_API_KEY", "replace-with-tavily-api-key");
    vi.stubGlobal("fetch", vi.fn());

    await expect(searchWeb("current news")).resolves.toEqual({
      query: "current news",
      error:
        "Search is not configured. Set EXA_API_KEY or TAVILY_API_KEY to enable web search.",
      status: 503,
      results: [],
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains invalid configured search providers", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "brave");
    vi.stubGlobal("fetch", vi.fn());

    await expect(searchWeb("current news")).resolves.toEqual({
      query: "current news",
      error: 'Unsupported WEB_SEARCH_PROVIDER "brave". Use "exa" or "tavily".',
      status: 503,
      results: [],
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains missing keys for a forced provider", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "replace-with-tavily-api-key");
    vi.stubGlobal("fetch", vi.fn());

    await expect(searchWeb("current news")).resolves.toEqual({
      query: "current news",
      error:
        "Tavily search is selected but TAVILY_API_KEY is not configured. Add TAVILY_API_KEY or choose another WEB_SEARCH_PROVIDER.",
      status: 503,
      results: [],
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns provider details and key hints for auth failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ message: "invalid API key" }, { status: 401 })
      )
    );

    await expect(searchWeb("current news")).resolves.toEqual({
      query: "current news",
      error:
        "Exa search failed (401): invalid API key. Check that EXA_API_KEY is valid.",
      status: 401,
      results: [],
    });
  });

  it("returns a reachable error when the provider request throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(searchWeb("current news")).resolves.toEqual({
      query: "current news",
      error:
        "Exa search could not be reached. Check your network connection and try again.",
      status: 503,
      results: [],
    });
  });
});
