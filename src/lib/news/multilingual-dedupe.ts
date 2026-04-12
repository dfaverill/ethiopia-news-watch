import type { LanguageLabel, SourceName } from "@/lib/dashboard";
import {
  looksLikeAmharicText,
  translateNewsItemToEnglish,
} from "@/lib/amharic-text-translation";
import {
  firstSentence,
  headlineSimilarity,
  stripHtml,
  tokenizeHeadline,
  truncate,
} from "@/lib/news/text";
import { explainRelevanceDecision } from "@/lib/news/relevance";
import type { NormalizedNewsItem } from "@/lib/news/types";

const ETHIOPIA_NEWS_TIME_ZONE = "Africa/Addis_Ababa";
const SOURCE_LATIN_LANGUAGE_MARKERS: Partial<
  Record<SourceName, Partial<Record<"oromo", Set<string>>>>
> = {
  "Addis Standard": {
    oromo: new Set([
      "ayyaaneffannaaf",
      "baankiin",
      "biyyaalessaa",
      "doonniwwan",
      "filannoo",
      "gabaafame",
      "gabaasa",
      "giddu",
      "mootummaa",
      "naafxaa",
      "oromiyaa",
      "oromiyaan",
      "poolisii",
      "qindaa'an",
      "seentummaan",
      "tigraay",
      "wayita",
      "yaadawwan",
    ]),
  },
};

export type VariantLanguage = "english" | "amharic" | "oromo" | "unknown";

interface ComparableItem {
  combinedSimilarityText: string;
  language: VariantLanguage;
  numberTokens: Set<string>;
  title: string;
  titleTokens: Set<string>;
}

function getPublishedTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function getCalendarDateKey(value: string) {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ETHIOPIA_NEWS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
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

function extractNumberTokens(value: string) {
  return new Set(
    [...value.matchAll(/\b\d[\d,.]*\b/g)]
      .map((match) => match[0].replace(/[,.]/g, ""))
      .filter((token) => {
        const numericValue = Number(token);

        return !(
          Number.isFinite(numericValue) &&
          numericValue >= 1900 &&
          numericValue <= 2100
        );
      }),
  );
}

function looksProbablyEnglishText(value: string) {
  const tokens = value.toLowerCase().match(/\b[a-z']+\b/g) ?? [];

  if (tokens.length === 0) {
    return false;
  }

  const commonEnglishTokens = new Set([
    "a",
    "about",
    "addis",
    "after",
    "against",
    "and",
    "as",
    "at",
    "bank",
    "ethiopia",
    "ethiopian",
    "for",
    "from",
    "government",
    "in",
    "into",
    "iran",
    "lists",
    "news",
    "of",
    "on",
    "public",
    "says",
    "the",
    "to",
    "trump",
    "warns",
    "with",
  ]);
  const matchedCount = tokens.filter((token) =>
    commonEnglishTokens.has(token),
  ).length;

  return matchedCount >= Math.max(2, Math.ceil(tokens.length * 0.12));
}

function detectLanguageFromMarkers(
  source: SourceName,
  combined: string,
): VariantLanguage {
  const markers = SOURCE_LATIN_LANGUAGE_MARKERS[source];
  if (!markers) {
    return "unknown";
  }

  const latinTokens = combined.match(/\b[a-z']+\b/g) ?? [];

  if (
    markers.oromo &&
    latinTokens.some((token) => markers.oromo?.has(token))
  ) {
    return "oromo";
  }

  return "unknown";
}

export function inferVariantLanguage(
  item: Pick<NormalizedNewsItem, "source" | "title" | "snippet" | "language">,
): VariantLanguage {
  const combined = stripHtml([item.title, item.snippet].join(" ")).toLowerCase();
  const latinTokens = combined.match(/\b[a-z']+\b/g) ?? [];
  const probablyEnglish = looksProbablyEnglishText(combined);

  if (item.language === "Amharic" || looksLikeAmharicText(combined)) {
    return "amharic";
  }

  const markerLanguage = detectLanguageFromMarkers(item.source, combined);
  if (markerLanguage !== "unknown") {
    return markerLanguage;
  }

  if (
    item.source === "Addis Standard" &&
    latinTokens.length > 0 &&
    !probablyEnglish
  ) {
    return "oromo";
  }

  if (item.language === "English" || probablyEnglish) {
    return "english";
  }

  return "unknown";
}

export function isItemProbablyEnglish(
  item: Pick<NormalizedNewsItem, "source" | "title" | "snippet" | "language">,
) {
  return inferVariantLanguage(item) === "english";
}

export function formatVariantLanguageLabel(
  language: VariantLanguage,
): LanguageLabel | null {
  switch (language) {
    case "english":
      return "English";
    case "amharic":
      return "Amharic";
    case "oromo":
      return "Afaan Oromoo";
    default:
      return null;
  }
}

function getVariantPriority(language: VariantLanguage) {
  switch (language) {
    case "english":
      return 0;
    case "amharic":
      return 1;
    case "oromo":
      return 2;
    default:
      return 3;
  }
}

async function buildComparableItem(
  item: NormalizedNewsItem,
  cache: Map<string, Promise<ComparableItem>>,
) {
  const cached = cache.get(item.id);
  if (cached) {
    return cached;
  }

  const pendingComparable = (async () => {
    const detectedLanguage = inferVariantLanguage(item);
    const translated =
      detectedLanguage === "english"
        ? null
        : await translateNewsItemToEnglish({
            source: item.source,
            title: item.title,
            body: item.snippet,
            publishedAt: item.publishedAt,
            url: item.url,
            force: true,
            languageHint:
              detectedLanguage === "unknown" ? "unknown" : detectedLanguage,
          });

    const comparableTitle = truncate(
      stripHtml(translated?.title ?? item.title),
      220,
    );
    const comparableBody = truncate(
      firstSentence(translated?.body ?? item.snippet),
      220,
    );

    return {
      combinedSimilarityText: `${comparableTitle} ${comparableBody}`.trim(),
      language: detectedLanguage,
      numberTokens: extractNumberTokens(
        `${comparableTitle} ${comparableBody}`.toLowerCase(),
      ),
      title: comparableTitle,
      titleTokens: new Set(tokenizeHeadline(comparableTitle)),
    } satisfies ComparableItem;
  })();

  cache.set(item.id, pendingComparable);
  return pendingComparable;
}

async function areSameDayDuplicates(
  left: NormalizedNewsItem,
  right: NormalizedNewsItem,
  cache: Map<string, Promise<ComparableItem>>,
) {
  const [leftComparable, rightComparable] = await Promise.all([
    buildComparableItem(left, cache),
    buildComparableItem(right, cache),
  ]);
  const titleSimilarity = headlineSimilarity(
    leftComparable.title,
    rightComparable.title,
  );
  const combinedSimilarity = headlineSimilarity(
    leftComparable.combinedSimilarityText,
    rightComparable.combinedSimilarityText,
  );
  const sharedTitleTokenCount = sharedSetCount(
    leftComparable.titleTokens,
    rightComparable.titleTokens,
  );
  const sharedNumberCount = sharedSetCount(
    leftComparable.numberTokens,
    rightComparable.numberTokens,
  );
  const publishedAtDeltaMs = Math.abs(
    getPublishedTimestamp(left.publishedAt) -
      getPublishedTimestamp(right.publishedAt),
  );

  if (titleSimilarity >= 0.62) {
    return true;
  }

  if (
    titleSimilarity >= 0.42 &&
    (sharedNumberCount >= 1 || sharedTitleTokenCount >= 3)
  ) {
    return true;
  }

  if (
    sharedTitleTokenCount >= 4 &&
    (sharedNumberCount >= 1 || combinedSimilarity >= 0.24)
  ) {
    return true;
  }

  if (
    titleSimilarity >= 0.24 &&
    sharedNumberCount >= 1 &&
    sharedTitleTokenCount >= 3
  ) {
    return true;
  }

  return combinedSimilarity >= 0.42 && publishedAtDeltaMs <= 18 * 60 * 60 * 1000;
}

async function pickPreferredVariant(
  left: NormalizedNewsItem,
  right: NormalizedNewsItem,
  cache: Map<string, Promise<ComparableItem>>,
) {
  const [leftComparable, rightComparable] = await Promise.all([
    buildComparableItem(left, cache),
    buildComparableItem(right, cache),
  ]);
  const leftPriority = getVariantPriority(leftComparable.language);
  const rightPriority = getVariantPriority(rightComparable.language);

  if (rightPriority !== leftPriority) {
    return rightPriority < leftPriority ? right : left;
  }

  if (right.relevanceScore !== left.relevanceScore) {
    return right.relevanceScore > left.relevanceScore ? right : left;
  }

  if (right.snippet.length !== left.snippet.length) {
    return right.snippet.length > left.snippet.length ? right : left;
  }

  return getPublishedTimestamp(right.publishedAt) >
    getPublishedTimestamp(left.publishedAt)
    ? right
    : left;
}

export async function collapseSameDayMultilingualDuplicates(
  items: NormalizedNewsItem[],
) {
  const groups = new Map<string, NormalizedNewsItem[]>();
  const ungrouped: NormalizedNewsItem[] = [];

  for (const item of items) {
    const dayKey = getCalendarDateKey(item.publishedAt);
    if (!dayKey) {
      ungrouped.push(item);
      continue;
    }

    groups.set(dayKey, [...(groups.get(dayKey) ?? []), item]);
  }

  const comparableCache = new Map<string, Promise<ComparableItem>>();
  const deduped: NormalizedNewsItem[] = [...ungrouped];
  let collapsedCount = 0;

  for (const groupItems of groups.values()) {
    const groupDeduped: NormalizedNewsItem[] = [];

    for (const item of groupItems) {
      let matchedExistingIndex = -1;

      for (let index = 0; index < groupDeduped.length; index += 1) {
        if (
          await areSameDayDuplicates(
            groupDeduped[index],
            item,
            comparableCache,
          )
        ) {
          matchedExistingIndex = index;
          break;
        }
      }

      if (matchedExistingIndex === -1) {
        groupDeduped.push(item);
        continue;
      }

      groupDeduped[matchedExistingIndex] = await pickPreferredVariant(
        groupDeduped[matchedExistingIndex],
        item,
        comparableCache,
      );
      collapsedCount += 1;
    }

    deduped.push(...groupDeduped);
  }

  return {
    items: deduped.sort(
      (left, right) =>
        getPublishedTimestamp(right.publishedAt) -
        getPublishedTimestamp(left.publishedAt),
    ),
    collapsedCount,
  };
}

export async function translateItemsForEnglishDisplay(
  items: NormalizedNewsItem[],
) {
  const comparableCache = new Map<string, Promise<ComparableItem>>();
  let translatedCount = 0;

  const translatedItems = await Promise.all(
    items.map(async (item) => {
      const comparable = await buildComparableItem(item, comparableCache);
      const originalLanguage = formatVariantLanguageLabel(comparable.language);

      if (comparable.language === "english") {
        return {
          ...item,
          originalLanguage:
            item.originalLanguage ??
            (item.language === "English" ? null : item.language),
        } satisfies NormalizedNewsItem;
      }

      const translated =
        await translateNewsItemToEnglish({
          source: item.source,
          title: item.title,
          body: item.snippet,
          publishedAt: item.publishedAt,
          url: item.url,
          force: true,
          languageHint:
            comparable.language === "unknown" ? "unknown" : comparable.language,
        });

      if (!translated) {
        return {
          ...item,
          originalLanguage:
            item.originalLanguage ??
            (originalLanguage === "English" ? null : originalLanguage),
        } satisfies NormalizedNewsItem;
      }

      const translatedTitle = truncate(stripHtml(translated.title), 220);
      const translatedSnippet = truncate(firstSentence(translated.body), 220);
      const translatedRelevance = explainRelevanceDecision(
        item.source,
        translatedTitle,
        translatedSnippet,
      );
      translatedCount += 1;

      return {
        ...item,
        title: translatedTitle,
        snippet: translatedSnippet,
        language: "English",
        originalLanguage:
          item.originalLanguage ??
          (originalLanguage === "English" ? null : originalLanguage),
        matchedKeywords: translatedRelevance.matchedKeywords,
        topicTags: translatedRelevance.topicTags,
        relevanceScore: translatedRelevance.score,
      } satisfies NormalizedNewsItem;
    }),
  );

  return {
    items: translatedItems,
    translatedCount,
  };
}
