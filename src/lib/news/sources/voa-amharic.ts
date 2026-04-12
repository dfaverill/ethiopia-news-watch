import { gunzipSync } from "node:zlib";

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
import { extractStoryImageUrlFromHtml } from "@/lib/news/story-images";
import { stripHtml } from "@/lib/news/text";

const VOA_ETHIOPIA_RSS_URL = "https://amharic.voanews.com/api/zy--yeqv$y";
const VOA_NEWS_SITEMAP_URL = "https://amharic.voanews.com/sitemap_404_news.xml.gz";

async function fetchPossiblyGzippedText(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentEncoding = response.headers.get("content-encoding")?.toLowerCase() ?? "";
  const isGzipped =
    contentEncoding.includes("gzip") || url.toLowerCase().endsWith(".gz");

  if (!isGzipped) {
    return buffer.toString("utf8");
  }

  return gunzipSync(buffer).toString("utf8");
}

function extractVoaNewsSitemapEntries(xml: string) {
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<news:publication_date>([^<]+)<\/news:publication_date>[\s\S]*?<news:title>([^<]+)<\/news:title>/g)]
    .map((match) => ({
      url: stripHtml(match[1]),
      publishedAt: new Date(match[2]).toISOString(),
      title: stripHtml(match[3]),
    }))
    .filter((entry) => entry.url && entry.publishedAt && entry.title);
}

async function extractVoaPageMeta(url: string, fallbackSnippet: string) {
  const html = await fetchText(url, {
    retries: 0,
    timeoutMs: 12_000,
  });
  const $ = load(html);
  const snippet = $(".body-container p, .wsw p, article p, p")
    .slice(0, 4)
    .toArray()
    .map((element) => $(element).text())
    .map((value) => stripHtml(value))
    .filter(
      (value) =>
        value.length > 24 &&
        !/^share$/i.test(value) &&
        !/^no media source currently available$/i.test(value),
    )
    .join(" ");

  return {
    snippet: snippet || fallbackSnippet,
    imageUrl: extractStoryImageUrlFromHtml(url, html),
  };
}

export const voaAmharicAdapter: SourceAdapter = {
  source: "VOA Amharic",
  async fetchItems() {
    const startedAt = Date.now();
    const attemptedAt = new Date(startedAt).toISOString();

    try {
      const [articleFeedXml, newsSitemapXml] = await Promise.all([
        fetchText(VOA_ETHIOPIA_RSS_URL),
        fetchPossiblyGzippedText(VOA_NEWS_SITEMAP_URL),
      ]);
      const feed = await parseRssFeed(articleFeedXml);
      const rssItems = (feed.items ?? [])
        .map((item) =>
          buildNormalizedItem({
            source: "VOA Amharic",
            title: item.title ?? "",
            url: item.link ?? "",
            imageUrl: extractRssItemImageUrl(item, item.link ?? VOA_ETHIOPIA_RSS_URL),
            publishedAt: item.pubDate
              ? new Date(item.pubDate).toISOString()
              : attemptedAt,
            attemptedAt,
            snippet: item.contentSnippet ?? item.content ?? item.title ?? "",
            section: item.categories?.[0] ?? "News",
            language: "Amharic",
            sourceType: "rss",
          }),
        )
        .filter((item) => item.url && item.title);
      const newsSitemapEntries = extractVoaNewsSitemapEntries(newsSitemapXml);
      const sitemapItems = await Promise.all(
        newsSitemapEntries.map(async (entry) => {
          const pageMeta = await extractVoaPageMeta(entry.url, entry.title);

          return buildNormalizedItem({
            source: "VOA Amharic",
            title: entry.title,
            url: entry.url,
            imageUrl: pageMeta.imageUrl,
            publishedAt: entry.publishedAt,
            attemptedAt,
            snippet: pageMeta.snippet,
            section: "News",
            language: "Amharic",
            sourceType: "html",
          });
        }),
      );
      const normalizedItems = [...rssItems, ...sitemapItems]
        .filter((item) => item.url && item.title)
        .sort((left, right) => {
          return (
            new Date(right.publishedAt).getTime() -
            new Date(left.publishedAt).getTime()
          );
        });

      return finalizeSourceResult({
        source: "VOA Amharic",
        sourceType: "html",
        normalizedItems,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        successNote:
          "VOA Amharic coverage is now combining the official Ethiopia/Eritrea RSS feed with the publisher news sitemap.",
        emptyNote:
          "VOA Amharic official feeds loaded, but no high-relevance Ethiopia items matched the current filter.",
        diagnostics: [
          `Checked ${VOA_ETHIOPIA_RSS_URL}.`,
          `Checked ${VOA_NEWS_SITEMAP_URL}.`,
        ],
      });
    } catch (error) {
      return buildSourceFailureResult({
        source: "VOA Amharic",
        sourceType: "html",
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  },
};
