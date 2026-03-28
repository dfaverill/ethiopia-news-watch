import Parser from "rss-parser";

import type {
  CacheSource,
  LanguageLabel,
  SourceHealthKind,
  SourceName,
} from "@/lib/dashboard";
import { MAX_ITEMS_PER_SOURCE } from "@/lib/news/constants";
import {
  FetchHttpError,
  FetchNetworkError,
  FetchTimeoutError,
} from "@/lib/news/http";
import { explainRelevanceDecision, isRelevantItem } from "@/lib/news/relevance";
import type {
  NormalizedNewsItem,
  SourceFetchMetrics,
  SourceFetchResult,
  SourceSurfaceType,
} from "@/lib/news/types";
import {
  buildStableId,
  firstSentence,
  removeTrackingParams,
  sanitizeHttpUrl,
  stripHtml,
  truncate,
} from "@/lib/news/text";

const parser = new Parser();

interface BaseItemInput {
  source: SourceName;
  title: string;
  url: string;
  publishedAt: string;
  snippet: string;
  section: string;
  language: LanguageLabel;
  sourceType: SourceSurfaceType;
}

interface FinalizeSourceResultInput {
  source: SourceName;
  sourceType: SourceSurfaceType;
  normalizedItems: NormalizedNewsItem[];
  attemptedAt: string;
  durationMs: number;
  successNote: string;
  emptyNote: string;
  diagnostics?: string[];
  healthKind?: SourceHealthKind;
  usedCachedItems?: boolean;
  cacheSource?: CacheSource | null;
  limit?: number;
}

interface SourceFailureInput {
  source: SourceName;
  sourceType: SourceSurfaceType;
  attemptedAt: string;
  durationMs: number;
  error: unknown;
  fallbackNote?: string;
}

export function buildNormalizedItem(input: BaseItemInput): NormalizedNewsItem {
  const cleanedTitle = stripHtml(input.title);
  const cleanedSnippet = truncate(firstSentence(input.snippet || cleanedTitle), 220);
  const cleanedUrl = sanitizeHttpUrl(removeTrackingParams(input.url));
  const { matchedKeywords, topicTags, score } = explainRelevanceDecision(
    input.source,
    cleanedTitle,
    cleanedSnippet,
  );

  return {
    id: buildStableId([input.source, cleanedTitle, cleanedUrl ?? ""]),
    source: input.source,
    title: cleanedTitle,
    url: cleanedUrl,
    publishedAt: input.publishedAt,
    snippet: cleanedSnippet,
    section: input.section,
    language: input.language,
    sourceType: input.sourceType,
    matchedKeywords,
    topicTags,
    relevanceScore: score,
  };
}

function buildMetrics(
  rawCount: number,
  relevantCount: number,
  keptCount: number,
): SourceFetchMetrics {
  return {
    rawCount,
    relevantCount,
    keptCount,
    filteredOutCount: Math.max(rawCount - keptCount, 0),
  };
}

export function selectRelevantItems(
  source: SourceName,
  normalizedItems: NormalizedNewsItem[],
  limit = MAX_ITEMS_PER_SOURCE,
) {
  const relevantItems = normalizedItems.filter(isRelevantItem);
  const keptItems = relevantItems.slice(0, limit);
  const filteredExamples = normalizedItems
    .filter((item) => !isRelevantItem(item))
    .slice(0, 3)
    .map((item) => {
      const explanation = explainRelevanceDecision(
        source,
        item.title,
        item.snippet,
      );

      return `"${truncate(item.title, 70)}" (score ${explanation.score})`;
    });

  const diagnostics = [
    `Normalized ${normalizedItems.length} candidate items.`,
    `Kept ${keptItems.length} relevant items after filtering.`,
  ];

  if (filteredExamples.length > 0) {
    diagnostics.push(`Filtered examples: ${filteredExamples.join("; ")}`);
  }

  return {
    items: keptItems,
    metrics: buildMetrics(
      normalizedItems.length,
      relevantItems.length,
      keptItems.length,
    ),
    diagnostics,
  };
}

export function finalizeSourceResult({
  source,
  sourceType,
  normalizedItems,
  attemptedAt,
  durationMs,
  successNote,
  emptyNote,
  diagnostics = [],
  healthKind = "healthy",
  usedCachedItems = false,
  cacheSource = null,
  limit = MAX_ITEMS_PER_SOURCE,
}: FinalizeSourceResultInput): SourceFetchResult {
  const relevantSelection = selectRelevantItems(source, normalizedItems, limit);
  const noMatches = relevantSelection.items.length === 0;

  return {
    source,
    items: relevantSelection.items,
    status:
      noMatches
        ? "degraded"
        : healthKind === "healthy"
          ? "online"
          : "degraded",
    healthKind: noMatches ? "no-matches" : healthKind,
    note: noMatches ? emptyNote : successNote,
    sourceType,
    attemptedAt,
    lastSuccessfulAt: noMatches ? null : attemptedAt,
    durationMs,
    usedCachedItems,
    cacheSource,
    diagnostics: [...diagnostics, ...relevantSelection.diagnostics],
    metrics: relevantSelection.metrics,
  };
}

export function buildSourceFailureResult({
  source,
  sourceType,
  attemptedAt,
  durationMs,
  error,
  fallbackNote,
}: SourceFailureInput): SourceFetchResult {
  let healthKind: SourceHealthKind = "failed";
  let note = fallbackNote ?? `${source} failed during the latest refresh.`;

  if (error instanceof FetchTimeoutError) {
    healthKind = "timed-out";
    note = `${source} timed out during the latest refresh.`;
  } else if (error instanceof FetchHttpError) {
    healthKind = "http-error";
    note = `${source} returned HTTP ${error.status} during the latest refresh.`;
  } else if (error instanceof FetchNetworkError) {
    healthKind = "network-error";
    note = `${source} hit a network error during the latest refresh.`;
  } else if (error instanceof SyntaxError) {
    healthKind = "parse-error";
    note = `${source} returned content that could not be parsed.`;
  }

  return {
    source,
    items: [],
    status: "failed",
    healthKind,
    note,
    sourceType,
    attemptedAt,
    lastSuccessfulAt: null,
    durationMs,
    usedCachedItems: false,
    cacheSource: null,
    diagnostics: [
      error instanceof Error ? error.message : "Unknown source failure.",
    ],
    metrics: buildMetrics(0, 0, 0),
  };
}

export function withCachedSourceResult(
  staleResult: SourceFetchResult,
  attemptedAt: string,
  failure: SourceFetchResult,
): SourceFetchResult {
  return {
    ...staleResult,
    status: "degraded",
    healthKind: "cached",
    note: `${failure.note} Showing cached source coverage from the last successful refresh.`,
    attemptedAt,
    usedCachedItems: true,
    cacheSource: "persisted-fallback",
    diagnostics: [...staleResult.diagnostics, ...failure.diagnostics],
  };
}

export function getHealthLabel(healthKind: SourceHealthKind) {
  switch (healthKind) {
    case "healthy":
      return "Healthy";
    case "fallback":
      return "Fallback";
    case "cached":
      return "Cached";
    case "timed-out":
      return "Timed out";
    case "http-error":
      return "HTTP error";
    case "parse-error":
      return "Parse issue";
    case "network-error":
      return "Network issue";
    case "no-matches":
      return "No matches";
    default:
      return "Failed";
  }
}

export async function parseRssFeed(xml: string) {
  return parser.parseString(xml);
}
