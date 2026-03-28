import { fetchText } from "@/lib/news/http";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  finalizeSourceResult,
  parseRssFeed,
} from "@/lib/news/sources/helpers";
import type { SourceAdapter } from "@/lib/news/types";

const VOA_ETHIOPIA_RSS_URL = "https://amharic.voanews.com/api/zy--yeqv$y";

export const voaAmharicAdapter: SourceAdapter = {
  source: "VOA Amharic",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const xml = await fetchText(VOA_ETHIOPIA_RSS_URL);
      const feed = await parseRssFeed(xml);

      const normalizedItems = (feed.items ?? [])
        .map((item) =>
          buildNormalizedItem({
            source: "VOA Amharic",
            title: item.title ?? "",
            url: item.link ?? "",
            publishedAt: item.pubDate
              ? new Date(item.pubDate).toISOString()
              : attemptedAt,
            snippet: item.contentSnippet ?? item.content ?? item.title ?? "",
            section: item.categories?.[0] ?? "News",
            language: "Amharic",
            sourceType: "rss",
          }),
        )
        .filter((item) => item.url && item.title);

      return finalizeSourceResult({
        source: "VOA Amharic",
        sourceType: "rss",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "VOA Amharic Ethiopia/Eritrea coverage is now using the direct public RSS feed.",
        emptyNote:
          "VOA Amharic RSS loaded, but no high-relevance Ethiopia items matched the current filter.",
      });
    } catch (error) {
      return buildSourceFailureResult({
        source: "VOA Amharic",
        sourceType: "rss",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  },
};
