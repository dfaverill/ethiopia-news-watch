import { load } from "cheerio";

import { fetchText } from "@/lib/news/http";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  finalizeSourceResult,
} from "@/lib/news/sources/helpers";
import { extractStoryImageUrlFromHtml } from "@/lib/news/story-images";
import { extractEnglishDate, firstSentence, toAbsoluteUrl } from "@/lib/news/text";
import type { SourceAdapter } from "@/lib/news/types";

interface EniListingCandidate {
  url: string;
  title: string;
}

function extractCandidates(html: string): EniListingCandidate[] {
  const $ = load(html);
  const seen = new Map<string, string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = $(element).text().replace(/\s+/g, " ").trim();

    if (!href.includes("/web/eng/w/eng_") || text.length < 16) {
      return;
    }

    const absoluteUrl = toAbsoluteUrl("https://www.ena.et/web/eng", href);
    const existing = seen.get(absoluteUrl);

    if (!existing || text.length < existing.length) {
      seen.set(absoluteUrl, text);
    }
  });

  return [...seen.entries()]
    .slice(0, 10)
    .map(([url, title]) => ({ url, title }));
}

export const enaAdapter: SourceAdapter = {
  source: "ENA",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const html = await fetchText("https://www.ena.et/web/eng");
      const candidates = extractCandidates(html);

      const detailPages = await Promise.allSettled(
        candidates.map(async (candidate) => {
          const detailHtml = await fetchText(candidate.url);
          const $ = load(detailHtml);
          const description =
            $('meta[property="og:description"]').attr("content") ?? candidate.title;

          return buildNormalizedItem({
            source: "ENA",
            title:
              $('meta[property="og:title"]')
                .attr("content")
                ?.replace(/\s+-\s+ENA.*$/i, "") ?? candidate.title,
            url: candidate.url,
            imageUrl: extractStoryImageUrlFromHtml(candidate.url, detailHtml),
            publishedAt:
              extractEnglishDate(description) ?? attemptedAt,
            attemptedAt,
            snippet: firstSentence(description),
            section: "News",
            language: "English",
            sourceType: "html",
          });
        }),
      );

      const normalizedItems = detailPages.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );

      return finalizeSourceResult({
        source: "ENA",
        sourceType: "html",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "ENA English stories were parsed from the public homepage and article metadata.",
        emptyNote:
          "ENA loaded, but no high-relevance items matched the current filter.",
        diagnostics: [`Parsed ${candidates.length} ENA homepage candidates.`],
      });
    } catch (error) {
      return buildSourceFailureResult({
        source: "ENA",
        sourceType: "html",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  },
};
