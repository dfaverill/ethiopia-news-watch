import type { NextRequest } from "next/server";

declare global {
  var __ethiopiaNewsWatchRateLimitStore:
    | Map<string, { count: number; resetAt: number }>
    | undefined;
  var __ethiopiaNewsWatchLastForceRefreshAt: number | undefined;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

function getRateLimitStore() {
  if (!globalThis.__ethiopiaNewsWatchRateLimitStore) {
    globalThis.__ethiopiaNewsWatchRateLimitStore = new Map();
  }

  return globalThis.__ethiopiaNewsWatchRateLimitStore;
}

function cleanupExpiredEntries(now: number) {
  const store = getRateLimitStore();

  if (store.size < 512) {
    return;
  }

  store.forEach((value, key) => {
    if (value.resetAt <= now) {
      store.delete(key);
    }
  });
}

export function takeRateLimitSlot(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitDecision {
  cleanupExpiredEntries(now);

  const store = getRateLimitStore();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + windowMs,
    };

    store.set(key, next);

    return {
      allowed: true,
      limit,
      remaining: Math.max(limit - 1, 0),
      resetAt: next.resetAt,
      retryAfterSeconds: Math.max(Math.ceil(windowMs / 1000), 1),
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(
        Math.ceil((existing.resetAt - now) / 1000),
        1,
      ),
    };
  }

  existing.count += 1;
  store.set(key, existing);

  return {
    allowed: true,
    limit,
    remaining: Math.max(limit - existing.count, 0),
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.max(
      Math.ceil((existing.resetAt - now) / 1000),
      1,
    ),
  };
}

export function getRateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.ceil(decision.resetAt / 1000)),
  };
}

export function getClientAddress(
  request: Pick<NextRequest, "headers">,
): string {
  const forwardedFor =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-vercel-forwarded-for");

  if (!forwardedFor) {
    return "unknown";
  }

  return forwardedFor.split(",")[0]?.trim() || "unknown";
}

export function isSameOriginMutation(
  request: Pick<NextRequest, "headers">,
): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (!origin || !host) {
    return false;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isDebugRequestAllowed() {
  return process.env.NODE_ENV !== "production";
}

export function isForceRefreshCoolingDown(
  cooldownMs: number,
  now = Date.now(),
): boolean {
  const lastRefreshAt = globalThis.__ethiopiaNewsWatchLastForceRefreshAt ?? 0;
  return now - lastRefreshAt < cooldownMs;
}

export function markForceRefresh(now = Date.now()) {
  globalThis.__ethiopiaNewsWatchLastForceRefreshAt = now;
}

export function resetApiSecurityStateForTests() {
  getRateLimitStore().clear();
  globalThis.__ethiopiaNewsWatchLastForceRefreshAt = 0;
}
