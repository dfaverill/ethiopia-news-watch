import type { TopicName } from "@/lib/dashboard";
import type { NormalizedNewsItem } from "@/lib/news/types";
import {
  ETHIOPIA_ANCHOR_KEYWORDS,
  KEYWORD_WEIGHTS,
  SOURCE_CONTEXT_ALLOWLIST,
  TOPIC_KEYWORDS,
} from "@/lib/news/constants";

const keywordPatternCache = new Map<string, RegExp>();
const ETHIOPIC_SCRIPT_PATTERN = /[\u1200-\u137F]/u;

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getKeywordPattern(keyword: string) {
  const cached = keywordPatternCache.get(keyword);
  if (cached) {
    return cached;
  }

  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegex(keyword).replace(/\\ /g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  );
  keywordPatternCache.set(keyword, pattern);
  return pattern;
}

function includesKeyword(text: string, keyword: string): boolean {
  if (ETHIOPIC_SCRIPT_PATTERN.test(keyword)) {
    return text.includes(keyword);
  }

  return getKeywordPattern(keyword).test(text);
}

export function findMatchedKeywords(text: string): string[] {
  return Object.keys(KEYWORD_WEIGHTS).filter((keyword) =>
    includesKeyword(text, keyword),
  );
}

export function detectTopicTags(text: string): TopicName[] {
  return (Object.entries(TOPIC_KEYWORDS) as [TopicName, string[]][])
    .filter(([, keywords]) => keywords.some((keyword) => includesKeyword(text, keyword)))
    .map(([topic]) => topic);
}

export function scoreItemRelevance(
  title: string,
  snippet: string,
): { matchedKeywords: string[]; topicTags: TopicName[]; score: number } {
  const titleLower = title.toLowerCase();
  const snippetLower = snippet.toLowerCase();
  const combined = `${titleLower} ${snippetLower}`;

  const titleKeywords = findMatchedKeywords(titleLower);
  const snippetKeywords = findMatchedKeywords(snippetLower).filter(
    (keyword) => !titleKeywords.includes(keyword),
  );
  const matchedKeywords = [...titleKeywords, ...snippetKeywords];
  const topicTags = detectTopicTags(combined);

  const score =
    titleKeywords.reduce(
      (total, keyword) => total + (KEYWORD_WEIGHTS[keyword] ?? 0) * 1.35,
      0,
    ) +
    snippetKeywords.reduce(
      (total, keyword) => total + (KEYWORD_WEIGHTS[keyword] ?? 0) * 0.8,
      0,
    ) +
    topicTags.length * 2;

  return {
    matchedKeywords,
    topicTags,
    score: Math.round(score * 10) / 10,
  };
}

export function explainRelevanceDecision(
  source: NormalizedNewsItem["source"],
  title: string,
  snippet: string,
) {
  const { matchedKeywords, topicTags, score } = scoreItemRelevance(title, snippet);
  const hasAnchor = matchedKeywords.some((keyword) =>
    ETHIOPIA_ANCHOR_KEYWORDS.has(keyword),
  );
  const hasSourceContext = SOURCE_CONTEXT_ALLOWLIST.has(source);
  const passes =
    (hasAnchor && score >= 6) ||
    (!hasAnchor && hasSourceContext && score >= 8);

  return {
    matchedKeywords,
    topicTags,
    score,
    hasAnchor,
    hasSourceContext,
    passes,
  };
}

export function isRelevantItem(
  item: Pick<NormalizedNewsItem, "matchedKeywords" | "relevanceScore" | "source">,
) {
  const hasAnchor = item.matchedKeywords.some((keyword) =>
    ETHIOPIA_ANCHOR_KEYWORDS.has(keyword),
  );
  const hasSourceContext = SOURCE_CONTEXT_ALLOWLIST.has(item.source);

  return (
    (hasAnchor && item.relevanceScore >= 6) ||
    (!hasAnchor && hasSourceContext && item.relevanceScore >= 8)
  );
}
