import {
  MAX_DEEP_RESEARCH_SEARCHES,
  MIN_DEEP_RESEARCH_SEARCHES,
  type ResearchMode,
} from "./research";

type WebSearchStepSettings =
  | {
      activeTools: ["webSearch"];
      system?: string;
      toolChoice: "auto" | "required";
    }
  | {
      activeTools: ["webSearch"];
      system: string;
      toolChoice: "none";
    };

export function getWebSearchStepSettings({
  baseSystemPrompt,
  completedSearches = 0,
  researchMode = "search",
  stepNumber,
}: {
  baseSystemPrompt: string;
  completedSearches?: number;
  researchMode?: Exclude<ResearchMode, "off">;
  stepNumber: number;
}): WebSearchStepSettings {
  if (researchMode === "deep") {
    if (
      completedSearches >= MAX_DEEP_RESEARCH_SEARCHES ||
      stepNumber >= MAX_DEEP_RESEARCH_SEARCHES
    ) {
      return {
        activeTools: ["webSearch"],
        system: `${baseSystemPrompt}\n\nThe research phase is complete. Do not call tools again. Write the final answer now. Synthesize the evidence rather than listing search results. Use descriptive inline Markdown links for factual claims, distinguish consensus from disagreement, and state important limitations or uncertainty. End with a compact "Sources" section containing the most important sources only.`,
        toolChoice: "none",
      };
    }

    const mustContinue = completedSearches < MIN_DEEP_RESEARCH_SEARCHES;
    return {
      activeTools: ["webSearch"],
      system: `${baseSystemPrompt}\n\nResearch pass ${completedSearches + 1} of up to ${MAX_DEEP_RESEARCH_SEARCHES}. ${
        mustContinue
          ? "You must call webSearch exactly once in this pass. Do not write the final answer yet."
          : "Reassess everything collected so far. Call webSearch exactly once if a material evidence gap, conflicting claim, newly discovered subtopic, or missing primary source remains. Otherwise, write the final answer now."
      } When searching, choose a focused follow-up query that adds new evidence; do not repeat an earlier query.`,
      toolChoice: mustContinue ? "required" : "auto",
    };
  }

  if (stepNumber === 0) {
    return {
      activeTools: ["webSearch"],
      toolChoice: "auto",
    };
  }

  return {
    activeTools: ["webSearch"],
    system: `${baseSystemPrompt}\n\nYou have already received the webSearch result for this turn. Do not call tools again. Answer the user's latest request now using the returned search results, and cite the source title and URL for current or external claims. If the results are insufficient, say what the results showed and what remains uncertain.`,
    toolChoice: "none",
  };
}
