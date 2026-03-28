import { fetchGoogleNewsFallback } from "@/lib/news/google-news";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  finalizeSourceResult,
} from "@/lib/news/sources/helpers";
import type { SourceAdapter } from "@/lib/news/types";

export const addisStandardAdapter: SourceAdapter = {
  source: "Addis Standard",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const fallbackItems = await fetchGoogleNewsFallback(
        "Addis Standard",
        "site:addisstandard.com Ethiopia",
      );

      const normalizedItems = fallbackItems.map((item) =>
        buildNormalizedItem({
          source: "Addis Standard",
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          snippet: item.snippet,
          section: "News",
          language: "English",
          sourceType: "search-fallback",
        }),
      );

      return finalizeSourceResult({
        source: "Addis Standard",
        sourceType: "search-fallback",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "Addis Standard is currently best handled through Google News RSS fallback because direct server-side requests trigger a bot challenge.",
        emptyNote:
          "Addis Standard fallback loaded, but no Ethiopia-relevant Addis Standard items matched the current filter.",
        diagnostics: [
          "Direct Addis Standard RSS and listing pages remain bot-protected for server-side fetches.",
        ],
        healthKind: "fallback",
      });
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
