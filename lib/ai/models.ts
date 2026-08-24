import { gateway } from "@ai-sdk/gateway";
import { isTestEnvironment } from "@/lib/constants";
import { getModelPreferenceBoost } from "./model-preferences";
import { isGatewayConfigured, isProviderConfigured } from "./provider-config";

export const DEFAULT_CHAT_MODEL = "opencodego/kimi-k2.6";
export const GATEWAY_FALLBACK_CHAT_MODEL = "moonshotai/kimi-k2.6";

export const titleModel = {
  id: "opencodego/kimi-k2.6",
  name: "Kimi K2.6",
  provider: "opencodego",
  description: "Fast model for title generation",
};

const MOCK_MODELS: ChatModel[] = [
  {
    id: "opencodego/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "opencodego",
    description: "",
  },
  {
    id: "opencodego/mistral-small",
    name: "Mistral Small",
    provider: "opencodego",
    description: "",
  },
  {
    id: "opencodego/deepseek-v3",
    name: "DeepSeek V3",
    provider: "opencodego",
    description: "",
  },
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "openai", description: "" },
  { id: "openai/o1", name: "O1", provider: "openai", description: "" },
  {
    id: "openrouter/mistralai/mistral-small",
    name: "Mistral Small",
    provider: "openrouter",
    description: "",
  },
  {
    id: "openrouter/moonshotai/kimi-k2",
    name: "Kimi K2",
    provider: "openrouter",
    description: "",
  },
];

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  file: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  pricing?: ModelPricing;
};

export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

export function estimateTokenCost({
  inputTokens,
  outputTokens,
  pricing,
}: {
  inputTokens: number;
  outputTokens: number;
  pricing: ModelPricing;
}) {
  return (
    (inputTokens * pricing.inputPerMillion +
      outputTokens * pricing.outputPerMillion) /
    1_000_000
  );
}

const MAX_MODELS_TOTAL = 80;
const MODEL_CATALOG_TIMEOUT_MS = 5000;
const DEFAULT_PROVIDER_LIMIT = 12;
const OPENROUTER_PROVIDER_LIMIT = 48;
const PROVIDER_SORT_ORDER = [
  "opencodego",
  "openai",
  "anthropic",
  "anthropicai",
  "google",
  "google-vertex",
  "google-vertex-anthropic",
  "meta",
  "deepseek",
  "xai",
  "x-ai",
  "moonshotai",
  "mistralai",
  "mistral",
  "alibaba",
  "qwen",
  "zai",
  "z-ai",
  "zhipuai",
  "minimax",
  "xiaomi",
  "stealth",
  "inclusionai",
  "perplexity",
  "cohere",
  "groq",
  "cerebras",
  "together",
  "togetherai",
  "fireworks-ai",
  "deepinfra",
  "amazon-bedrock",
  "bedrock",
  "ai21",
  "huggingface",
  "requesty",
  "openrouter",
];

const NON_CHAT_MODEL_PATTERN =
  /(^|[-_/])(audio|babbage|clip|davinci|dall-e|edit|embedding|image|moderation|rerank|sdxl|speech|stable-diffusion|tts|transcribe|translate|whisper)([-_/]|$)/i;

const PREFERRED_MODEL_PATTERNS: [RegExp, number][] = [
  [/gpt-5|gpt-4\.1|gpt-4o|o[34]|chatgpt/i, 120],
  [/claude|sonnet|opus|haiku/i, 115],
  [/gemini|learnlm/i, 110],
  [/grok|x-ai|xai/i, 105],
  [/deepseek|r1|v3/i, 100],
  [/kimi|moonshot/i, 95],
  [/llama|meta/i, 90],
  [/qwen|alibaba/i, 88],
  [/mistral|codestral|ministral/i, 85],
  [/glm|zai|zhipu/i, 82],
  [/perplexity|sonar/i, 78],
  [/command|cohere/i, 70],
  [/grok|groq|cerebras|together|fireworks/i, 68],
  [/minimax|inclusion|xiaomi|stealth/i, 64],
];

const MODEL_PENALTY_PATTERNS: [RegExp, number][] = [
  [/legacy|deprecated|experimental/i, 35],
  [/preview|beta|alpha|test/i, 20],
  [/free/i, 10],
];

function providerSortIndex(provider: string) {
  const index = PROVIDER_SORT_ORDER.indexOf(provider);
  return index === -1 ? 999 : index;
}

