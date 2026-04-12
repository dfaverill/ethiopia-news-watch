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
import {
  firstSentence,
  headlineSimilarity,
  tokenizeHeadline,
  truncate,
} from "@/lib/news/text";

const GROUPING_GENERIC_TOKENS = new Set([
  "ethiopia",
  "ethiopian",
  "addis",
  "ababa",
  "federal",
  "government",
  "regional",
  "reports",
  "report",
  "news",
  "says",
  "analysis",
  "update",
]);

interface GroupingComparableItem {
  combinedText: string;
  bodyTokens: Set<string>;
  numberTokens: Set<string>;
  titleTokens: Set<string>;
}

interface GroupingDecision {
  matches: boolean;
  highConfidence: boolean;
  score: number;
}

function sharedSetCount<T>(left: Set<T>, right: Set<T>) {
  let count = 0;

  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }

  return count;
}

function tokenizeStoryText(value: string) {
  return new Set(
    tokenizeHeadline(value).filter((token) => !GROUPING_GENERIC_TOKENS.has(token)),
  );
}

function extractNumberTokens(value: string) {
  return new Set(
    [...value.matchAll(/\b\d[\d,.]*\b/g)]
      .map((match) => match[0].replace(/[,.]/g, ""))
      .filter((token) => token.length > 0),
  );
}

function buildGroupingComparableItem(
  item: NormalizedNewsItem,
): GroupingComparableItem {
  const combinedText = `${item.title} ${item.snippet}`.trim();

  return {
    combinedText,
    titleTokens: tokenizeStoryText(item.title),
    bodyTokens: tokenizeStoryText(item.snippet),
    numberTokens: extractNumberTokens(combinedText.toLowerCase()),
  };
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
) {
  const titleSimilarity = headlineSimilarity(left.title, right.title);
  const leftComparable = buildGroupingComparableItem(left);
  const rightComparable = buildGroupingComparableItem(right);
  const combinedSimilarity = headlineSimilarity(
    leftComparable.combinedText,
    rightComparable.combinedText,
  );
  const sharedTitleTokenCount = sharedSetCount(
    leftComparable.titleTokens,
    rightComparable.titleTokens,
  );
  const sharedBodyTokenCount = sharedSetCount(
    leftComparable.bodyTokens,
    rightComparable.bodyTokens,
  );
  const sharedNumberCount = sharedSetCount(
    leftComparable.numberTokens,
    rightComparable.numberTokens,
  );
  const withinWindow = isWithinDays(left, right, 7);
  const topicAligned = sharesTopic(left, right);
  const strongTitleMatch = titleSimilarity >= 0.58;
  const titleLedStoryMatch =
    titleSimilarity >= 0.3 &&
    sharedTitleTokenCount >= 3 &&
    combinedSimilarity >= 0.15;
  const corroboratedTitleMatch =
    titleSimilarity >= 0.32 &&
    sharedTitleTokenCount >= 3 &&
    (
      combinedSimilarity >= 0.26 ||
      sharedBodyTokenCount >= 2 ||
      sharedNumberCount >= 1
    );
  const bodySupportedStoryMatch =
    combinedSimilarity >= 0.44 &&
    sharedTitleTokenCount >= 2 &&
    sharedBodyTokenCount >= 3;
  const entityStyleMatch =
    sharedTitleTokenCount >= 4 &&
    (sharedBodyTokenCount >= 2 || sharedNumberCount >= 1);

  const matches =
    strongTitleMatch ||
    (topicAligned &&
      withinWindow &&
      (
        titleLedStoryMatch ||
        corroboratedTitleMatch ||
        bodySupportedStoryMatch ||
        entityStyleMatch
      ));

  const highConfidence =
    strongTitleMatch ||
    (topicAligned &&
      withinWindow &&
      (
        (titleSimilarity >= 0.46 &&
          combinedSimilarity >= 0.28 &&
          (sharedTitleTokenCount >= 3 || sharedNumberCount >= 1)) ||
        (combinedSimilarity >= 0.5 &&
          sharedTitleTokenCount >= 2 &&
          sharedBodyTokenCount >= 3)
      ));

  return {
    matches,
    highConfidence,
    score:
      titleSimilarity * 1.8 +
      combinedSimilarity * 1.2 +
      sharedTitleTokenCount * 0.12 +
      sharedBodyTokenCount * 0.07 +
      sharedNumberCount * 0.16,
  } satisfies GroupingDecision;
}

