import { fetchGoogleNewsFallback } from "@/lib/news/google-news";
import { fetchText } from "@/lib/news/http";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  finalizeSourceResult,
} from "@/lib/news/sources/helpers";
import type { SourceAdapter } from "@/lib/news/types";

function parseReutersSitemap(xml: string) {
  return xml
    .split("<url>")
    .slice(1)
    .map((block) => ({
      url: block.match(/<loc>(.*?)<\/loc>/)?.[1] ?? "",
      title:
        block.match(/<news:title><!\[CDATA\[(.*?)\]\]><\/news:title>/)?.[1] ?? "",
      publishedAt:
        block.match(/<news:publication_date>(.*?)<\/news:publication_date>/)?.[1] ??
        "",
    }))
    .filter((item) => item.url && item.title && item.publishedAt);
}

export const reutersAdapter: SourceAdapter = {
  source: "Reuters",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const sitemapUrls = [
        "https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml",
        "https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml&from=100",
        "https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml&from=200",
      ];

      const sitemapResponses = await Promise.allSettled(
        sitemapUrls.map((url) => fetchText(url)),
      );

      const officialItems = sitemapResponses
        .flatMap((result) =>
          result.status === "fulfilled" ? parseReutersSitemap(result.value) : [],
        )
        .map((item) =>
          buildNormalizedItem({
            source: "Reuters",
            title: item.title,
            url: item.url,
            publishedAt: new Date(item.publishedAt).toISOString(),
            snippet: item.title,
            section: "Africa",
            language: "English",
            sourceType: "sitemap",
          }),
        );

      const officialResult = finalizeSourceResult({
        source: "Reuters",
        sourceType: "sitemap",
        normalizedItems: officialItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "Reuters Ethiopia-relevant items pulled from the official Reuters outbound news sitemaps.",
        emptyNote:
          "Reuters official sitemaps loaded, but no Ethiopia-relevant coverage met the current filter.",
        diagnostics: [
          `Fetched ${officialItems.length} sitemap candidate items from Reuters.`,
        ],
      });

      if (officialResult.items.length > 0) {
        return officialResult;
      }
    } catch {
      // Fall through to the practical fallback.
    }

    try {
      const fallbackItems = await fetchGoogleNewsFallback(
        "Reuters",
        "site:reuters.com Ethiopia",
      );

      const normalizedItems = fallbackItems.map((item) =>
        buildNormalizedItem({
          source: "Reuters",
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          snippet: item.snippet,
          section: "Africa",
          language: "English",
          sourceType: "search-fallback",
        }),
      );

      return finalizeSourceResult({
        source: "Reuters",
        sourceType: "search-fallback",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "Reuters listing pages are bot-protected in server fetches; using Google News RSS fallback links for Reuters coverage.",
        emptyNote:
          "Reuters official surfaces were inaccessible and fallback search produced no Ethiopia-relevant Reuters coverage.",
        diagnostics: [
          "Switched to Google News RSS fallback after Reuters sitemap coverage was insufficient.",
        ],
        healthKind: "fallback",
      });
    } catch (error) {
      return buildSourceFailureResult({
        source: "Reuters",
        sourceType: "search-fallback",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
        fallbackNote:
          "Reuters official and fallback surfaces were unavailable during the latest refresh.",
      });
    }
  },
};