function scoreModel(model: ChatModel) {
  const searchable = `${model.id} ${model.name} ${model.provider}`;
  let score =
    (model.id === DEFAULT_CHAT_MODEL ? 1000 : 0) +
    getModelPreferenceBoost(model.id);

  for (const [pattern, value] of PREFERRED_MODEL_PATTERNS) {
    if (pattern.test(searchable)) {
      score += value;
    }
  }

  for (const [pattern, value] of MODEL_PENALTY_PATTERNS) {
    if (pattern.test(searchable)) {
      score -= value;
    }
  }

  if (/latest|pro|max|ultra|large/i.test(searchable)) {
    score += 12;
  }

  if (/mini|small|flash|haiku|lite|nano/i.test(searchable)) {
    score += 8;
  }

  return score;
}

function providerLimit(provider: string) {
  return provider === "openrouter"
    ? OPENROUTER_PROVIDER_LIMIT
    : DEFAULT_PROVIDER_LIMIT;
}

function curateModels(models: ChatModel[]) {
  const chatModels = models.filter((model) => {
    if (model.id === DEFAULT_CHAT_MODEL) {
      return true;
    }

    return !NON_CHAT_MODEL_PATTERN.test(`${model.id} ${model.name}`);
  });

  const scoredModels = chatModels
    .map((model, index) => ({ index, model, score: scoreModel(model) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      const providerDelta =
        providerSortIndex(a.model.provider) -
        providerSortIndex(b.model.provider);
      if (providerDelta !== 0) {
        return providerDelta;
      }

      return b.score - a.score || a.index - b.index;
    });

  const providerCounts = new Map<string, number>();
  const curated: ChatModel[] = [];

  for (const { model } of scoredModels) {
    const count = providerCounts.get(model.provider) ?? 0;
    if (count >= providerLimit(model.provider)) {
      continue;
    }

    providerCounts.set(model.provider, count + 1);
    curated.push(model);

    if (curated.length >= MAX_MODELS_TOTAL) {
      break;
    }
  }

  if (curated.length > 0) {
    return curated;
  }

  return chatModels.slice(0, MAX_MODELS_TOTAL);
}

function capabilitiesForModels(
  capabilities: Record<string, ModelCapabilities>,
  models: ChatModel[]
) {
  const allowedIds = new Set(models.map((model) => model.id));

  return Object.fromEntries(
    Object.entries(capabilities).filter(([modelId]) => allowedIds.has(modelId))
  );
}

function uniqueModels(models: ChatModel[]) {
  const seen = new Set<string>();

  return models.filter((model) => {
    if (seen.has(model.id)) {
      return false;
    }

    seen.add(model.id);
    return true;
  });
}

async function withCatalogTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutResult = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => {
      controller.abort();
      reject(new DOMException("Model catalog timed out", "TimeoutError"));
    }, MODEL_CATALOG_TIMEOUT_MS);
    timeout.unref?.();
  });
  try {
    const operationResult = Promise.resolve().then(() =>
      operation(controller.signal)
    );
    return await Promise.race([operationResult, timeoutResult]);
  } finally {
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout);
    }
  }
}

export async function fetchGatewayModels(): Promise<ChatModel[]> {
  if (!isGatewayConfigured()) {
    return [];
  }

  try {
    const metadata = await withCatalogTimeout(() =>
      gateway.getAvailableModels()
    );
    return (metadata.models ?? []).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      provider: model.id.split("/")[0] ?? "gateway",
      description: model.description ?? "",
      pricing: parsePerTokenPricing(
        model.pricing?.input,
        model.pricing?.output
      ),
    }));
  } catch {
    return fetchPublicOpenRouterModels({ gatewayIds: true });
  }
}

export async function fetchOpenCodeGoModels(): Promise<ChatModel[]> {
  if (!isProviderConfigured("opencodego")) {
    return [];
  }

  try {
    const res = await withCatalogTimeout((signal) =>
      fetch("https://opencode.ai/zen/go/v1/models", {
        next: { revalidate: 86_400 },
        signal,
      })
    );
    if (!res.ok) {
      return [];
    }
    const json = await res.json();
    return (json.data ?? []).map((m: { id: string }) => ({
      id: `opencodego/${m.id}`,
      name: m.id,
      provider: "opencodego",
      description: "",
    }));
  } catch {
    return [];
  }
}

