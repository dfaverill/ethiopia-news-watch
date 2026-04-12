import { NextRequest, NextResponse } from "next/server";

import {
  getElevenLabsRecentPodcastPublicState,
  startElevenLabsRecentPodcastGeneration,
} from "@/lib/elevenlabs-podcast";
import {
  getClientAddress,
  getRateLimitHeaders,
  isSameOriginMutation,
  takeRateLimitSlot,
} from "@/lib/news/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PODCAST_READ_RATE_LIMIT = 90;
const PODCAST_READ_WINDOW_MS = 60 * 1000;
const PODCAST_START_RATE_LIMIT = 8;
const PODCAST_START_WINDOW_MS = 10 * 60 * 1000;

function buildResponseHeaders(extra: Record<string, string> = {}) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    ...extra,
  };
}

function buildReadRateLimitKey(request: NextRequest) {
  return `${getClientAddress(request)}:podcast:elevenlabs:read`;
}

function buildStartRateLimitKey(request: NextRequest) {
  return `${getClientAddress(request)}:podcast:elevenlabs:start`;
}

export async function GET(request: NextRequest) {
  const rateLimit = takeRateLimitSlot(
    buildReadRateLimitKey(request),
    PODCAST_READ_RATE_LIMIT,
    PODCAST_READ_WINDOW_MS,
  );
  const state = await getElevenLabsRecentPodcastPublicState();

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        data: state,
        error: "Scripted podcast status polling is temporarily rate limited.",
      },
      {
        status: 429,
        headers: buildResponseHeaders({
          ...getRateLimitHeaders(rateLimit),
          "Retry-After": String(rateLimit.retryAfterSeconds),
        }),
      },
    );
  }

  return NextResponse.json(
    { data: state },
    {
      headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
    },
  );
}

export async function POST(request: NextRequest) {
  const rateLimit = takeRateLimitSlot(
    buildStartRateLimitKey(request),
    PODCAST_START_RATE_LIMIT,
    PODCAST_START_WINDOW_MS,
  );

  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      {
        error: "Cross-origin scripted podcast requests are not allowed.",
      },
      {
        status: 403,
        headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
      },
    );
  }

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        data: await getElevenLabsRecentPodcastPublicState(),
        error: "Scripted podcast generation is temporarily rate limited.",
      },
      {
        status: 429,
        headers: buildResponseHeaders({
          ...getRateLimitHeaders(rateLimit),
          "Retry-After": String(rateLimit.retryAfterSeconds),
        }),
      },
    );
  }

  const force = request.nextUrl.searchParams.get("force") === "1";
  const result = await startElevenLabsRecentPodcastGeneration({ force });

  return NextResponse.json(
    {
      data: result.state,
      notice: result.notice,
      started: result.started,
    },
    {
      headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
    },
  );
}

export function OPTIONS(request: NextRequest) {
  const method =
    request.headers.get("access-control-request-method") ?? request.method;

  return new NextResponse(null, {
    status: method ? 204 : 200,
    headers: buildResponseHeaders({
      Allow: "GET, POST, OPTIONS",
    }),
  });
}
