import { fetchText } from "@/lib/news/http";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  extractRssItemImageUrl,
  finalizeSourceResult,
  parseRssFeed,
} from "@/lib/news/sources/helpers";
import type { SourceAdapter } from "@/lib/news/types";

const REPORTER_FEED_URLS = [
  "https://www.thereporterethiopia.com/latest-news-in-ethiopia/feed/",
  "https://www.thereporterethiopia.com/feed/",
] as const;

async function fetchReporterFeedXml(attemptedAt: string) {
  let lastError: unknown = null;

  for (const feedUrl of REPORTER_FEED_URLS) {
    try {
      return {
        feedUrl,
        xml: await fetchText(`${feedUrl}?nocache=${attemptedAt}`),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Reporter feed request failed.");
}

export const reporterAdapter: SourceAdapter = {
  source: "The Reporter Ethiopia",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const { feedUrl, xml } = await fetchReporterFeedXml(String(startedAt));
      const feed = await parseRssFeed(xml);

      const normalizedItems = (feed.items ?? [])
        .map((item) =>
          buildNormalizedItem({
            source: "The Reporter Ethiopia",
            title: item.title ?? "",
            url: item.link ?? "",
            imageUrl: extractRssItemImageUrl(item, item.link ?? feedUrl),
            publishedAt: item.pubDate
              ? new Date(item.pubDate).toISOString()
              : attemptedAt,
            attemptedAt,
            snippet: item.contentSnippet ?? item.content ?? item.title ?? "",
            section: item.categories?.[0] ?? "News",
            language: "English",
            sourceType: "rss",
          }),
        )
        .filter((item) => item.url && item.title);

      return finalizeSourceResult({
        source: "The Reporter Ethiopia",
        sourceType: "rss",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          feedUrl.includes("/latest-news-in-ethiopia/")
            ? "Latest Reporter coverage is flowing from the public latest-news feed."
            : "Latest Reporter coverage is flowing from the public sitewide feed after the latest-news feed failed.",
        emptyNote:
          "The Reporter feed loaded, but no high-relevance Ethiopia items matched the current filter.",
        diagnostics: [
          `Reporter feed source: ${feedUrl}`,
          feedUrl.includes("/latest-news-in-ethiopia/")
            ? "Primary Reporter latest-news feed responded successfully."
            : "Reporter latest-news feed failed, so the app recovered through the official sitewide feed.",
        ],
      });
    } catch (error) {
      return buildSourceFailureResult({
        source: "The Reporter Ethiopia",
        sourceType: "rss",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  },
};
