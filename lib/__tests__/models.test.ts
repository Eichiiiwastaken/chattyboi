import { afterEach, describe, expect, it, vi } from "vitest";

const gatewayMock = vi.hoisted(() => ({
  getAvailableModels: vi.fn(),
}));

vi.mock("@ai-sdk/gateway", () => ({
  gateway: gatewayMock,
}));

afterEach(() => {
  vi.useRealTimers();
  gatewayMock.getAvailableModels.mockReset();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("Mock Models", () => {
  it("mock models produce streaming responses", async () => {
    const { chatModel } = await import("../ai/models.mock");
    const model = chatModel as any;

    const result = model.doStream({ prompt: "Hello" });
    expect(result.stream).toBeDefined();

    const reader = result.stream.getReader();
    const chunks: unknown[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }

    expect(chunks.length).toBeGreaterThan(0);
    const textDeltas = chunks.filter((c: any) => c.type === "text-delta");
    expect(textDeltas.length).toBeGreaterThan(0);
  });

  it("mock title model generates a title", async () => {
    const { titleModel: mockTitleModel } = await import("../ai/models.mock");
    const model = mockTitleModel as any;

    const result = await model.doGenerate({ prompt: "Test" });
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBeDefined();
  });

  it("mock models return greeting for hello prompts", async () => {
    const { chatModel } = await import("../ai/models.mock");
    const model = chatModel as any;

    const result = await model.doGenerate({ prompt: "hello there" });
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain("Hello");
  });

  it("mock models return weather for weather prompts", async () => {
    const { chatModel } = await import("../ai/models.mock");
    const model = chatModel as any;

    const result = await model.doGenerate({
      prompt: "What is the weather?",
    });
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain("San Francisco");
  });

  it("mock models return default for unknown prompts", async () => {
    const { chatModel } = await import("../ai/models.mock");
    const model = chatModel as any;

    const result = await model.doGenerate({ prompt: "Some random topic" });
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain("mock response");
  });
});

describe("estimateTokenCost", () => {
  it("combines input and output tokens using per-million rates", async () => {
    const { estimateTokenCost } = await import("../ai/models");

    expect(
      estimateTokenCost({
        inputTokens: 2000,
        outputTokens: 500,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
      })
    ).toBe(0.01);
  });
});

describe("provider model discovery", () => {
  it("does not fetch OpenRouter models without an OpenRouter API key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { fetchOpenRouterModels } = await import("../ai/models");

    await expect(fetchOpenRouterModels()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not fetch OpenCode Go models without an OpenCode API key", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { fetchOpenCodeGoModels } = await import("../ai/models");

    await expect(fetchOpenCodeGoModels()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches AI Gateway models when an AI Gateway key is configured", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck_test");
    gatewayMock.getAvailableModels.mockResolvedValue({
      models: [
        {
          description: "Gateway Kimi",
          id: "moonshotai/kimi-k2.6",
          name: "Kimi K2.6",
          pricing: { input: "0.0000002", output: "0.0000012" },
        },
      ],
    });
    const { fetchGatewayModels } = await import("../ai/models");

    await expect(fetchGatewayModels()).resolves.toEqual([
      {
        description: "Gateway Kimi",
        id: "moonshotai/kimi-k2.6",
        name: "Kimi K2.6",
        pricing: { inputPerMillion: 0.2, outputPerMillion: 1.2 },
        provider: "moonshotai",
      },
    ]);
    expect(gatewayMock.getAvailableModels).toHaveBeenCalled();
  });

  it("preserves AI Gateway pricing in the combined model catalog", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck_test");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENCODE_API_KEY", "");
    gatewayMock.getAvailableModels.mockResolvedValue({
      models: [
        {
          description: "Gateway Luna",
          id: "openai/gpt-5.6-luna",
          name: "GPT 5.6 Luna",
          pricing: { input: "0.0000002", output: "0.0000012" },
        },
      ],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: async () => ({ data: [] }),
      ok: true,
    } as Response);
    const { fetchAllModelData } = await import("../ai/models");

    const { allModels } = await fetchAllModelData();

    expect(
      allModels.find((model) => model.id === "openai/gpt-5.6-luna")?.pricing
    ).toEqual({ inputPerMillion: 0.2, outputPerMillion: 1.2 });
  });

  it("falls back to public OpenRouter catalog with Gateway ids when Gateway metadata fails", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck_test");
    gatewayMock.getAvailableModels.mockRejectedValue(new Error("gateway down"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: async () => ({
        data: [{ id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
      }),
      ok: true,
    } as Response);
    const { fetchGatewayModels } = await import("../ai/models");

    await expect(fetchGatewayModels()).resolves.toEqual([
      {
        description: "",
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        provider: "google",
      },
    ]);
  });

  it("falls back when Gateway model discovery stalls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck_test");
    gatewayMock.getAvailableModels.mockImplementation(
      () => new Promise(() => undefined)
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: [{ id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
        }),
      ok: true,
    } as Response);
    const { fetchGatewayModels } = await import("../ai/models");

    const result = fetchGatewayModels();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(result).resolves.toEqual([
      {
        description: "",
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        provider: "google",
      },
    ]);
  });

  it("aborts a stalled OpenCode Go catalog request", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENCODE_API_KEY", "oc_test");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const { fetchOpenCodeGoModels } = await import("../ai/models");

    const result = fetchOpenCodeGoModels();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(result).resolves.toEqual([]);
  });

  it("marks direct OpenAI GPT-5 models as reasoning-capable", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENCODE_API_KEY", "");
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);

      return Promise.resolve({
        json: () =>
          Promise.resolve(
            url.includes("api.openai.com")
              ? { data: [{ id: "gpt-5.6-terra" }] }
              : { data: [] }
          ),
        ok: true,
      } as Response);
    });
    const { fetchAllModelData } = await import("../ai/models");

    const { capabilities } = await fetchAllModelData();

    expect(capabilities["openai/gpt-5.6-terra"]?.reasoning).toBe(true);
  });
});
