import { load } from "cheerio";

import { fetchText } from "@/lib/news/http";
import {
  buildSourceFailureResult,
  buildNormalizedItem,
  extractRssItemImageUrl,
  finalizeSourceResult,
  parseRssFeed,
} from "@/lib/news/sources/helpers";
import type { SourceAdapter } from "@/lib/news/types";
import { stripHtml, toAbsoluteUrl } from "@/lib/news/text";

const ETHIOPIA_INSIGHT_HOME_URL = "https://www.ethiopia-insight.com/";
const ETHIOPIA_INSIGHT_POST_SITEMAP_URL =
  "https://www.ethiopia-insight.com/post-sitemap.xml";

function deriveIsoDateFromUrl(url: string) {
  const match = url.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);

  if (!match) {
    return null;
  }

  const [, yearValue, monthValue, dayValue] = match;
  return new Date(
    Date.UTC(Number(yearValue), Number(monthValue) - 1, Number(dayValue)),
  ).toISOString();
}

function extractHomepageCandidates(html: string) {
  const $ = load(html);
  const seen = new Map<
    string,
    {
      title: string;
      url: string;
      publishedAt: string;
      snippet: string;
    }
  >();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const url = toAbsoluteUrl(ETHIOPIA_INSIGHT_HOME_URL, href);
    const title = $(element).text().replace(/\s+/g, " ").trim();
    const publishedAt = deriveIsoDateFromUrl(url);

    if (!publishedAt || title.length < 16) {
      return;
    }

    seen.set(url, {
      title,
      url,
      publishedAt,
      snippet: title,
    });
  });

  return [...seen.values()];
}

function extractSitemapCandidates(xml: string) {
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
    .map((match) => ({
      title: "",
      url: stripHtml(match[1]),
      publishedAt: new Date(match[2]).toISOString(),
      snippet: "",
    }))
    .filter((entry) => entry.url && entry.publishedAt);
}

export const ethiopiaInsightAdapter: SourceAdapter = {
  source: "Ethiopia Insight",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const [xml, homepageHtml, sitemapXml] = await Promise.all([
        fetchText("https://www.ethiopia-insight.com/feed/"),
        fetchText(ETHIOPIA_INSIGHT_HOME_URL),
        fetchText(ETHIOPIA_INSIGHT_POST_SITEMAP_URL),
      ]);
      const feed = await parseRssFeed(xml);

      const normalizedItems = [
        ...(feed.items ?? []).map((item) =>
          buildNormalizedItem({
            source: "Ethiopia Insight",
            title: item.title ?? "",
            url: item.link ?? "",
            imageUrl: extractRssItemImageUrl(item, item.link ?? ETHIOPIA_INSIGHT_HOME_URL),
            publishedAt: item.pubDate
              ? new Date(item.pubDate).toISOString()
              : attemptedAt,
            attemptedAt,
            snippet: item.contentSnippet ?? item.content ?? item.title ?? "",
            section: item.categories?.[0] ?? "Analysis",
            language: "English",
            sourceType: "rss",
          }),
        ),
        ...extractHomepageCandidates(homepageHtml).map((item) =>
          buildNormalizedItem({
            source: "Ethiopia Insight",
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            attemptedAt,
            snippet: item.snippet,
            section: "Analysis",
            language: "English",
            sourceType: "html",
          }),
        ),
        ...extractSitemapCandidates(sitemapXml).map((item) =>
          buildNormalizedItem({
            source: "Ethiopia Insight",
            title: item.title || item.url,
            url: item.url,
            publishedAt: item.publishedAt,
            attemptedAt,
            snippet: item.snippet || item.url,
            section: "Analysis",
            language: "English",
            sourceType: "html",
          }),
        ),
      ]
        .filter((item) => item.url && item.title)
        .sort((left, right) => {
          return (
            new Date(right.publishedAt).getTime() -
            new Date(left.publishedAt).getTime()
          );
        });

      return finalizeSourceResult({
        source: "Ethiopia Insight",
        sourceType: "html",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "Ethiopia Insight analysis is flowing from the official feed, homepage, and post sitemap.",
        emptyNote:
          "Ethiopia Insight official surfaces loaded, but no high-relevance items matched the current filter.",
        diagnostics: [
          "Checked https://www.ethiopia-insight.com/feed/.",
          `Checked ${ETHIOPIA_INSIGHT_HOME_URL}.`,
          `Checked ${ETHIOPIA_INSIGHT_POST_SITEMAP_URL}.`,
        ],
      });
    } catch (error) {
      return buildSourceFailureResult({
        source: "Ethiopia Insight",
        sourceType: "html",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  },
};
