import { describe, expect, it } from "vitest";

import { buildNormalizedItem, selectRelevantItems } from "@/lib/news/sources/helpers";

describe("source normalization helpers", () => {
  it("normalizes an item and preserves minimal metadata only", () => {
    const item = buildNormalizedItem({
      source: "The Reporter Ethiopia",
      title: "<strong>Tigray admin alleges forced evictions continue</strong>",
      url: "https://example.com/story?utm_source=test",
      publishedAt: "2026-03-21T07:39:30.000Z",
      snippet:
        "The Tigray Communication Affairs Bureau accused federal authorities of illegal evictions in disputed territories.",
      section: "Politics",
      language: "English",
      sourceType: "rss",
    });

    expect(item.title).toBe("Tigray admin alleges forced evictions continue");
    expect(item.url).toBe("https://example.com/story");
    expect(item.topicTags).toEqual(expect.arrayContaining(["Politics", "Conflict"]));
  });

  it("keeps only relevant items when selecting source coverage", () => {
    const relevant = buildNormalizedItem({
      source: "Addis Standard",
      title: "Leaders of Djibouti, Ethiopia, Somalia hold tripartite talks",
      url: "https://example.com/relevant",
      publishedAt: "2026-03-12T07:00:00.000Z",
      snippet: "Regional peace and security talks involving Ethiopia.",
      section: "Diplomacy",
      language: "English",
      sourceType: "search-fallback",
    });
    const irrelevant = buildNormalizedItem({
      source: "Addis Standard",
      title: "Culture review of a regional art exhibition",
      url: "https://example.com/irrelevant",
      publishedAt: "2026-03-12T07:00:00.000Z",
      snippet: "A feature on artists and galleries.",
      section: "Culture",
      language: "English",
      sourceType: "search-fallback",
    });

    const selection = selectRelevantItems("Addis Standard", [relevant, irrelevant]);

    expect(selection.items).toHaveLength(1);
    expect(selection.metrics.filteredOutCount).toBe(1);
  });

  it("drops unsafe publisher urls from normalized items", () => {
    const item = buildNormalizedItem({
      source: "Reuters",
      title: "Ethiopia cabinet discusses election readiness",
      url: "javascript:alert('xss')",
      publishedAt: "2026-03-21T07:39:30.000Z",
      snippet: "Officials discussed Ethiopia election readiness in Addis Ababa.",
      section: "Politics",
      language: "English",
      sourceType: "rss",
    });

    expect(item.url).toBeNull();
  });
});
