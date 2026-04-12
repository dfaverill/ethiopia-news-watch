import Parser from "rss-parser";

import type { SourceName } from "@/lib/dashboard";
import { fetchText } from "@/lib/news/http";
import { firstSentence, truncate } from "@/lib/news/text";
import { extractRssItemImageUrl } from "@/lib/news/sources/helpers";

const parser = new Parser();

export interface GoogleNewsFallbackItem {
  title: string;
  url: string;
  imageUrl?: string | null;
  publishedAt: string;
  snippet: string;
}

export function dedupeGoogleNewsFallbackItems(
  items: GoogleNewsFallbackItem[],
): GoogleNewsFallbackItem[] {
  const seenKeys = new Set<string>();
  const deduped: GoogleNewsFallbackItem[] = [];

  for (const item of items) {
    const key = `${item.title.trim().toLowerCase()}|${item.url.trim()}`;
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    deduped.push(item);
  }

  return deduped;
}

export async function fetchGoogleNewsFallback(
  source: SourceName,
  query: string | string[],
): Promise<GoogleNewsFallbackItem[]> {
  const queries = Array.isArray(query) ? query : [query];
  const feeds = await Promise.all(
    queries.map(async (currentQuery) => {
      const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
        currentQuery,
      )}&hl=en-US&gl=US&ceid=US:en`;
      const xml = await fetchText(feedUrl);
      const feed = await parser.parseString(xml);

      return (feed.items ?? []).map((item) => {
        const rawTitle = item.title?.trim() ?? "";
        const cleanedTitle = rawTitle
          .replace(/^News:\s*/i, "")
          .replace(new RegExp(`\\s+-\\s+${source}$`, "i"), "")
          .replace(/\s+-\s+[a-z0-9.-]+\.[a-z]{2,}$/i, "")
          .trim();

        return {
          title: cleanedTitle,
          url: item.link ?? "",
          imageUrl: extractRssItemImageUrl(item, item.link ?? feedUrl),
          publishedAt: item.pubDate
            ? new Date(item.pubDate).toISOString()
            : new Date().toISOString(),
          snippet: firstSentence(
            item.contentSnippet ?? item.content ?? cleanedTitle,
          ) || truncate(cleanedTitle, 180),
        } satisfies GoogleNewsFallbackItem;
      });
    }),
  );

  return dedupeGoogleNewsFallbackItems(feeds.flat())
    .filter((item) => item.title && item.url)
    .slice(0, 20);
}
