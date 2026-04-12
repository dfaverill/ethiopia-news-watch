import { NextRequest, NextResponse } from "next/server";

import {
  decodeGoogleNewsArticleUrl,
  extractStoryImageUrlFromHtml,
  isAllowedStoryArticleUrl,
  isAllowedStoryImageUrl,
} from "@/lib/news/story-images";
import { sanitizeHttpUrl } from "@/lib/news/text";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STORY_IMAGE_CACHE_CONTROL =
  "private, max-age=21600, stale-while-revalidate=86400";
const STORY_IMAGE_BACKGROUND_CACHE_CONTROL =
  "private, max-age=3600, stale-while-revalidate=86400";
const STORY_IMAGE_HTML_TIMEOUT_MS = 3500;
const STORY_IMAGE_BINARY_TIMEOUT_MS = 8000;

function buildFetchHeaders() {
  return {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
  };
}

function buildOpenGraphHeaders() {
  return {
    "user-agent": "facebookexternalhit/1.1",
    "accept-language": "en-US,en;q=0.9",
  };
}

function buildTwitterBotHeaders() {
  return {
    "user-agent": "Twitterbot/1.0",
    "accept-language": "en-US,en;q=0.9",
  };
}

function buildHeaderFallbacks() {
  return [buildFetchHeaders(), buildOpenGraphHeaders(), buildTwitterBotHeaders()];
}

async function fetchArticlePageHtml(url: string) {
  const headerSets = buildHeaderFallbacks();

  for (const headers of headerSets) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers,
        redirect: "follow",
        next: { revalidate: 1800 },
        signal: AbortSignal.timeout(STORY_IMAGE_HTML_TIMEOUT_MS),
      });
    } catch {
      continue;
    }

    if (!response.ok) {
      continue;
    }

    return {
      url: response.url || url,
      html: await response.text(),
    };
  }

  return null;
}

async function fetchImageResponse(url: string) {
  const headerSets = buildHeaderFallbacks();

  for (const headers of headerSets) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers,
        redirect: "follow",
        next: { revalidate: 21600 },
        signal: AbortSignal.timeout(STORY_IMAGE_BINARY_TIMEOUT_MS),
      });
    } catch {
      continue;
    }

    if (response.ok) {
      return response;
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const articleParam = request.nextUrl.searchParams.get("article");
  const articleUrl = sanitizeHttpUrl(articleParam);
  const directImageParam = request.nextUrl.searchParams.get("image");
  const directImageUrl = sanitizeHttpUrl(directImageParam);
  const variant = request.nextUrl.searchParams.get("variant");
  const hasAllowedDirectImage = !!directImageUrl && isAllowedStoryImageUrl(directImageUrl);

  if (!hasAllowedDirectImage && (!articleUrl || !isAllowedStoryArticleUrl(articleUrl))) {
    return new NextResponse("Unsupported story URL.", { status: 400 });
  }

  try {
    let imageResponse = hasAllowedDirectImage
      ? await fetchImageResponse(directImageUrl)
      : null;

    if (!imageResponse && articleUrl) {
      let extractedImageUrl: string | null = null;
      const isGoogleNewsArticle = new URL(articleUrl).hostname === "news.google.com";

      const resolvedArticleUrl = isGoogleNewsArticle
        ? (await decodeGoogleNewsArticleUrl(
            articleUrl,
            fetch,
            buildFetchHeaders(),
          )) ?? articleUrl
        : articleUrl;

      if (resolvedArticleUrl !== articleUrl || !isGoogleNewsArticle) {
        const articlePage = await fetchArticlePageHtml(resolvedArticleUrl);

        if (articlePage) {
          extractedImageUrl = extractStoryImageUrlFromHtml(
            articlePage.url,
            articlePage.html,
          );
        }
      }

      if (!extractedImageUrl && isGoogleNewsArticle) {
        const googleNewsPage = await fetchArticlePageHtml(articleUrl);

        if (googleNewsPage) {
          extractedImageUrl = extractStoryImageUrlFromHtml(
            googleNewsPage.url,
            googleNewsPage.html,
          );
        }
      }

      if (!extractedImageUrl) {
        return new NextResponse("Story image unavailable.", { status: 404 });
      }

      imageResponse = await fetchImageResponse(extractedImageUrl);
    }

    if (!imageResponse) {
      return new NextResponse("Story image unavailable.", { status: 404 });
    }

    const contentType = imageResponse.headers.get("content-type") ?? "image/jpeg";
    const imageBuffer = await imageResponse.arrayBuffer();

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Cache-Control":
          variant === "background"
            ? STORY_IMAGE_BACKGROUND_CACHE_CONTROL
            : STORY_IMAGE_CACHE_CONTROL,
        "Content-Type": contentType,
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    return new NextResponse("Story image unavailable.", { status: 404 });
  }
}
