import { load } from "cheerio";

import { MAX_ITEMS_PER_SOURCE } from "@/lib/news/constants";
import { fetchGoogleNewsFallback } from "@/lib/news/google-news";
import {
  collapseSameDayMultilingualDuplicates,
  isItemProbablyEnglish,
  translateItemsForEnglishDisplay,
} from "@/lib/news/multilingual-dedupe";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  filterItemsToRecentWindow,
  selectRelevantItems,
} from "@/lib/news/sources/helpers";
import {
  normalizeTitle,
  sanitizeHttpUrl,
  stripHtml,
  toAbsoluteUrl,
  truncate,
} from "@/lib/news/text";
import type {
  NormalizedNewsItem,
  SourceAdapter,
  SourceFetchMetrics,
  SourceFetchResult,
} from "@/lib/news/types";

const ADDIS_STANDARD_FALLBACK_QUERIES = [
  "site:addisstandard.com when:7d",
  "site:addisstandard.com Ethiopia when:7d",
] as const;
const ADDIS_STANDARD_HOMEPAGE_URL = "https://addisstandard.com/";
const ADDIS_STANDARD_MAX_HOMEPAGE_ARTICLES = 8;
const ADDIS_STANDARD_REQUEST_TIMEOUT_MS = 6000;

function buildAddisStandardHeaderSets() {
  return [
    {
      "user-agent": "facebookexternalhit/1.1",
      "accept-language": "en-US,en;q=0.9",
    },
    {
      "user-agent": "Twitterbot/1.0",
      "accept-language": "en-US,en;q=0.9",
    },
    {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
  ] as const;
}

async function fetchAddisStandardHtml(url: string) {
  for (const headers of buildAddisStandardHeaderSets()) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(ADDIS_STANDARD_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        continue;
      }

      return {
        url: response.url || url,
        html: await response.text(),
      };
    } catch {
      continue;
    }
  }

  return null;
}

