import {
  TOPIC_NAMES,
  type DashboardStoryline,
  type SourceFilter,
  type SortValue,
  type TopicFilter,
  type TopicName,
} from "@/lib/dashboard";

function getStorylineTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function buildStorylineSearchText(storyline: DashboardStoryline) {
  return `${storyline.headline} ${storyline.summary} ${storyline.sources
    .map((source) => `${source.source} ${source.title} ${source.angle}`)
    .join(" ")}`
    .toLowerCase();
}

export function sortDashboardStorylines(
  storylines: DashboardStoryline[],
  sortBy: SortValue,
) {
  const next = [...storylines];

  if (sortBy === "oldest") {
    return next.sort(
      (left, right) =>
        getStorylineTimestamp(left.updatedAt) -
        getStorylineTimestamp(right.updatedAt),
    );
  }

  return next.sort(
    (left, right) =>
      getStorylineTimestamp(right.updatedAt) -
      getStorylineTimestamp(left.updatedAt),
  );
}

export function filterStorylinesBySearchAndSource(
  storylines: DashboardStoryline[],
  searchQuery: string,
  selectedSource: SourceFilter,
) {
  const normalizedSearch = searchQuery.trim().toLowerCase();

  return storylines.filter((storyline) => {
    const matchesSearch =
      normalizedSearch.length === 0 ||
      buildStorylineSearchText(storyline).includes(normalizedSearch);

    const matchesSource =
      selectedSource === "All sources" ||
      storyline.sources.some((source) => source.source === selectedSource);

    return matchesSearch && matchesSource;
  });
}

export function applySelectedSourceToStorylines(
  storylines: DashboardStoryline[],
  selectedSource: SourceFilter,
) {
  if (selectedSource === "All sources") {
    return storylines;
  }

  return storylines
    .map((storyline) => ({
      ...storyline,
      sources: storyline.sources.filter((source) => source.source === selectedSource),
    }))
    .filter((storyline) => storyline.sources.length > 0);
}

export function filterStorylinesByTopic(
  storylines: DashboardStoryline[],
  selectedTopic: TopicFilter,
) {
  if (selectedTopic === "All topics") {
    return storylines;
  }

  return storylines.filter((storyline) => storyline.topics.includes(selectedTopic));
}

export interface TopicCoverageSummary {
  topic: TopicName;
  count: number;
  latestUpdatedAt: string | null;
  leadStoryline: DashboardStoryline | null;
}

export function buildTopicCoverageSummaries(
  storylines: DashboardStoryline[],
): TopicCoverageSummary[] {
  return TOPIC_NAMES.map((topic) => {
    const matchingStorylines = sortDashboardStorylines(
      storylines.filter((storyline) => storyline.topics.includes(topic)),
      "newest",
    );

    return {
      topic,
      count: matchingStorylines.length,
      latestUpdatedAt: matchingStorylines[0]?.updatedAt ?? null,
      leadStoryline: matchingStorylines[0] ?? null,
    };
  });
}
