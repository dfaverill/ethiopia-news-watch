import { fetchText } from "@/lib/news/http";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  finalizeSourceResult,
  parseRssFeed,
} from "@/lib/news/sources/helpers";
import type { SourceAdapter } from "@/lib/news/types";

export const reporterAdapter: SourceAdapter = {
  source: "The Reporter Ethiopia",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const xml = await fetchText(
        "https://www.thereporterethiopia.com/latest-news-in-ethiopia/feed/",
      );
      const feed = await parseRssFeed(xml);

      const normalizedItems = (feed.items ?? [])
        .map((item) =>
          buildNormalizedItem({
            source: "The Reporter Ethiopia",
            title: item.title ?? "",
            url: item.link ?? "",
            publishedAt: item.pubDate
              ? new Date(item.pubDate).toISOString()
              : new Date().toISOString(),
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
          "Latest Reporter coverage is flowing from the public latest-news feed.",
        emptyNote:
          "The Reporter feed loaded, but no high-relevance Ethiopia items matched the current filter.",
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