function isAddisStandardArticleUrl(url: string) {
  const sanitizedUrl = sanitizeHttpUrl(url);

  if (!sanitizedUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(sanitizedUrl);
    const pathname = parsedUrl.pathname.toLowerCase();

    if (
      parsedUrl.hostname !== "addisstandard.com" &&
      !parsedUrl.hostname.endsWith(".addisstandard.com")
    ) {
      return false;
    }

    if (
      pathname === "/" ||
      pathname.startsWith("/wp-") ||
      pathname.startsWith("/tag/") ||
      pathname.startsWith("/category/") ||
      pathname.startsWith("/author/") ||
      pathname.startsWith("/page/") ||
      pathname.startsWith("/feed") ||
      /^\/\d{4}\/\d{2}\/?$/.test(pathname)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function extractAddisHomepageArticleUrls(html: string) {
  const $ = load(html);
  const candidates = new Set<string>();

  const anchorSelectors = [
    "h1 a[href]",
    "h2 a[href]",
    "h3 a[href]",
    "article a[href]",
    ".post-title a[href]",
    ".entry-title a[href]",
    ".post-box-title a[href]",
    "a[data-type='post'][href]",
  ];

  for (const selector of anchorSelectors) {
    $(selector).each((_, element) => {
      const href = $(element).attr("href");
      const sanitizedUrl = sanitizeHttpUrl(
        href ? toAbsoluteUrl(ADDIS_STANDARD_HOMEPAGE_URL, href) : href,
      );
      const titleText = stripHtml($(element).text());

      if (
        sanitizedUrl &&
        isAddisStandardArticleUrl(sanitizedUrl) &&
        titleText.length >= 24
      ) {
        candidates.add(sanitizedUrl);
      }
    });
  }

  return [...candidates].slice(0, ADDIS_STANDARD_MAX_HOMEPAGE_ARTICLES);
}

async function fetchAddisHomepageItems(attemptedAt: string) {
  const homepage = await fetchAddisStandardHtml(ADDIS_STANDARD_HOMEPAGE_URL);

  if (!homepage) {
    return {
      items: [] as NormalizedNewsItem[],
      diagnostics: [
        "Direct Addis Standard homepage fetch did not return usable HTML.",
      ],
    };
  }

  const articleUrls = extractAddisHomepageArticleUrls(homepage.html);
  const diagnostics = [
    `Fetched Addis Standard homepage and extracted ${articleUrls.length} candidate article URLs.`,
  ];

  const articlePages = await Promise.all(
    articleUrls.map(async (articleUrl) => {
      const page = await fetchAddisStandardHtml(articleUrl);

      if (!page) {
        return null;
      }

      const $ = load(page.html);
      const title =
        stripHtml($('meta[property="og:title"]').attr("content")) ||
        stripHtml($("title").first().text()) ||
        stripHtml($("h1").first().text());
      const description =
        stripHtml($('meta[property="og:description"]').attr("content")) ||
        stripHtml($('meta[name="description"]').attr("content")) ||
        stripHtml($("article p").first().text()) ||
        title;
      const imageUrl =
        sanitizeHttpUrl($('meta[property="og:image"]').attr("content")) ||
        sanitizeHttpUrl($('meta[name="twitter:image"]').attr("content"));
      const publishedAt =
        $('meta[property="article:published_time"]').attr("content") ||
        $('meta[property="article:modified_time"]').attr("content") ||
        $("time[datetime]").first().attr("datetime") ||
        attemptedAt;
      const section =
        stripHtml($('meta[property="article:section"]').attr("content")) ||
        "News";

      if (!title) {
        return null;
      }

      return buildNormalizedItem({
        source: "Addis Standard",
        title,
        url: page.url,
        imageUrl,
        publishedAt,
        attemptedAt,
        snippet: truncate(description || title, 220),
        section,
        language: "English",
        sourceType: "html",
      });
    }),
  );

  const items = articlePages.filter((item): item is NormalizedNewsItem => Boolean(item));

  diagnostics.push(
    `Recovered ${items.length} Addis Standard homepage article${items.length === 1 ? "" : "s"} with direct article metadata.`,
  );

  return { items, diagnostics };
}

function mergeAddisItems(
  homepageItems: NormalizedNewsItem[],
  fallbackItems: NormalizedNewsItem[],
) {
  const mergedItems = new Map<string, NormalizedNewsItem>();

  for (const item of fallbackItems) {
    mergedItems.set(normalizeTitle(item.title), item);
  }

  for (const item of homepageItems) {
    mergedItems.set(normalizeTitle(item.title), item);
  }

  return [...mergedItems.values()].sort(
    (left, right) => getPublishedTimestamp(right.publishedAt) - getPublishedTimestamp(left.publishedAt),
  );
}

function getPublishedTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export async function selectAddisStandardFallbackItems(
  normalizedItems: NormalizedNewsItem[],
  attemptedAt: string,
) {
  const dedupedPublisherMatches = await collapseSameDayMultilingualDuplicates(
    filterItemsToRecentWindow(normalizedItems, attemptedAt),
  );
  const recentPublisherMatches = dedupedPublisherMatches.items.slice(
    0,
    MAX_ITEMS_PER_SOURCE,
  );
  const relevantSelectionWithoutRawCount = selectRelevantItems(
    "Addis Standard",
    dedupedPublisherMatches.items,
    attemptedAt,
    MAX_ITEMS_PER_SOURCE,
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
  const newestRecentTimestamp = recentPublisherMatches.reduce(
    (latest, item) => Math.max(latest, getPublishedTimestamp(item.publishedAt)),
    Number.NEGATIVE_INFINITY,
  );
  const newestRelevantTimestamp = relevantSelection.items.reduce(
    (latest, item) => Math.max(latest, getPublishedTimestamp(item.publishedAt)),
    Number.NEGATIVE_INFINITY,
  );
  const shouldPreferRecentPublisherMatches =
    recentPublisherMatches.length > 0 &&
    newestRecentTimestamp > newestRelevantTimestamp;

  const selectedItems = shouldPreferRecentPublisherMatches
    ? recentPublisherMatches
    : relevantSelection.items;
  const translatedSelection = await translateItemsForEnglishDisplay(selectedItems);
  const feedSafeItems = translatedSelection.items.filter(isItemProbablyEnglish);
  const hiddenNonEnglishCount =
    translatedSelection.items.length - feedSafeItems.length;
  const diagnostics = [...relevantSelection.diagnostics];

  if (shouldPreferRecentPublisherMatches) {
    diagnostics.push(
      "Preserved fresher current-week Addis Standard publisher matches when multilingual Google News titles outranked the English-only relevance scoring.",
    );
  }

  if (dedupedPublisherMatches.collapsedCount > 0) {
    diagnostics.push(
      `Collapsed ${dedupedPublisherMatches.collapsedCount} probable same-day Addis Standard multilingual duplicate${dedupedPublisherMatches.collapsedCount === 1 ? "" : "s"} using translation-backed comparison.`,
    );
  }

  if (translatedSelection.translatedCount > 0) {
    diagnostics.push(
      `Translated ${translatedSelection.translatedCount} Addis Standard non-English item${translatedSelection.translatedCount === 1 ? "" : "s"} into English for feed display.`,
    );
  }

  if (hiddenNonEnglishCount > 0) {
    diagnostics.push(
      `Hidden ${hiddenNonEnglishCount} Addis Standard item${hiddenNonEnglishCount === 1 ? "" : "s"} that still did not resolve to English after translation.`,
    );
  }

  const metrics: SourceFetchMetrics = shouldPreferRecentPublisherMatches
    ? {
        rawCount: normalizedItems.length,
        relevantCount: recentPublisherMatches.length,
        keptCount: feedSafeItems.length,
        filteredOutCount: Math.max(
          normalizedItems.length - feedSafeItems.length,
          0,
        ),
      }
    : relevantSelection.metrics;

  return {
    items: feedSafeItems,
    diagnostics,
    metrics,
  };
}

export const addisStandardAdapter: SourceAdapter = {
  source: "Addis Standard",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const homepageSelection = await fetchAddisHomepageItems(attemptedAt);
      const fallbackItems = await fetchGoogleNewsFallback(
        "Addis Standard",
        [...ADDIS_STANDARD_FALLBACK_QUERIES],
      );

      const fallbackNormalizedItems = fallbackItems.map((item) =>
        buildNormalizedItem({
          source: "Addis Standard",
          title: item.title,
          url: item.url,
          imageUrl: item.imageUrl,
          publishedAt: item.publishedAt,
          attemptedAt,
          snippet: item.snippet,
          section: "News",
          language: "English",
          sourceType: "search-fallback",
        }),
      );
      const normalizedItems = mergeAddisItems(
        homepageSelection.items,
        fallbackNormalizedItems,
      );
      const selection = await selectAddisStandardFallbackItems(
        normalizedItems,
        attemptedAt,
      );
      const noMatches = selection.items.length === 0;

      return {
        source: "Addis Standard",
        items: selection.items,
        status: "online",
        healthKind: noMatches ? "no-matches" : "healthy",
        note: noMatches
          ? "Addis Standard loaded, but no current-week Addis Standard items matched the current filter."
          : "Addis Standard is now refreshed from its official homepage first, with Google fallback filling any remaining gaps.",
        sourceType: homepageSelection.items.length > 0 ? "html" : "search-fallback",
        attemptedAt,
        lastSuccessfulAt: attemptedAt,
        durationMs: Date.now() - startedAt,
        usedCachedItems: false,
        cacheSource: null,
        diagnostics: [
          "Prioritized Addis Standard official homepage and article metadata before fallback search results.",
          ...homepageSelection.diagnostics,
          `Queried current-week Google News publisher feeds: ${ADDIS_STANDARD_FALLBACK_QUERIES.join("; ")}.`,
          ...selection.diagnostics,
        ],
        metrics: selection.metrics,
      } satisfies SourceFetchResult;
    } catch (error) {
      return buildSourceFailureResult({
        source: "Addis Standard",
        sourceType: "search-fallback",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
        fallbackNote:
          "Addis Standard is currently blocked by a bot challenge and fallback search results were not available.",
      });
    }
  },
};
