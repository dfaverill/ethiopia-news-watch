import type {
  CoverageRowState,
  DashboardDebugSourceEntry,
  DashboardStoryline,
  LatestSourceEntry,
  SourceStatusEntry,
  TopicName,
} from "@/lib/dashboard";
import { getHealthLabel } from "@/lib/news/sources/helpers";
import type { NormalizedNewsItem, SourceFetchResult } from "@/lib/news/types";
import { headlineSimilarity, firstSentence, truncate } from "@/lib/news/text";

const GROUPING_IGNORE_KEYWORDS = new Set([
  "ethiopia",
  "ethiopian",
  "addis",
  "addis ababa",
  "federal",
  "regional",
]);

function sharedKeywordCount(
  left: NormalizedNewsItem,
  right: NormalizedNewsItem,
): number {
  const leftKeywords = new Set(
    left.matchedKeywords.filter((keyword) => !GROUPING_IGNORE_KEYWORDS.has(keyword)),
  );

  return right.matchedKeywords.filter((keyword) => leftKeywords.has(keyword)).length;
}

function sharesTopic(left: NormalizedNewsItem, right: NormalizedNewsItem) {
  return left.topicTags.some((topic) => right.topicTags.includes(topic));
}

function isWithinDays(
  left: NormalizedNewsItem,
  right: NormalizedNewsItem,
  days: number,
) {
  const leftTime = new Date(left.publishedAt).getTime();
  const rightTime = new Date(right.publishedAt).getTime();

  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return false;
  }

  return Math.abs(leftTime - rightTime) <= days * 24 * 60 * 60 * 1000;
}

function shouldGroupItems(
  left: NormalizedNewsItem,
  right: NormalizedNewsItem,
): boolean {
  if (headlineSimilarity(left.title, right.title) >= 0.38) {
    return true;
  }

  if (!sharesTopic(left, right) || !isWithinDays(left, right, 21)) {
    return false;
  }

  const sharedKeywords = sharedKeywordCount(left, right);
  if (sharedKeywords >= 2) {
    return true;
  }

  const electionOrConflict =
    left.topicTags.includes("Election") ||
    right.topicTags.includes("Election") ||
    left.topicTags.includes("Conflict") ||
    right.topicTags.includes("Conflict");

  return electionOrConflict && sharedKeywords >= 1;
}

function getRowState(result: SourceFetchResult | undefined): CoverageRowState {
  if (!result) {
    return "limited";
  }

  if (result.usedCachedItems) {
    return "limited";
  }

  if (result.healthKind === "fallback") {
    return "watching";
  }

  return "covered";
}