export async function fetchOpenAIModels(): Promise<ChatModel[]> {
  if (!isProviderConfigured("openai")) {
    return [];
  }
  try {
    const res = await withCatalogTimeout((signal) =>
      fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        next: { revalidate: 86_400 },
        signal,
      })
    );
    if (!res.ok) {
      return [];
    }
    const json = await res.json();
    return (json.data ?? [])
      .filter((m: { id: string }) => isChatModel(m.id))
      .map((m: { id: string }) => ({
        id: `openai/${m.id}`,
        name: m.id,
        provider: "openai",
        description: "",
      }));
  } catch {
    return [];
  }
}

function isChatModel(modelId: string): boolean {
  return /^(gpt|o[1-9]|o\d|chatgpt)/i.test(modelId);
}

export async function fetchOpenRouterModels(): Promise<ChatModel[]> {
  if (!isProviderConfigured("openrouter")) {
    return [];
  }

  return await fetchPublicOpenRouterModels({ gatewayIds: false });
}

async function fetchPublicOpenRouterModels({
  gatewayIds,
}: {
  gatewayIds: boolean;
}): Promise<ChatModel[]> {
  try {
    const res = await withCatalogTimeout((signal) =>
      fetch("https://openrouter.ai/api/v1/models", {
        next: { revalidate: 86_400 },
        signal,
      })
    );
    if (!res.ok) {
      return [];
    }
    const json = await res.json();
    return (json.data ?? []).map((m: OpenRouterRawModel) => ({
      id: gatewayIds ? m.id : `openrouter/${m.id}`,
      name: m.name || m.id,
      provider: m.id.split("/")[0] ?? (gatewayIds ? "gateway" : "openrouter"),
      description: m.description ?? "",
      pricing: parsePricing(m),
    }));
  } catch {
    return [];
  }
}

export async function getAllModels(): Promise<ChatModel[]> {
  if (isTestEnvironment) {
    return MOCK_MODELS;
  }
  const [gatewayModels, openCodeGoModels, openRouterModels, openAIModels] =
    await Promise.all([
      fetchGatewayModels(),
      fetchOpenCodeGoModels(),
      fetchOpenRouterModels(),
      fetchOpenAIModels(),
    ]);
  return curateModels(
    uniqueModels([
      ...gatewayModels,
      ...openCodeGoModels,
      ...openRouterModels,
      ...openAIModels,
    ])
  );
}

