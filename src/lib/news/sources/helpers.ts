import Parser from "rss-parser";
import { load } from "cheerio";

import type {
  CacheSource,
  LanguageLabel,
  SourceHealthKind,
  SourceName,
  SourceStatusState,
} from "@/lib/dashboard";
import {
  MAX_ITEMS_PER_SOURCE,
  RECENT_NEWS_WINDOW_MS,
} from "@/lib/news/constants";
import {
  FetchHttpError,
  FetchNetworkError,
  FetchTimeoutError,
} from "@/lib/news/http";
import {
  collapseSameDayMultilingualDuplicates,
  translateItemsForEnglishDisplay,
} from "@/lib/news/multilingual-dedupe";
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
  toAbsoluteUrl,
  truncate,
} from "@/lib/news/text";
import { normalizeStoryImageUrl } from "@/lib/news/story-images";

const parser = new Parser();

interface BaseItemInput {
  source: SourceName;
  title: string;
  url: string;
  imageUrl?: string | null;
  publishedAt: string;
  attemptedAt?: string;
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

function collectFeedImageCandidates(value: unknown, candidates: string[]) {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    candidates.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectFeedImageCandidates(entry, candidates));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  collectFeedImageCandidates(record.url, candidates);
  collectFeedImageCandidates(record.href, candidates);
  collectFeedImageCandidates(record.src, candidates);
  collectFeedImageCandidates(record["_"], candidates);
  collectFeedImageCandidates(record["$"], candidates);
}