export function dedupeItems(items: NormalizedNewsItem[]): NormalizedNewsItem[] {
  const seen = new Map<string, NormalizedNewsItem>();

  items.forEach((item) => {
    const key = `${item.source}|${item.url ?? ""}|${item.title.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || existing.relevanceScore < item.relevanceScore) {
      seen.set(key, item);
    }
  });

  return [...seen.values()].sort(
    (left, right) =>
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  );
}

function summarizeGroup(items: NormalizedNewsItem[]): string {
  const snippets = items
    .map((item) => item.snippet)
    .filter(Boolean)
    .map((snippet) => firstSentence(snippet));

  if (snippets.length > 0) {
    return truncate(snippets[0], 220);
  }

  const topics = [...new Set(items.flatMap((item) => item.topicTags))];
  return `Coverage from ${items.length} sources centering on ${topics
    .slice(0, 3)
    .join(", ")
    .toLowerCase()}.`;
}

function pickTopics(items: NormalizedNewsItem[]): TopicName[] {
  const topicCount = new Map<TopicName, number>();
  items.forEach((item) => {
    item.topicTags.forEach((topic) => {
      topicCount.set(topic, (topicCount.get(topic) ?? 0) + 1);
    });
  });

  return [...topicCount.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([topic]) => topic)
    .slice(0, 3);
}

export function groupStorylines(
  items: NormalizedNewsItem[],
  sourceResults: SourceFetchResult[],
): DashboardStoryline[] {
  const sourceResultMap = new Map(
    sourceResults.map((result) => [result.source, result]),
  );
  const groups: NormalizedNewsItem[][] = [];

  items.forEach((item) => {
    const group = groups.find((candidate) =>
      candidate.some((groupItem) => shouldGroupItems(groupItem, item)),
    );

    if (group) {
      group.push(item);
      return;
    }

    groups.push([item]);
  });

  return groups
    .map((itemsInGroup) => {
      const sorted = [...itemsInGroup].sort((left, right) => {
        if (right.relevanceScore !== left.relevanceScore) {
          return right.relevanceScore - left.relevanceScore;
        }

        return (
          new Date(right.publishedAt).getTime() -
          new Date(left.publishedAt).getTime()
        );
      });

      const main = sorted[0];
      const perSource = new Map<string, NormalizedNewsItem>();
      sorted.forEach((item) => {
        const existing = perSource.get(item.source);
        if (!existing || existing.relevanceScore < item.relevanceScore) {
          perSource.set(item.source, item);
        }
      });

      const rows = [...perSource.values()].sort(
        (left, right) =>
          new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
      );

      return {
        id: `storyline-${main.id}`,
        headline: main.title,
        summary: summarizeGroup(rows),
        topics: pickTopics(rows),
        updatedAt: rows[0]?.publishedAt ?? main.publishedAt,
        sources: rows.map((item) => {
          const sourceResult = sourceResultMap.get(item.source);

          return {
            source: item.source,
            title: item.title,
            angle: truncate(item.snippet || item.title, 220),
            language: item.language,
            state: getRowState(sourceResult),
            updatedAt: item.publishedAt,
            url: item.url,
            sourceType: item.sourceType,
            healthKind: sourceResult?.healthKind ?? "failed",
            usedCachedItems: sourceResult?.usedCachedItems ?? false,
          };
        }),
      };
    })
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

export function buildLatestBySource(
  sourceResults: SourceFetchResult[],
): LatestSourceEntry[] {
  return sourceResults.map((result) => {
    const latest = [...result.items].sort(
      (left, right) =>
        new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
    )[0];

    return {
      source: result.source,
      headline: latest?.title ?? "Coverage unavailable during the latest refresh.",
      topic: latest?.topicTags[0] ?? "Politics",
      updatedAt: latest?.publishedAt ?? result.attemptedAt,
      language:
        latest?.language ?? (result.source === "VOA Amharic" ? "Amharic" : "English"),
      status: result.status,
      note: latest?.snippet
        ? truncate(firstSentence(latest.snippet), 180)
        : result.note,
      url: latest?.url ?? null,
      healthKind: result.healthKind,
      usedCachedItems: result.usedCachedItems,
    };
  });
}

export function buildSourceStatuses(
  sourceResults: SourceFetchResult[],
): SourceStatusEntry[] {
  return sourceResults.map((result) => ({
    source: result.source,
    status: result.status,
    healthKind: result.healthKind,
    healthLabel: getHealthLabel(result.healthKind),
    checkedAt: result.attemptedAt,
    lastSuccessfulAt: result.lastSuccessfulAt,
    note: result.note,
    coverageCount: result.items.length,
    durationMs: result.durationMs,
    sourceType: result.sourceType,
    usedCachedItems: result.usedCachedItems,
  }));
}

export function buildSourceDebugSummaries(
  sourceResults: SourceFetchResult[],
): DashboardDebugSourceEntry[] {
  return sourceResults.map((result) => ({
    source: result.source,
    status: result.status,
    healthKind: result.healthKind,
    sourceType: result.sourceType,
    rawCount: result.metrics.rawCount,
    relevantCount: result.metrics.relevantCount,
    keptCount: result.metrics.keptCount,
    filteredOutCount: result.metrics.filteredOutCount,
    durationMs: result.durationMs,
    diagnostics: result.diagnostics,
    usedCachedItems: result.usedCachedItems,
  }));
}