type OpenRouterRawModel = {
  id: string;
  name?: string;
  description?: string;
  architecture?: { input_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
};

async function fetchOpenRouterRawData(): Promise<OpenRouterRawModel[]> {
  try {
    const res = await withCatalogTimeout((signal) =>
      fetch("https://openrouter.ai/api/v1/models", {
        next: { revalidate: 86_400 },
        signal,
      })
    );
    if (!res.ok) {
      return [];
    }
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

function parsePricing(modelData: OpenRouterRawModel): ModelPricing | undefined {
  return parsePerTokenPricing(
    modelData.pricing?.prompt,
    modelData.pricing?.completion
  );
}

function parsePerTokenPricing(
  inputPerTokenValue: string | undefined,
  outputPerTokenValue: string | undefined
): ModelPricing | undefined {
  const inputPerToken = Number(inputPerTokenValue);
  const outputPerToken = Number(outputPerTokenValue);

  if (
    !Number.isFinite(inputPerToken) ||
    !Number.isFinite(outputPerToken) ||
    (inputPerToken === 0 && outputPerToken === 0)
  ) {
    return undefined;
  }

  return {
    inputPerMillion: Number((inputPerToken * 1_000_000).toPrecision(12)),
    outputPerMillion: Number((outputPerToken * 1_000_000).toPrecision(12)),
  };
}

function findRawModel(
  modelId: string,
  models: OpenRouterRawModel[]
): OpenRouterRawModel | undefined {
  const shortId = modelId.replace(/^(opencodego|openrouter)\//, "");

  return (
    models.find((model) => model.id === shortId) ??
    models.find((model) => model.id.endsWith(`/${shortId}`))
  );
}

function pricingForModel(
  modelId: string,
  models: OpenRouterRawModel[]
): ModelPricing | undefined {
  const rawModel = findRawModel(modelId, models);
  return rawModel ? parsePricing(rawModel) : undefined;
}

export async function getEstimatedPricingForModelIds(modelIds: string[]) {
  const [gatewayModels, rawModels] = await Promise.all([
    fetchGatewayModels(),
    fetchOpenRouterRawData(),
  ]);

  return Object.fromEntries(
    modelIds
      .map((modelId) => [
        modelId,
        gatewayModels.find((model) => model.id === modelId)?.pricing ??
          pricingForModel(modelId, rawModels),
      ])
      .filter(([, pricing]) => pricing !== undefined)
  ) as Record<string, ModelPricing>;
}

function parseCapabilities(modelData: OpenRouterRawModel): ModelCapabilities {
  const modalities = modelData.architecture?.input_modalities ?? [];
  const params = modelData.supported_parameters ?? [];
  return {
    tools: params.includes("tools"),
    vision: modalities.includes("image"),
    file: modalities.includes("file"),
    reasoning:
      params.includes("reasoning") || params.includes("include_reasoning"),
  };
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  tools: true,
  vision: false,
  file: false,
  reasoning: true,
};

function inferOpenAICapabilities(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();
  const isOSeries = /^o[1-9]/.test(id);
  const hasVision = /gpt-4o|gpt-4-turbo|o1-preview|o1-pro/.test(id);
  const hasFiles = /gpt-4o/.test(id);
  return {
    tools: true,
    vision: hasVision || /o1|o3/.test(id),
    file: hasFiles,
    reasoning: isOSeries || /gpt-5/.test(id),
  };
}

function inferGatewayCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();
  const hasVision =
    /claude|gemini|gpt-4o|gpt-4\.1|gpt-5|image|pixtral|vision|vl/.test(id);

  return {
    tools: true,
    vision: hasVision,
    file: hasVision,
    reasoning: /claude|deepseek-r1|glm|gpt-5|o[1-9]|reasoning|thinking/.test(
      id
    ),
  };
}

export async function fetchAllModelData(): Promise<{
  allModels: ChatModel[];
  capabilities: Record<string, ModelCapabilities>;
}> {
  const [
    gatewayModels,
    openCodeGoModels,
    openRouterModels,
    openRouterRawData,
    openAIModels,
  ] = await Promise.all([
    fetchGatewayModels(),
    fetchOpenCodeGoModels(),
    fetchOpenRouterModels(),
    fetchOpenRouterRawData(),
    fetchOpenAIModels(),
  ]);

  const allModels = curateModels(
    uniqueModels([
      ...gatewayModels,
      ...openCodeGoModels,
      ...openRouterModels,
      ...openAIModels,
    ])
  );
  const capabilities: Record<string, ModelCapabilities> = {};

  for (const model of gatewayModels) {
    capabilities[model.id] = inferGatewayCapabilities(model.id);
  }

  for (const modelData of openRouterRawData) {
    capabilities[`openrouter/${modelData.id}`] = parseCapabilities(modelData);
  }

  for (const model of openCodeGoModels) {
    const shortName = model.id.replace("opencodego/", "");
    const match = openRouterRawData.find((m) => {
      const mId: string = m.id;
      return mId.endsWith(`/${shortName}`) || mId === shortName;
    });
    capabilities[model.id] = match
      ? parseCapabilities(match)
      : DEFAULT_CAPABILITIES;
  }

  for (const model of openAIModels) {
    const shortName = model.id.replace("openai/", "");
    capabilities[model.id] = inferOpenAICapabilities(shortName);
  }

  const modelsWithPricing = allModels.map((model) => ({
    ...model,
    pricing: model.pricing ?? pricingForModel(model.id, openRouterRawData),
  }));

  return {
    allModels: modelsWithPricing,
    capabilities: capabilitiesForModels(capabilities, modelsWithPricing),
  };
}

export async function getCapabilities(): Promise<
  Record<string, ModelCapabilities>
> {
  if (isTestEnvironment) {
    return Object.fromEntries(
      MOCK_MODELS.map((m) => [m.id, DEFAULT_CAPABILITIES])
    );
  }
  const { capabilities } = await fetchAllModelData();
  return capabilities;
}

export const isDemo = process.env.IS_DEMO === "1";

export type GatewayModelWithCapabilities = ChatModel & {
  capabilities: ModelCapabilities;
};

export async function getAllGatewayModels(): Promise<
  GatewayModelWithCapabilities[]
> {
  if (isTestEnvironment) {
    return MOCK_MODELS.map((m) => ({
      ...m,
      capabilities: DEFAULT_CAPABILITIES,
    }));
  }
  const { allModels, capabilities } = await fetchAllModelData();
  return allModels.map((m) => ({
    ...m,
    capabilities: capabilities[m.id] ?? DEFAULT_CAPABILITIES,
  }));
}

export function getActiveModels(): Promise<ChatModel[]> {
  return getAllModels();
}

export async function getAllowedModelIds(): Promise<Set<string>> {
  const models = await getAllModels();
  return new Set(models.map((m) => m.id));
}
