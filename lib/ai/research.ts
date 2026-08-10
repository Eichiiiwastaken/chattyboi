export const RESEARCH_MODES = ["off", "search", "deep"] as const;

export type ResearchMode = (typeof RESEARCH_MODES)[number];

export const MIN_DEEP_RESEARCH_SEARCHES = 3;
export const MAX_DEEP_RESEARCH_SEARCHES = 12;
export const MAX_DEEP_RESEARCH_ANSWER_TOKENS = 8192;
export const MAX_DEEP_RESEARCH_ANSWER_CHARACTERS = 32_000;

export function isResearchMode(value: unknown): value is ResearchMode {
  return RESEARCH_MODES.includes(value as ResearchMode);
}

export function resolveResearchMode({
  researchMode,
  webSearchEnabled,
}: {
  researchMode?: ResearchMode;
  webSearchEnabled?: boolean;
}): ResearchMode {
  if (researchMode) {
    return researchMode;
  }

  return webSearchEnabled ? "search" : "off";
}
