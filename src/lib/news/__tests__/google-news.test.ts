import { describe, expect, it } from "vitest";

import {
  dedupeGoogleNewsFallbackItems,
  type GoogleNewsFallbackItem,
} from "@/lib/news/google-news";

describe("Google News fallback helpers", () => {
  it("dedupes overlapping publisher-search items while preserving order", () => {
    const items: GoogleNewsFallbackItem[] = [
      {
        title: "National Bank lists 23 unauthorized money transfer providers",
        url: "https://news.google.com/rss/articles/a1",
        publishedAt: "2026-04-04T06:53:13.000Z",
        snippet: "First copy",
      },
      {
        title: "National Bank lists 23 unauthorized money transfer providers",
        url: "https://news.google.com/rss/articles/a1",
        publishedAt: "2026-04-04T06:53:13.000Z",
        snippet: "Duplicate copy",
      },
      {
        title: "Gold exports surge to $3.5 billion as Ethiopia pivots toward mining-led growth",
        url: "https://news.google.com/rss/articles/a2",
        publishedAt: "2026-04-01T08:26:04.000Z",
        snippet: "Distinct copy",
      },
    ];

    expect(dedupeGoogleNewsFallbackItems(items)).toEqual([
      items[0],
      items[2],
    ]);
  });
});