function isIgnoredFeedImageUrl(url: string) {
  return (
    /\.svg(?:[?#].*)?$/i.test(url) ||
    /\/share_icons\//i.test(url) ||
    /\/gravatar\//i.test(url)
  );
}

function extractImageFromHtmlSnippet(
  pageUrl: string,
  htmlSnippet: string | null | undefined,
) {
  if (!htmlSnippet) {
    return null;
  }

  const $ = load(htmlSnippet);
  const rawCandidates = [
    $('meta[property="og:image"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $("img").first().attr("src"),
    $("img").first().attr("data-src"),
    $("source").first().attr("srcset"),
  ];

  for (const rawCandidate of rawCandidates) {
    const firstSrcsetCandidate = rawCandidate?.split(",")[0]?.trim().split(/\s+/)[0];
    const normalizedCandidate = normalizeStoryImageUrl(
      pageUrl,
      firstSrcsetCandidate ?? rawCandidate,
    );

    if (normalizedCandidate && !isIgnoredFeedImageUrl(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  const fallbackMatch = htmlSnippet.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? null;
  const normalizedFallback = normalizeStoryImageUrl(pageUrl, fallbackMatch);

  if (normalizedFallback && !isIgnoredFeedImageUrl(normalizedFallback)) {
    return normalizedFallback;
  }

  return null;
}

export function extractRssItemImageUrl(
  item: Parser.Item,
  fallbackPageUrl?: string | null,
) {
  const basePageUrl =
    sanitizeHttpUrl(item.link ?? "") ??
    sanitizeHttpUrl(fallbackPageUrl ?? "") ??
    fallbackPageUrl ??
    "";

  if (!basePageUrl) {
    return null;
  }

  const rawCandidates: string[] = [];
  const rawItem = item as unknown as Record<string, unknown>;

  collectFeedImageCandidates(item.enclosure?.url, rawCandidates);
  collectFeedImageCandidates(rawItem["media:content"], rawCandidates);
  collectFeedImageCandidates(rawItem["media:thumbnail"], rawCandidates);

  for (const rawCandidate of rawCandidates) {
    const absoluteCandidate = toAbsoluteUrl(basePageUrl, rawCandidate);
    const normalizedCandidate = normalizeStoryImageUrl(basePageUrl, absoluteCandidate);

    if (normalizedCandidate && !isIgnoredFeedImageUrl(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return (
    extractImageFromHtmlSnippet(basePageUrl, item.content) ??
    extractImageFromHtmlSnippet(
      basePageUrl,
      typeof rawItem["content:encoded"] === "string"
        ? rawItem["content:encoded"]
        : null,
    )
  );
}

export function buildNormalizedItem(input: BaseItemInput): NormalizedNewsItem {
  const attemptedTimestamp = input.attemptedAt
    ? new Date(input.attemptedAt).getTime()
    : Date.now();
  const parsedPublishedAt = new Date(input.publishedAt).getTime();
  const isValidPublishedAt =
    Number.isFinite(parsedPublishedAt) &&
    parsedPublishedAt > 0 &&
    parsedPublishedAt <= attemptedTimestamp + 3 * 60 * 60 * 1000;
  const cleanedTitle = stripHtml(input.title);
  const cleanedSnippet = truncate(firstSentence(input.snippet || cleanedTitle), 220);
  const cleanedUrl = sanitizeHttpUrl(removeTrackingParams(input.url));
  const cleanedImageUrl =
    normalizeStoryImageUrl(cleanedUrl ?? input.url, input.imageUrl) ?? null;
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
    imageUrl: cleanedImageUrl,
    publishedAt: isValidPublishedAt
      ? new Date(parsedPublishedAt).toISOString()
      : input.attemptedAt ?? new Date().toISOString(),
    snippet: cleanedSnippet,
    section: input.section,
    language: input.language,
    originalLanguage: input.language === "English" ? null : input.language,
    sourceType: input.sourceType,
    matchedKeywords,
    topicTags,
    relevanceScore: score,
  };
}

export function filterItemsToRecentWindow(
  items: NormalizedNewsItem[],
  referenceIso: string,
) {
  const referenceTimestamp = new Date(referenceIso).getTime();

  if (!Number.isFinite(referenceTimestamp)) {
    return [];
  }

  const windowStartTimestamp = referenceTimestamp - RECENT_NEWS_WINDOW_MS;

  return items.filter((item) => {
    const publishedTimestamp = new Date(item.publishedAt).getTime();

    return (
      Number.isFinite(publishedTimestamp) &&
      publishedTimestamp >= windowStartTimestamp &&
      publishedTimestamp <= referenceTimestamp
    );
  });
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
  attemptedAt: string,
  limit = MAX_ITEMS_PER_SOURCE,
) {
  const recentItems = filterItemsToRecentWindow(normalizedItems, attemptedAt);
  const relevantItems = recentItems.filter(isRelevantItem);
  const keptItems = relevantItems.slice(0, limit);
  const filteredExamples = recentItems
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
    `Kept ${keptItems.length} relevant items from the last 7 days after filtering.`,
  ];

  const droppedOlderItems = Math.max(normalizedItems.length - recentItems.length, 0);

  if (droppedOlderItems > 0) {
    diagnostics.push(
      `Dropped ${droppedOlderItems} item${droppedOlderItems === 1 ? "" : "s"} older than the last 7 days.`,
    );
  }

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
}: FinalizeSourceResultInput): Promise<SourceFetchResult> {
  const finalize = async () => {
    const multilingualDedupe = await collapseSameDayMultilingualDuplicates(
      normalizedItems,
    );
    const relevantSelectionWithoutRawCount = selectRelevantItems(
      source,
      multilingualDedupe.items,
      attemptedAt,
      limit,
    );
    const relevantSelection = {
      ...relevantSelectionWithoutRawCount,
      metrics: {
        ...relevantSelectionWithoutRawCount.metrics,
        rawCount: normalizedItems.length,
        filteredOutCount: Math.max(
          normalizedItems.length - relevantSelectionWithoutRawCount.items.length,
          0,
        ),
      },
    };
    const translatedSelection = await translateItemsForEnglishDisplay(
      relevantSelection.items,
    );
    const resolvedDiagnostics = [...diagnostics];

    if (multilingualDedupe.collapsedCount > 0) {
      resolvedDiagnostics.push(
        `Collapsed ${multilingualDedupe.collapsedCount} probable same-day multilingual duplicate${multilingualDedupe.collapsedCount === 1 ? "" : "s"} before selecting the source feed.`,
      );
    }

    if (translatedSelection.translatedCount > 0) {
      resolvedDiagnostics.push(
        `Translated ${translatedSelection.translatedCount} non-English item${translatedSelection.translatedCount === 1 ? "" : "s"} into English for feed display.`,
      );
    }

    const noMatches = translatedSelection.items.length === 0;
    const resolvedHealthKind = noMatches ? "no-matches" : healthKind;
    const resolvedStatus: SourceStatusState =
      resolvedHealthKind === "healthy" ||
      resolvedHealthKind === "fallback" ||
      resolvedHealthKind === "no-matches"
        ? "online"
        : "degraded";

    return {
      source,
      items: translatedSelection.items,
      status: resolvedStatus,
      healthKind: resolvedHealthKind,
      note: noMatches ? emptyNote : successNote,
      sourceType,
      attemptedAt,
      lastSuccessfulAt: attemptedAt,
      durationMs,
      usedCachedItems,
      cacheSource,
      diagnostics: [...resolvedDiagnostics, ...relevantSelection.diagnostics],
      metrics: relevantSelection.metrics,
    };
  };

  return finalize();
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
  const recentCachedItems = filterItemsToRecentWindow(staleResult.items, attemptedAt);

  if (recentCachedItems.length === 0) {
    return {
      ...failure,
      note: `${failure.note} Cached source coverage older than 7 days was discarded.`,
      diagnostics: [
        ...failure.diagnostics,
        "Cached source items older than the last 7 days were not reused.",
      ],
    };
  }

  return {
    ...staleResult,
    items: recentCachedItems,
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
