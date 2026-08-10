import { describe, expect, it } from "vitest";
import { getWebSearchStepSettings } from "../ai/web-search-step";

describe("web search step settings", () => {
  it("allows the model to call web search on the first step", () => {
    expect(
      getWebSearchStepSettings({
        baseSystemPrompt: "Base prompt",
        stepNumber: 0,
      })
    ).toEqual({
      activeTools: ["webSearch"],
      toolChoice: "auto",
    });
  });

  it("keeps the web search tool schema while preventing another tool call", () => {
    const settings = getWebSearchStepSettings({
      baseSystemPrompt: "Base prompt",
      stepNumber: 1,
    });

    expect(settings.activeTools).toEqual(["webSearch"]);
    expect(settings.toolChoice).toBe("none");
    expect("system" in settings ? settings.system : "").toContain(
      "Do not call tools again."
    );
  });

  it("requires multiple evidence passes for deep research", () => {
    const settings = getWebSearchStepSettings({
      baseSystemPrompt: "Base prompt",
      completedSearches: 1,
      researchMode: "deep",
      stepNumber: 1,
    });

    expect(settings.toolChoice).toBe("required");
    expect("system" in settings ? settings.system : "").toContain(
      "Research pass 2"
    );
  });

  it("lets deep research finish after its minimum evidence passes", () => {
    const settings = getWebSearchStepSettings({
      baseSystemPrompt: "Base prompt",
      completedSearches: 3,
      researchMode: "deep",
      stepNumber: 3,
    });

    expect(settings.toolChoice).toBe("auto");
  });

  it("can keep following new evidence beyond five searches", () => {
    const settings = getWebSearchStepSettings({
      baseSystemPrompt: "Base prompt",
      completedSearches: 6,
      researchMode: "deep",
      stepNumber: 6,
    });

    expect(settings.toolChoice).toBe("auto");
    expect("system" in settings ? settings.system : "").toContain(
      "newly discovered subtopic"
    );
  });

  it("forces synthesis when the deep research search budget is spent", () => {
    const settings = getWebSearchStepSettings({
      baseSystemPrompt: "Base prompt",
      completedSearches: 12,
      researchMode: "deep",
      stepNumber: 12,
    });

    expect(settings.toolChoice).toBe("none");
    expect("system" in settings ? settings.system : "").toContain(
      "research phase is complete"
    );
  });
});
