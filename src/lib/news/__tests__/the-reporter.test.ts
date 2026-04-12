import { beforeEach, describe, expect, it, vi } from "vitest";

import { FetchHttpError } from "@/lib/news/http";

const { fetchText } = vi.hoisted(() => ({
  fetchText: vi.fn(),
}));

vi.mock("@/lib/news/http", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/news/http")>(
      "@/lib/news/http",
    );

  return {
    ...actual,
    fetchText,
  };
});

import { reporterAdapter } from "@/lib/news/sources/the-reporter";

const REPORTER_RSS = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>The Reporter Ethiopia</title>
    <item>
      <title>Council of Ministers extends Tigray Interim Admin term by one year</title>
      <link>https://www.thereporterethiopia.com/50140/</link>
      <pubDate>Wed, 08 Apr 2026 07:11:13 GMT</pubDate>
      <description>The Ethiopian Council of Ministers has extended the term of Tigray Interim Administration by one additional year.</description>
      <category>Politics</category>
    </item>
  </channel>
</rss>`;

describe("The Reporter source adapter", () => {
  beforeEach(() => {
    fetchText.mockReset();
  });

  it("falls back to the sitewide official feed when the latest-news feed fails", async () => {
    fetchText.mockImplementation(async (url: string) => {
      if (url.includes("/latest-news-in-ethiopia/feed/")) {
        throw new FetchHttpError(url, 502, 2);
      }

      if (url.includes("https://www.thereporterethiopia.com/feed/")) {
        return REPORTER_RSS;
      }

      throw new Error(`Unexpected Reporter URL ${url}`);
    });

    const result = await reporterAdapter.fetchItems();

    expect(result.status).toBe("online");
    expect(result.healthKind).toBe("healthy");
    expect(result.usedCachedItems).toBe(false);
    expect(result.note).toContain("public sitewide feed");
    expect(result.diagnostics.join(" ")).toContain(
      "Reporter latest-news feed failed, so the app recovered through the official sitewide feed.",
    );
    expect(result.items).toHaveLength(1);
  });
});
