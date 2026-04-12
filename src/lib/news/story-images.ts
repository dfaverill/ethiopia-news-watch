import { load } from "cheerio";

import { sanitizeHttpUrl, stripHtml, toAbsoluteUrl } from "@/lib/news/text";

const ALLOWED_ARTICLE_HOST_SUFFIXES = [
  "news.google.com",
  "thereporterethiopia.com",
  "ena.et",
  "ethiopia-insight.com",
  "nebe.org.et",
  "voanews.com",
  "addisstandard.com",
] as const;

const ALLOWED_IMAGE_HOST_SUFFIXES = [
  "lh3.googleusercontent.com",
  "gdb.voanews.com",
  "i0.wp.com",
  "thereporterethiopia.com",
  "ena.et",
  "ethiopia-insight.com",
  "nebe.org.et",
  "voanews.com",
  "addisstandard.com",
] as const;

function hasAllowedHost(
  url: string,
  allowedHostSuffixes: readonly string[],
): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    return allowedHostSuffixes.some(
      (suffix) =>
        hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

function decodeEscapedAttributeUrl(input: string) {
  return stripHtml(input)
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
}

function normalizeImageCandidate(pageUrl: string, rawValue: string | null | undefined) {
  if (!rawValue) {
    return null;
  }

  const decodedValue = decodeEscapedAttributeUrl(rawValue);
  const absoluteUrl = toAbsoluteUrl(pageUrl, decodedValue);
  const sanitizedUrl = sanitizeHttpUrl(absoluteUrl);

  if (!sanitizedUrl || !hasAllowedHost(sanitizedUrl, ALLOWED_IMAGE_HOST_SUFFIXES)) {
    return null;
  }

  return sanitizedUrl;
}

export function isAllowedStoryImageUrl(url: string) {
  const sanitizedUrl = sanitizeHttpUrl(url);

  if (!sanitizedUrl) {
    return false;
  }

  return hasAllowedHost(sanitizedUrl, ALLOWED_IMAGE_HOST_SUFFIXES);
}

export function normalizeStoryImageUrl(
  pageUrl: string,
  rawValue: string | null | undefined,
) {
  return normalizeImageCandidate(pageUrl, rawValue);
}

function extractGoogleHostedImageUrls(html: string) {
  const matches =
    html.match(/https:\/\/lh3\.googleusercontent\.com\/[^"'<>\s]+/g) ?? [];

  return [...new Set(matches)]
    .map((value) => decodeEscapedAttributeUrl(value))
    .filter((value) => !/=w(16|24|32|48)\b/.test(value))
    .sort((left, right) => {
      const leftWidth = Number(left.match(/(?:=s\d+-w|=w)(\d+)/)?.[1] ?? 0);
      const rightWidth = Number(right.match(/(?:=s\d+-w|=w)(\d+)/)?.[1] ?? 0);

      return rightWidth - leftWidth;
    });
}

function getSrcsetCandidate(rawSrcset: string | null | undefined) {
  if (!rawSrcset) {
    return null;
  }

  const [firstCandidate] = rawSrcset
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return firstCandidate?.split(/\s+/)[0] ?? null;
}

export function isAllowedStoryArticleUrl(url: string) {
  const sanitizedUrl = sanitizeHttpUrl(url);

  if (!sanitizedUrl) {
    return false;
  }

  return hasAllowedHost(sanitizedUrl, ALLOWED_ARTICLE_HOST_SUFFIXES);
}

export function extractStoryImageUrlFromHtml(pageUrl: string, html: string) {
  const page = sanitizeHttpUrl(pageUrl);

  if (!page || !isAllowedStoryArticleUrl(page)) {
    return null;
  }

  const parsedUrl = new URL(page);

  if (parsedUrl.hostname === "news.google.com") {
    const [googleHostedImage] = extractGoogleHostedImageUrls(html);
    const sanitizedGoogleImage = normalizeImageCandidate(page, googleHostedImage);

    if (sanitizedGoogleImage) {
      return sanitizedGoogleImage;
    }
  }

  const $ = load(html);
  const rawCandidates = [
    $('meta[property="og:image"]').attr("content"),
    $('meta[property="og:image:url"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $('meta[property="twitter:image"]').attr("content"),
    $('link[rel="image_src"]').attr("href"),
    $(".wp-post-image").first().attr("src"),
    $("article img").first().attr("src"),
    $("main img").first().attr("src"),
    $("figure img").first().attr("src"),
    $(".entry-content img").first().attr("src"),
    $(".article img").first().attr("src"),
    $(".featured img").first().attr("src"),
    getSrcsetCandidate($("article img").first().attr("srcset")),
    getSrcsetCandidate($("main img").first().attr("srcset")),
  ];

  for (const rawCandidate of rawCandidates) {
    const normalizedCandidate = normalizeImageCandidate(page, rawCandidate);

    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return null;
}

function buildGoogleNewsDecoderPayload(
  articleId: string,
  timestamp: string,
  signature: string,
) {
  return `["garturlreq",[[\"X\",\"X\",[\"X\",\"X\"],null,null,1,1,\"US:en\",null,1,null,null,null,null,null,0,1],\"X\",\"X\",1,[1,1,1],1,1,null,0,0,null,0],\"${articleId}\",${timestamp},\"${signature}\"]`;
}

export function parseGoogleNewsDecodedUrlResponse(responseText: string) {
  const batchJsonText = responseText.split("\n\n")[1];

  if (!batchJsonText) {
    return null;
  }

  try {
    const batchJson = JSON.parse(batchJsonText) as unknown[];

    for (const entry of batchJson) {
      if (!Array.isArray(entry) || entry[0] !== "wrb.fr") {
        continue;
      }

      const payload = entry[2];

      if (typeof payload !== "string") {
        continue;
      }

      const parsedPayload = JSON.parse(payload) as unknown[];

      if (
        Array.isArray(parsedPayload) &&
        parsedPayload[0] === "garturlres" &&
        typeof parsedPayload[1] === "string"
      ) {
        return sanitizeHttpUrl(parsedPayload[1]);
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function decodeGoogleNewsArticleUrl(
  sourceUrl: string,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
) {
  const parsedSourceUrl = new URL(sourceUrl);
  const articleId = parsedSourceUrl.pathname.split("/").pop();

  if (!articleId) {
    return null;
  }

  const articlePageResponse = await fetchImpl(
    `https://news.google.com/rss/articles/${articleId}`,
    {
      headers,
      redirect: "follow",
    },
  );

  if (!articlePageResponse.ok) {
    return null;
  }

  const articlePageHtml = await articlePageResponse.text();
  const timestamp = articlePageHtml.match(/data-n-a-ts="(\d+)"/)?.[1];
  const signature = articlePageHtml.match(/data-n-a-sg="([^"]+)"/)?.[1];

  if (!timestamp || !signature) {
    return null;
  }

  const body = new URLSearchParams({
    "f.req": JSON.stringify([
      [
        [
          "Fbv4je",
          buildGoogleNewsDecoderPayload(articleId, timestamp, signature),
          null,
          "generic",
        ],
      ],
    ]),
  });
  const decodeResponse = await fetchImpl(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute",
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    },
  );

  if (!decodeResponse.ok) {
    return null;
  }

  return parseGoogleNewsDecodedUrlResponse(await decodeResponse.text());
}
