import { load } from "cheerio";

import { fetchText } from "@/lib/news/http";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  finalizeSourceResult,
} from "@/lib/news/sources/helpers";
import { extractEnglishDate, firstSentence, toAbsoluteUrl } from "@/lib/news/text";
import type { SourceAdapter } from "@/lib/news/types";

function extractArchiveLinks(html: string): string[] {
  const $ = load(html);
  const links: string[] = [];
  const seen = new Set<string>();

  $('a[href*="/en/node/"], a[href*="/index.php/en/node/"]').each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const absolute = toAbsoluteUrl("https://nebe.org.et/en/news-archive", href);
    if (!seen.has(absolute)) {
      seen.add(absolute);
      links.push(absolute);
    }
  });

  return links.slice(0, 10);
}

export const nebeAdapter: SourceAdapter = {
  source: "NEBE",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const archiveHtml = await fetchText("https://nebe.org.et/en/news-archive");
      const links = extractArchiveLinks(archiveHtml);

      const detailPages = await Promise.allSettled(
        links.map(async (url) => {
          const detailHtml = await fetchText(url);
          const $ = load(detailHtml);
          const title =
            $("h1").first().text().trim() || $("title").text().trim();
          const firstParagraph =
            $("article p").first().text().trim() ||
            $(".field--name-body p").first().text().trim() ||
            $("p").first().text().trim();

          return buildNormalizedItem({
            source: "NEBE",
            title,
            url,
            publishedAt:
              extractEnglishDate(firstParagraph) ??
              extractEnglishDate(detailHtml) ??
              attemptedAt,
            snippet: firstSentence(firstParagraph || title),
            section: "Election",
            language: "English",
            sourceType: "html",
          });
        }),
      );

      const normalizedItems = detailPages.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );

      return finalizeSourceResult({
        source: "NEBE",
        sourceType: "html",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "NEBE election updates were parsed from the public archive and article pages.",
        emptyNote:
          "NEBE loaded, but no high-relevance election items matched the current filter.",
        diagnostics: [`Parsed ${links.length} NEBE archive candidates.`],
      });
    } catch (error) {
      return buildSourceFailureResult({
        source: "NEBE",
        sourceType: "html",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  },
};
