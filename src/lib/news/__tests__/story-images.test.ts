import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodeGoogleNewsArticleUrl,
  extractStoryImageUrlFromHtml,
  parseGoogleNewsDecodedUrlResponse,
} from "@/lib/news/story-images";

describe("extractStoryImageUrlFromHtml", () => {
  it("keeps the full Google-hosted image URL for news.google.com article pages", () => {
    const articleUrl =
      "https://news.google.com/rss/articles/example?hl=en-US&gl=US&ceid=US:en";
    const imageUrl =
      "https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc=s0-w300";
    const html = `<html><body><img src="${imageUrl}" /></body></html>`;

    expect(extractStoryImageUrlFromHtml(articleUrl, html)).toBe(imageUrl);
  });

  it("parses the decoded publisher URL from batchexecute responses", () => {
    const responseText =
      `)]}'\n\n` +
      JSON.stringify([
        [
          "wrb.fr",
          "Fbv4je",
          JSON.stringify([
            "garturlres",
            "https://addisstandard.com/example-story/",
            1,
            "https://addisstandard.com/example-story/",
          ]),
          null,
          null,
          null,
          "generic",
        ],
      ]);

    expect(parseGoogleNewsDecodedUrlResponse(responseText)).toBe(
      "https://addisstandard.com/example-story/",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decodes Google News wrapper URLs into the original publisher URL", async () => {
    const wrappedUrl =
      "https://news.google.com/rss/articles/CBMiExample?hl=en-US&gl=US&ceid=US:en";
    const pageHtml =
      '<div data-n-a-ts="1775616976" data-n-a-sg="AXDDbqExample"></div>';
    const batchResponse =
      `)]}'\n\n` +
      JSON.stringify([
        [
          "wrb.fr",
          "Fbv4je",
          JSON.stringify([
            "garturlres",
            "https://addisstandard.com/example-story/",
            1,
            "https://addisstandard.com/example-story/",
          ]),
          null,
          null,
          null,
          "generic",
        ],
      ]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => pageHtml,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => batchResponse,
      } as Response);

    await expect(
      decodeGoogleNewsArticleUrl(wrappedUrl, fetchMock, {
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US,en;q=0.9",
      }),
    ).resolves.toBe("https://addisstandard.com/example-story/");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
