import { NextRequest, NextResponse } from "next/server";

import { redactDashboardDebug } from "@/lib/dashboard";
import {
  API_READ_RATE_LIMIT,
  API_READ_RATE_LIMIT_WINDOW_MS,
  API_REFRESH_RATE_LIMIT,
  API_REFRESH_RATE_LIMIT_WINDOW_MS,
  FORCE_REFRESH_COOLDOWN_MS,
} from "@/lib/news/constants";
import { getDashboardPayload } from "@/lib/news/aggregate";
import {
  getClientAddress,
  getRateLimitHeaders,
  isDebugRequestAllowed,
  isForceRefreshCoolingDown,
  isSameOriginMutation,
  markForceRefresh,
  takeRateLimitSlot,
} from "@/lib/news/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildResponseHeaders(extra: Record<string, string> = {}) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    ...extra,
  };
}

function buildErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Coverage refresh failed.";
}

function buildRateLimitExceededMessage(kind: "read" | "refresh") {
  return kind === "refresh"
    ? "Refresh temporarily rate limited. Showing the freshest available coverage."
    : "Coverage API temporarily rate limited.";
}

function buildReadRateLimitKey(request: NextRequest) {
  return `${getClientAddress(request)}:coverage:read`;
}

function buildRefreshRateLimitKey(request: NextRequest) {
  return `${getClientAddress(request)}:coverage:refresh`;
}

export async function GET(request: NextRequest) {
  const debugRequested =
    request.nextUrl.searchParams.get("debug") === "1" &&
    isDebugRequestAllowed();
  const rateLimit = takeRateLimitSlot(
    buildReadRateLimitKey(request),
    API_READ_RATE_LIMIT,
    API_READ_RATE_LIMIT_WINDOW_MS,
  );

  if (!rateLimit.allowed) {
    const payload = redactDashboardDebug(await getDashboardPayload());

    return NextResponse.json(
      {
        error: buildRateLimitExceededMessage("read"),
        data: payload,
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

  try {
    const payload = await getDashboardPayload();

    if (debugRequested) {
      const { getPersistedCoveragePath } = await import(
        "@/lib/news/persistence"
      );

      return NextResponse.json(
        {
          data: payload,
          debug: {
            persistedCachePath: getPersistedCoveragePath(),
          },
        },
        {
          headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
        },
      );
    }

    return NextResponse.json(
      { data: redactDashboardDebug(payload) },
      {
        headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: buildErrorMessage(error) },
      {
        status: 500,
        headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
      },
    );
  }
}

export async function POST(request: NextRequest) {
  const rateLimit = takeRateLimitSlot(
    buildRefreshRateLimitKey(request),
    API_REFRESH_RATE_LIMIT,
    API_REFRESH_RATE_LIMIT_WINDOW_MS,
  );

  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      {
        error: "Cross-origin refresh requests are not allowed.",
      },
      {
        status: 403,
        headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
      },
    );
  }

  if (!rateLimit.allowed) {
    const payload = redactDashboardDebug(await getDashboardPayload());

    return NextResponse.json(
      {
        error: buildRateLimitExceededMessage("refresh"),
        data: payload,
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

  if (isForceRefreshCoolingDown(FORCE_REFRESH_COOLDOWN_MS)) {
    const payload = redactDashboardDebug(await getDashboardPayload());

    return NextResponse.json(
      {
        data: payload,
        notice:
          "A live refresh ran recently. Showing the freshest cached coverage instead.",
      },
      {
        status: 202,
        headers: buildResponseHeaders({
          ...getRateLimitHeaders(rateLimit),
          "Retry-After": String(Math.ceil(FORCE_REFRESH_COOLDOWN_MS / 1000)),
        }),
      },
    );
  }

  markForceRefresh();

  try {
    const payload = redactDashboardDebug(await getDashboardPayload({ force: true }));

    return NextResponse.json(
      { data: payload },
      {
        headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: buildErrorMessage(error) },
      {
        status: 500,
        headers: buildResponseHeaders(getRateLimitHeaders(rateLimit)),
      },
    );
  }
}

export function OPTIONS(request: NextRequest) {
  const headers = buildResponseHeaders({
    Allow: "GET, POST, OPTIONS",
  });

  const method =
    request.headers.get("access-control-request-method") ?? request.method;

  return new NextResponse(null, {
    status: method ? 204 : 200,
    headers,
  });
}
