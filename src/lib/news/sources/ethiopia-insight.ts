import { fetchText } from "@/lib/news/http";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  finalizeSourceResult,
  parseRssFeed,
} from "@/lib/news/sources/helpers";
import type { SourceAdapter } from "@/lib/news/types";

export const ethiopiaInsightAdapter: SourceAdapter = {
  source: "Ethiopia Insight",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const xml = await fetchText("https://www.ethiopia-insight.com/feed/");
      const feed = await parseRssFeed(xml);

      const normalizedItems = (feed.items ?? [])
        .map((item) =>
          buildNormalizedItem({
            source: "Ethiopia Insight",
            title: item.title ?? "",
            url: item.link ?? "",
            publishedAt: item.pubDate
              ? new Date(item.pubDate).toISOString()
              : new Date().toISOString(),
            snippet: item.contentSnippet ?? item.content ?? item.title ?? "",
            section: item.categories?.[0] ?? "Analysis",
            language: "English",
            sourceType: "rss",
          }),
        )
        .filter((item) => item.url && item.title);

      return finalizeSourceResult({
        source: "Ethiopia Insight",
        sourceType: "rss",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "Ethiopia Insight analysis is flowing from the public site feed.",
        emptyNote:
          "Ethiopia Insight feed loaded, but no high-relevance items matched the current filter.",
      });
    } catch (error) {
      return buildSourceFailureResult({
        source: "Ethiopia Insight",
        sourceType: "rss",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  },
};
