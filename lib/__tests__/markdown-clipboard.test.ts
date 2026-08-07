import { describe, expect, it } from "vitest";
import { normalizePastedMarkdown } from "@/lib/markdown/clipboard";

describe("normalizePastedMarkdown", () => {
  it("joins ordered markers separated from their heading by blank lines", () => {
    expect(
      normalizePastedMarkdown(
        "1.\n\n\nFreischneiden (Bindung lösen):\n\n2. Kinematik"
      )
    ).toBe("1. Freischneiden (Bindung lösen):\n\n2. Kinematik");
  });

  it("unwraps list-shaped inline code copied from rendered chat", () => {
    expect(
      normalizePastedMarkdown(
        "`- **Kraft gesucht:** Lager entfernen. - **Moment gesucht:** Gelenk einbauen.`"
      )
    ).toBe(
      "- **Kraft gesucht:** Lager entfernen.\n- **Moment gesucht:** Gelenk einbauen."
    );
  });

  it("unwraps a multiline list enclosed by inline-code backticks", () => {
    expect(
      normalizePastedMarkdown(
        "Intro\n\n`- **Kraft gesucht:** Lager entfernen.\n- **Moment gesucht:** Gelenk einbauen.`\n\nEnde"
      )
    ).toBe(
      "Intro\n\n- **Kraft gesucht:** Lager entfernen.\n- **Moment gesucht:** Gelenk einbauen.\n\nEnde"
    );
  });

  it("does not unwrap genuine inline code", () => {
    expect(normalizePastedMarkdown("Run `pnpm test` now.")).toBe(
      "Run `pnpm test` now."
    );
  });

  it("normalizes clipboard line endings and invisible characters", () => {
    expect(normalizePastedMarkdown("A\u00a0B\r\nC\u200bD")).toBe("A B\nCD");
  });
});
