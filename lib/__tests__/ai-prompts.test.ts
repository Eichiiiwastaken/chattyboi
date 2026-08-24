import { describe, expect, it } from "vitest";
import { getCurrentDateTimePrompt, systemPrompt } from "@/lib/ai/prompts";

describe("getCurrentDateTimePrompt", () => {
  it("adds the current date and time in the user's timezone", () => {
    expect(
      getCurrentDateTimePrompt(
        "Europe/Berlin",
        new Date("2026-07-03T19:00:00.000Z")
      )
    ).toContain("Friday, 3 July 2026 at 21:00:00 CEST (Europe/Berlin).");
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(
      getCurrentDateTimePrompt(
        "not-a-timezone",
        new Date("2026-07-03T19:00:00.000Z")
      )
    ).toContain("(UTC).");
  });

  it("adds the evidence and citation protocol for deep research", () => {
    const prompt = systemPrompt({
      requestHints: {
        city: "Berlin",
        country: "DE",
        latitude: "52.52",
        longitude: "13.40",
        timezone: "Europe/Berlin",
      },
      researchMode: "deep",
    });

    expect(prompt).toContain("Deep research is enabled");
    expect(prompt).toContain("Prefer primary sources");
    expect(prompt).toContain("newly discovered subtopics");
    expect(prompt).toContain("as many passes as the question needs");
    expect(prompt).toContain("inline Markdown links");
    expect(prompt).toContain("untrusted evidence");
  });

  it("sets a plain-language style for prose", () => {
    const prompt = systemPrompt({
      requestHints: {
        city: "Berlin",
        country: "DE",
        latitude: "52.52",
        longitude: "13.40",
        timezone: "Europe/Berlin",
      },
    });

    expect(prompt).toContain("use plain language and concrete details");
    expect(prompt).toContain("Preserve the user's tone");
    expect(prompt).toContain("Use sentence-case headings");
  });
});
