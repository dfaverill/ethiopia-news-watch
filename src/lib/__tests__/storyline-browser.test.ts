import { describe, expect, it } from "vitest";

import type { DashboardStoryline, StorylineSourceRow } from "@/lib/dashboard";
import {
  applySelectedSourceToStorylines,
  buildTopicCoverageSummaries,
  filterStorylinesBySearchAndSource,
  filterStorylinesByTopic,
  sortDashboardStorylines,
} from "@/lib/storyline-browser";

function createSourceRow(
  source: StorylineSourceRow["source"],
  overrides?: Partial<StorylineSourceRow>,
): StorylineSourceRow {
  return {
    source,
    title: `${source} headline`,
    angle: `${source} angle`,
    language: "English",
    state: "covered",
    updatedAt: "2026-04-06T09:00:00.000Z",
    url: `https://example.com/${source.toLowerCase().replace(/\s+/g, "-")}`,
    sourceType: "rss",
    healthKind: "healthy",
    usedCachedItems: false,
    ...overrides,
  };
}

function createStoryline(
  id: string,
  overrides?: Partial<DashboardStoryline>,
): DashboardStoryline {
  return {
    id,
    headline: `${id} headline`,
    summary: `${id} summary`,
    topics: ["Politics"],
    updatedAt: "2026-04-06T09:00:00.000Z",
    sources: [createSourceRow("Addis Standard")],
    ...overrides,
  };
}

describe("storyline browser helpers", () => {
  it("sorts newest storylines first for breaking coverage", () => {
    const sorted = sortDashboardStorylines(
      [
        createStoryline("older", {
          updatedAt: "2026-04-05T09:00:00.000Z",
        }),
        createStoryline("newer", {
          updatedAt: "2026-04-06T09:00:00.000Z",
        }),
      ],
      "newest",
    );

    expect(sorted.map((storyline) => storyline.id)).toEqual(["newer", "older"]);
  });

  it("sorts oldest storylines first when oldest feed order is selected", () => {
    const sorted = sortDashboardStorylines(
      [
        createStoryline("newer", {
          updatedAt: "2026-04-06T09:00:00.000Z",
        }),
        createStoryline("older", {
          updatedAt: "2026-04-05T09:00:00.000Z",
        }),
      ],
      "oldest",
    );

    expect(sorted.map((storyline) => storyline.id)).toEqual(["older", "newer"]);
  });

  it("filters storylines by search text and selected source", () => {
    const filtered = filterStorylinesBySearchAndSource(
      [
        createStoryline("election", {
          headline: "Election board issues update",
          sources: [createSourceRow("NEBE")],
        }),
        createStoryline("economy", {
          headline: "Economy ministry publishes forecast",
          sources: [createSourceRow("ENA")],
        }),
      ],
      "board",
      "NEBE",
    );

    expect(filtered.map((storyline) => storyline.id)).toEqual(["election"]);
  });

  it("filters storylines by topic when a specific category is selected", () => {
    const filtered = filterStorylinesByTopic(
      [
        createStoryline("politics", { topics: ["Politics"] }),
        createStoryline("economy", { topics: ["Economy"] }),
      ],
      "Economy",
    );

    expect(filtered.map((storyline) => storyline.id)).toEqual(["economy"]);
  });

  it("narrows visible storyline sources to the selected source", () => {
    const narrowed = applySelectedSourceToStorylines(
      [
        createStoryline("shared", {
          sources: [createSourceRow("Addis Standard"), createSourceRow("ENA")],
        }),
      ],
      "ENA",
    );

    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]?.sources.map((source) => source.source)).toEqual(["ENA"]);
  });

  it("builds topic summaries with the latest storyline in each category", () => {
    const summaries = buildTopicCoverageSummaries([
      createStoryline("older-politics", {
        topics: ["Politics"],
        updatedAt: "2026-04-05T09:00:00.000Z",
      }),
      createStoryline("newer-politics", {
        topics: ["Politics"],
        updatedAt: "2026-04-06T09:00:00.000Z",
      }),
      createStoryline("economy", {
        topics: ["Economy"],
        updatedAt: "2026-04-04T09:00:00.000Z",
      }),
    ]);

    const politics = summaries.find((summary) => summary.topic === "Politics");
    const economy = summaries.find((summary) => summary.topic === "Economy");

    expect(politics?.count).toBe(2);
    expect(politics?.leadStoryline?.id).toBe("newer-politics");
    expect(economy?.count).toBe(1);
    expect(economy?.leadStoryline?.id).toBe("economy");
  });
});
