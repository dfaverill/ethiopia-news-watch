import { describe, expect, it } from "vitest";

import {
  buildNormalizedItem,
  selectRelevantItems,
  withCachedSourceResult,
} from "@/lib/news/sources/helpers";
import type { SourceFetchResult } from "@/lib/news/types";

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

    const selection = selectRelevantItems(
      "Addis Standard",
      [relevant, irrelevant],
      "2026-03-12T12:00:00.000Z",
    );

    expect(selection.items).toHaveLength(1);
    expect(selection.metrics.filteredOutCount).toBe(1);
  });

  it("drops items older than the last 7 days", () => {
    const recent = buildNormalizedItem({
      source: "ENA",
      title: "Ethiopia cabinet discusses election readiness",
      url: "https://example.com/recent",
      publishedAt: "2026-03-20T07:39:30.000Z",
      snippet: "Officials discussed Ethiopia election readiness in Addis Ababa.",
      section: "Politics",
      language: "English",
      sourceType: "rss",
    });
    const stale = buildNormalizedItem({
      source: "ENA",
      title: "Older Ethiopia election planning story",
      url: "https://example.com/stale",
      publishedAt: "2026-03-10T07:39:30.000Z",
      snippet: "Older Ethiopia election planning coverage.",
      section: "Politics",
      language: "English",
      sourceType: "rss",
    });

    const selection = selectRelevantItems(
      "ENA",
      [recent, stale],
      "2026-03-21T12:00:00.000Z",
    );

    expect(selection.items).toHaveLength(1);
    expect(selection.items[0]?.title).toBe(recent.title);
  });

  it("drops unsafe publisher urls from normalized items", () => {
    const item = buildNormalizedItem({
      source: "ENA",
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

  it("does not reuse cached items that are older than the last 7 days", () => {
    const staleItem = buildNormalizedItem({
      source: "VOA Amharic",
      title: "Older Tigray talks update",
      url: "https://example.com/old-cache",
      publishedAt: "2026-03-10T07:39:30.000Z",
      snippet: "Older cached Ethiopia coverage.",
      section: "Politics",
      language: "Amharic",
      sourceType: "rss",
    });
    const staleResult: SourceFetchResult = {
      source: "VOA Amharic",
      items: [staleItem],
      status: "online",
      healthKind: "healthy",
      note: "ok",
      sourceType: "rss",
      attemptedAt: "2026-03-10T12:00:00.000Z",
      lastSuccessfulAt: "2026-03-10T12:00:00.000Z",
      durationMs: 120,
      usedCachedItems: false,
      cacheSource: null,
      diagnostics: [],
      metrics: {
        rawCount: 1,
        relevantCount: 1,
        keptCount: 1,
        filteredOutCount: 0,
      },
    };
    const failure: SourceFetchResult = {
      source: "VOA Amharic",
      items: [],
      status: "failed",
      healthKind: "timed-out",
      note: "VOA Amharic timed out during the latest refresh.",
      sourceType: "rss",
      attemptedAt: "2026-03-21T12:00:00.000Z",
      lastSuccessfulAt: null,
      durationMs: 120,
      usedCachedItems: false,
      cacheSource: null,
      diagnostics: ["timeout"],
      metrics: {
        rawCount: 0,
        relevantCount: 0,
        keptCount: 0,
        filteredOutCount: 0,
      },
    };

    const result = withCachedSourceResult(
      staleResult,
      "2026-03-21T12:00:00.000Z",
      failure,
    );

    expect(result.items).toHaveLength(0);
    expect(result.status).toBe("failed");
    expect(result.note).toContain("older than 7 days");
  });
});