function sortItemsForGrouping(items: NormalizedNewsItem[]) {
  return [...items].sort((left, right) => {
    if (right.relevanceScore !== left.relevanceScore) {
      return right.relevanceScore - left.relevanceScore;
    }

    return (
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
    );
  });
}

function getGroupRepresentative(items: NormalizedNewsItem[]) {
  return sortItemsForGrouping(items)[0];
}

function getUniqueSourceCount(items: NormalizedNewsItem[]) {
  return new Set(items.map((item) => item.source)).size;
}

function sharesGroupTopic(
  leftGroup: NormalizedNewsItem[],
  rightGroup: NormalizedNewsItem[],
) {
  return leftGroup.some((leftItem) =>
    rightGroup.some((rightItem) => sharesTopic(leftItem, rightItem)),
  );
}

function isGroupWithinDays(
  leftGroup: NormalizedNewsItem[],
  rightGroup: NormalizedNewsItem[],
  days: number,
) {
  const leftLead = getGroupRepresentative(leftGroup);
  const rightLead = getGroupRepresentative(rightGroup);

  return isWithinDays(leftLead, rightLead, days);
}

function findBestMatchingGroup(
  groups: NormalizedNewsItem[][],
  item: NormalizedNewsItem,
) {
  let bestMatch:
    | {
        index: number;
        score: number;
      }
    | null = null;

  groups.forEach((candidate, index) => {
    const lead = getGroupRepresentative(candidate);
    const leadDecision = shouldGroupItems(lead, item);

    if (!leadDecision.matches) {
      return;
    }

    if (candidate.length > 1 && !leadDecision.highConfidence) {
      const supportingMatches = candidate
        .slice(1)
        .filter((groupItem) => shouldGroupItems(groupItem, item).matches).length;

      if (supportingMatches === 0) {
        return;
      }
    }

    if (!bestMatch || leadDecision.score > bestMatch.score) {
      bestMatch = {
        index,
        score: leadDecision.score,
      };
    }
  });

  return bestMatch?.index ?? -1;
}

function mergeStandaloneGroupsIntoComparisons(groups: NormalizedNewsItem[][]) {
  const comparisonGroups = groups
    .filter((group) => getUniqueSourceCount(group) > 1)
    .map((group) => [...group]);
  const remainingGroups = groups
    .filter((group) => getUniqueSourceCount(group) <= 1)
    .map((group) => [...group]);
  const survivors: NormalizedNewsItem[][] = [];

  for (const standaloneGroup of remainingGroups) {
    const lead = getGroupRepresentative(standaloneGroup);
    let bestTargetIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    comparisonGroups.forEach((comparisonGroup, index) => {
      if (
        !sharesGroupTopic(standaloneGroup, comparisonGroup) ||
        !isGroupWithinDays(standaloneGroup, comparisonGroup, 7)
      ) {
        return;
      }

      const comparisonLead = getGroupRepresentative(comparisonGroup);
      const decision = shouldGroupItems(comparisonLead, lead);

      if (!decision.highConfidence) {
        return;
      }

      if (decision.score > bestScore) {
        bestTargetIndex = index;
        bestScore = decision.score;
      }
    });

    if (bestTargetIndex === -1) {
      survivors.push(standaloneGroup);
      continue;
    }

    comparisonGroups[bestTargetIndex].push(...standaloneGroup);
  }

  return [...comparisonGroups, ...survivors];
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

  sortItemsForGrouping(items).forEach((item) => {
    const matchingGroupIndex = findBestMatchingGroup(groups, item);

    if (matchingGroupIndex !== -1) {
      groups[matchingGroupIndex].push(item);
      return;
    }

    groups.push([item]);
  });

  return mergeStandaloneGroupsIntoComparisons(groups)
    .map((itemsInGroup) => {
      const sorted = sortItemsForGrouping(itemsInGroup);

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
            originalLanguage: item.originalLanguage ?? null,
            state: getRowState(sourceResult),
            updatedAt: item.publishedAt,
            url: item.url,
            imageUrl: item.imageUrl ?? null,
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
  return sourceResults
    .filter((result) => result.items.length > 0)
    .map((result) => {
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
      originalLanguage: latest?.originalLanguage ?? null,
      status: result.status,
      note: latest?.snippet
        ? truncate(firstSentence(latest.snippet), 180)
        : result.note,
      url: latest?.url ?? null,
      imageUrl: latest?.imageUrl ?? null,
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
