import Parser from "rss-parser";

import type { SourceName } from "@/lib/dashboard";
import { fetchText } from "@/lib/news/http";
import { firstSentence, truncate } from "@/lib/news/text";

const parser = new Parser();

export interface GoogleNewsFallbackItem {
  title: string;
  url: string;
  publishedAt: string;
  snippet: string;
}

export async function fetchGoogleNewsFallback(
  source: SourceName,
  query: string,
): Promise<GoogleNewsFallbackItem[]> {
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query,
  )}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchText(feedUrl);
  const feed = await parser.parseString(xml);

  return (feed.items ?? [])
    .slice(0, 10)
    .map((item) => {
      const rawTitle = item.title?.trim() ?? "";
      const cleanedTitle = rawTitle
        .replace(/^News:\s*/i, "")
        .replace(new RegExp(`\\s+-\\s+${source}$`, "i"), "")
        .replace(/\s+-\s+[a-z0-9.-]+\.[a-z]{2,}$/i, "")
        .trim();

      return {
        title: cleanedTitle,
        url: item.link ?? "",
        publishedAt: item.pubDate
          ? new Date(item.pubDate).toISOString()
          : new Date().toISOString(),
        snippet: firstSentence(
          item.contentSnippet ?? item.content ?? cleanedTitle,
        ) || truncate(cleanedTitle, 180),
      };
    })
    .filter((item) => item.title && item.url);
}
