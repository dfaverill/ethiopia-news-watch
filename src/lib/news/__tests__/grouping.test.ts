import { describe, expect, it } from "vitest";

import { buildLatestBySource, dedupeItems, groupStorylines } from "@/lib/news/grouping";
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

  it("does not group unrelated stories that only share broad topic language", () => {
    const enaItem = buildNormalizedItem({
      source: "ENA",
      title:
        "PM Abiy extends tenure of Tigray region interim chief administrator by one year",
      url: "https://example.com/ena-tigray",
      publishedAt: "2026-04-07T17:00:00.000Z",
      snippet:
        "Prime Minister Abiy Ahmed extended Lieutenant General Tadesse Worede's tenure as interim chief administrator for another year.",
      section: "Politics",
      language: "English",
      sourceType: "html",
    });
    const reporterItem = buildNormalizedItem({
      source: "The Reporter Ethiopia",
      title:
        "Election board to deploy team to assess security situations ahead of June election",
      url: "https://example.com/reporter-election",
      publishedAt: "2026-04-07T10:45:00.000Z",
      snippet:
        "The National Election Board of Ethiopia will deploy a team to assess security in polling station areas ahead of the June election.",
      section: "Election",
      language: "English",
      sourceType: "html",
    });
    const addisItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "Over 700 Eritreans cross into Tigray for holiday celebrations as federal government accuses Eritrea of meddling",
      url: "https://example.com/addis-eritreans",
      publishedAt: "2026-04-06T06:06:00.000Z",
      snippet:
        "Addis Standard reports that more than 700 Eritreans crossed into Tigray for holiday celebrations amid accusations of Eritrean meddling.",
      section: "Conflict",
      language: "English",
      sourceType: "search-fallback",
    });

    const storylines = groupStorylines(
      [enaItem, reporterItem, addisItem],
      [
        buildSourceResult("ENA", [enaItem]),
        buildSourceResult("The Reporter Ethiopia", [reporterItem]),
        buildSourceResult("Addis Standard", [addisItem]),
      ],
    );

    expect(storylines).toHaveLength(3);
    expect(storylines.every((storyline) => storyline.sources.length === 1)).toBe(true);
  });

  it("marks cached source rows as limited", () => {
    const item = buildNormalizedItem({
      source: "Addis Standard",
      title: "Ethiopia and Sudan border talks resume",
      url: "https://example.com/addis-standard",
      publishedAt: "2026-03-27T08:00:00.000Z",
      snippet: "Addis Standard reports on Ethiopia and Sudan border talks.",
      section: "Diplomacy",
      language: "English",
      sourceType: "search-fallback",
    });

    const storylines = groupStorylines(
      [item],
      [
        buildSourceResult("Addis Standard", [item], {
          status: "degraded",
          healthKind: "cached",
          usedCachedItems: true,
        }),
      ],
    );

    expect(storylines[0].sources[0].state).toBe("limited");
  });

  it("hides sources with no current-week items from latest-by-source output", () => {
    const item = buildNormalizedItem({
      source: "ENA",
      title: "Ethiopia and Sudan border talks resume",
      url: "https://example.com/ena-current",
      publishedAt: "2026-03-27T08:00:00.000Z",
      snippet: "ENA reports on Ethiopia and Sudan border talks.",
      section: "Diplomacy",
      language: "English",
      sourceType: "html",
    });

    const latestBySource = buildLatestBySource([
      buildSourceResult("ENA", [item]),
      buildSourceResult("VOA Amharic", []),
    ]);

    expect(latestBySource).toHaveLength(1);
    expect(latestBySource[0]?.source).toBe("ENA");
  });

  it("preserves original language metadata for translated feed rows", () => {
    const translatedItem = {
      ...buildNormalizedItem({
        source: "Addis Standard",
        title: "Election board update in English",
        url: "https://example.com/addis-english-display",
        publishedAt: "2026-03-27T08:00:00.000Z",
        snippet: "Translated feed copy for display.",
        section: "Election",
        language: "English",
        sourceType: "search-fallback",
      }),
      originalLanguage: "Afaan Oromoo" as const,
    };

    const storylines = groupStorylines(
      [translatedItem],
      [buildSourceResult("Addis Standard", [translatedItem])],
    );
    const latestBySource = buildLatestBySource([
      buildSourceResult("Addis Standard", [translatedItem]),
    ]);

    expect(storylines[0]?.sources[0]?.originalLanguage).toBe("Afaan Oromoo");
    expect(latestBySource[0]?.originalLanguage).toBe("Afaan Oromoo");
  });

  it("groups translated source rows with matching coverage from another outlet", () => {
    const translatedAddisItem = {
      ...buildNormalizedItem({
        source: "Addis Standard",
        title:
          "Election board warns coercion in voter registration could void the poll",
        url: "https://example.com/addis-translated-election",
        publishedAt: "2026-04-05T08:30:00.000Z",
        snippet:
          "A translated Addis Standard report says illegal coercion during voter registration could void the poll.",
        section: "Election",
        language: "English",
        sourceType: "search-fallback",
      }),
      originalLanguage: "Afaan Oromoo" as const,
    };
    const enaItem = buildNormalizedItem({
      source: "ENA",
      title:
        "Election board warns coercion in voter registration could void the poll",
      url: "https://example.com/ena-election-warning",
      publishedAt: "2026-04-05T08:00:00.000Z",
      snippet:
        "ENA says the election board warned that coercion in voter registration could lead to the poll being annulled.",
      section: "Election",
      language: "English",
      sourceType: "html",
    });

    const storylines = groupStorylines(
      [translatedAddisItem, enaItem],
      [
        buildSourceResult("Addis Standard", [translatedAddisItem]),
        buildSourceResult("ENA", [enaItem]),
      ],
    );

    expect(storylines).toHaveLength(1);
    expect(storylines[0]?.sources).toHaveLength(2);
    expect(
      storylines[0]?.sources.find((source) => source.source === "Addis Standard")
        ?.originalLanguage,
    ).toBe("Afaan Oromoo");
  });
});
