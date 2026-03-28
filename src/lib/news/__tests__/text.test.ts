import { describe, expect, it } from "vitest";

import {
  extractEnglishDate,
  firstSentence,
  headlineSimilarity,
  sanitizeHttpUrl,
  stripHtml,
} from "@/lib/news/text";

describe("text helpers", () => {
  it("cleans html and mojibake-like strings", () => {
    const cleaned = stripHtml(
      "<p>Ethiopiaâ€™s parliament &amp; cabinet&nbsp;met in Addis Ababa.</p>",
    );

    expect(cleaned).toBe("Ethiopia's parliament & cabinet met in Addis Ababa.");
  });

  it("extracts the first sentence safely", () => {
    expect(firstSentence("First sentence. Second sentence.")).toBe("First sentence.");
  });

  it("finds similarity between related headlines", () => {
    const similarity = headlineSimilarity(
      "NEBE launches first election debate",
      "NEBE launches election debate platform",
    );

    expect(similarity).toBeGreaterThan(0.3);
  });

  it("parses English dates from snippets", () => {
    expect(extractEnglishDate("Addis Ababa, March 27, 2026 (ENA)")).toBe(
      "2026-03-27T00:00:00.000Z",
    );
  });

  it("allows only safe http and https urls", () => {
    expect(sanitizeHttpUrl("https://example.com/story#tracking")).toBe(
      "https://example.com/story",
    );
    expect(sanitizeHttpUrl("javascript:alert(1)")).toBeNull();
  });
});
