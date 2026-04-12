import { describe, expect, it } from "vitest";

import {
  buildCurrentWeekSourceOptions,
  EMPTY_DASHBOARD_PAYLOAD,
  normalizeDashboardFilters,
  normalizeDashboardPayload,
  type DashboardPayload,
} from "@/lib/dashboard";

function buildPayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    ...EMPTY_DASHBOARD_PAYLOAD,
    generatedAt: "2026-04-06T21:21:20.872Z",
    lastUpdated: "2026-04-06T00:00:00.000Z",
    latestPublication: {
      publishedAt: "2026-04-06T00:00:00.000Z",
      sources: ["ENA", "VOA Amharic"],
    },
    latestBySource: [
      {
        source: "ENA",
        headline: "Fresh ENA story",
        topic: "Politics",
        updatedAt: "2026-04-06T00:00:00.000Z",
        language: "English",
        status: "online",
        note: "Fresh item",
        url: "https://example.com/ena",
        healthKind: "healthy",
        usedCachedItems: false,
      },
      {
        source: "VOA Amharic",
        headline: "Old VOA story",
        topic: "Politics",
        updatedAt: "2026-03-14T00:00:00.000Z",
        language: "Amharic",
        status: "online",
        note: "Old item",
        url: "https://example.com/voa",
        healthKind: "healthy",
        usedCachedItems: false,
      },
    ],
    sourceStatus: [
      {
        source: "ENA",
        status: "online",
        healthKind: "healthy",
        healthLabel: "Healthy",
        checkedAt: "2026-04-06T21:21:20.872Z",
        lastSuccessfulAt: "2026-04-06T21:21:20.872Z",
        note: "Fresh item",
        coverageCount: 1,
        durationMs: 100,
        sourceType: "html",
        usedCachedItems: false,
      },
      {
        source: "VOA Amharic",
        status: "online",
        healthKind: "healthy",
        healthLabel: "Healthy",
        checkedAt: "2026-04-06T21:21:20.872Z",
        lastSuccessfulAt: "2026-04-06T21:21:20.872Z",
        note: "Old item",
        coverageCount: 1,
        durationMs: 100,
        sourceType: "rss",
        usedCachedItems: false,
      },
    ],
    storylines: [
      {
        id: "storyline-fresh",
        headline: "Fresh ENA storyline",
        summary: "Fresh summary",
        topics: ["Politics"],
        updatedAt: "2026-04-06T00:00:00.000Z",
        sources: [
          {
            source: "ENA",
            title: "Fresh ENA story",
            angle: "Fresh angle",
            language: "English",
            state: "covered",
            updatedAt: "2026-04-06T00:00:00.000Z",
            url: "https://example.com/ena",
            sourceType: "html",
            healthKind: "healthy",
            usedCachedItems: false,
          },
        ],
      },
      {
        id: "storyline-old",
        headline: "Old VOA storyline",
        summary: "Old summary",
        topics: ["Politics"],
        updatedAt: "2026-03-14T00:00:00.000Z",
        sources: [
          {
            source: "VOA Amharic",
            title: "Old VOA story",
            angle: "Old angle",
            language: "Amharic",
            state: "covered",
            updatedAt: "2026-03-14T00:00:00.000Z",
            url: "https://example.com/voa",
            sourceType: "rss",
            healthKind: "healthy",
            usedCachedItems: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("normalizeDashboardPayload", () => {
  it("keeps only sources and storylines from the last 7 days", () => {
    const normalized = normalizeDashboardPayload(buildPayload());

    expect(normalized.latestBySource.map((entry) => entry.source)).toEqual(["ENA"]);
    expect(normalized.sourceStatus.map((entry) => entry.source)).toEqual(["ENA"]);
    expect(normalized.storylines.map((storyline) => storyline.id)).toEqual([
      "storyline-fresh",
    ]);
  });
});

describe("buildCurrentWeekSourceOptions", () => {
  it("returns only all-sources plus sources with current-week coverage", () => {
    const normalized = normalizeDashboardPayload(buildPayload());

    expect(buildCurrentWeekSourceOptions(normalized)).toEqual([
      "All sources",
      "ENA",
    ]);
  });
});

describe("normalizeDashboardFilters", () => {
  it("falls back to newest when an old removed sort value is present", () => {
    const filters = normalizeDashboardFilters({
      sort: "widest",
    });

    expect(filters.sortBy).toBe("newest");
  });
});
