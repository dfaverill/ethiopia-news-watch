import { NextRequest, NextResponse } from "next/server";

import {
  getCurrentPodcastArchiveExclusions,
  listPodcastArchiveCollections,
} from "@/lib/podcast-archive";
import {
  getClientAddress,
  getRateLimitHeaders,
  takeRateLimitSlot,
} from "@/lib/news/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ARCHIVE_READ_RATE_LIMIT = 60;
const ARCHIVE_READ_WINDOW_MS = 60 * 1000;

function buildResponseHeaders(extra: Record<string, string> = {}) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    ...extra,
  };
}

function buildReadRateLimitKey(request: NextRequest) {
  return `${getClientAddress(request)}:podcast:archive:read`;
}

export async function GET(request: NextRequest) {
  const rateLimit = takeRateLimitSlot(
    buildReadRateLimitKey(request),
    ARCHIVE_READ_RATE_LIMIT,
    ARCHIVE_READ_WINDOW_MS,
  );

  const exclusions = await getCurrentPodcastArchiveExclusions();

  const data = await listPodcastArchiveCollections({
    currentNotebookLmJobKeys: exclusions.currentNotebookLmJobKeys,
    currentElevenLabsJobKey: exclusions.currentElevenLabsJobKey,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        data,
        error: "Past podcast archive requests are temporarily rate limited.",
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
    { data },
    {
      headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
    },
  );
}
