import { describe, expect, it } from "vitest";

import { dedupeItems, groupStorylines } from "@/lib/news/grouping";
import type { SourceFetchResult } from "@/lib/news/types";
import { buildNormalizedItem } from "@/lib/news/sources/helpers";

function buildSourceResult(
  source: SourceFetchResult["source"],
  items: SourceFetchResult["items"],
  overrides: Partial<SourceFetchResult> = {},
): SourceFetchResult {
  return {
    source,
    items,
    status: "online",
    healthKind: "healthy",
    note: "ok",
    sourceType: "rss",
    attemptedAt: "2026-03-27T10:00:00.000Z",
    lastSuccessfulAt: "2026-03-27T10:00:00.000Z",
    durationMs: 120,
    usedCachedItems: false,
    cacheSource: null,
    diagnostics: [],
    metrics: {
      rawCount: items.length,
      relevantCount: items.length,
      keptCount: items.length,
      filteredOutCount: 0,
    },
    ...overrides,
  };
}

describe("grouping", () => {
  it("dedupes duplicate items from the same source", () => {
    const first = buildNormalizedItem({
      source: "ENA",
      title: "NEBE launches election debate",
      url: "https://example.com/a",
      publishedAt: "2026-03-27T07:00:00.000Z",
      snippet: "Addis Ababa election debate",
      section: "Election",
      language: "English",
      sourceType: "html",
    });
    const duplicate = { ...first, relevanceScore: first.relevanceScore + 2 };

    const deduped = dedupeItems([first, duplicate]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].relevanceScore).toBe(duplicate.relevanceScore);
  });

  it("groups related election stories across sources", () => {
    const enaItem = buildNormalizedItem({
      source: "ENA",
      title: "NEBE launches first-ever election debate",
      url: "https://example.com/ena",
      publishedAt: "2026-03-27T07:00:00.000Z",
      snippet:
        "Addis Ababa, March 27, 2026. NEBE and ENA launched an election debate platform for political parties.",
      section: "Election",
      language: "English",
      sourceType: "html",
    });
    const nebeItem = buildNormalizedItem({
      source: "NEBE",
      title: "NEBE election debate platform opens for political parties",
      url: "https://example.com/nebe",
      publishedAt: "2026-03-27T08:00:00.000Z",
      snippet:
        "The National Election Board opened a debate platform ahead of the 7th general election.",
      section: "Election",
      language: "English",
      sourceType: "html",
    });

    const sourceResults = [
      buildSourceResult("ENA", [enaItem]),
      buildSourceResult("NEBE", [nebeItem]),
    ];

    const storylines = groupStorylines([enaItem, nebeItem], sourceResults);

    expect(storylines).toHaveLength(1);
    expect(storylines[0].sources).toHaveLength(2);
  });

  it("marks cached source rows as limited", () => {
    const item = buildNormalizedItem({
      source: "Reuters",
      title: "Ethiopia and Sudan border talks resume",
      url: "https://example.com/reuters",
      publishedAt: "2026-03-27T08:00:00.000Z",
      snippet: "Reuters reports on Ethiopia and Sudan border talks.",
      section: "Diplomacy",
      language: "English",
      sourceType: "search-fallback",
    });

    const storylines = groupStorylines(
      [item],
      [
        buildSourceResult("Reuters", [item], {
          status: "degraded",
          healthKind: "cached",
          usedCachedItems: true,
        }),
      ],
    );

    expect(storylines[0].sources[0].state).toBe("limited");
  });
});
