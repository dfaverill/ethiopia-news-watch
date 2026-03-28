import {
  EMPTY_DASHBOARD_PAYLOAD,
  type CacheSource,
  type DashboardPayload,
  type RefreshMeta,
} from "@/lib/dashboard";
import { CACHE_TTL_MS, PERSISTED_CACHE_SCHEMA_VERSION } from "@/lib/news/constants";
import {
  buildLatestBySource,
  buildSourceDebugSummaries,
  buildSourceStatuses,
  dedupeItems,
  groupStorylines,
} from "@/lib/news/grouping";
import { logNewsEvent } from "@/lib/news/logger";
import {
  loadPersistedCoverageState,
  savePersistedCoverageState,
} from "@/lib/news/persistence";
import { sourceAdapters } from "@/lib/news/sources";
import {
  buildSourceFailureResult,
  withCachedSourceResult,
} from "@/lib/news/sources/helpers";
import type {
  PersistedCoverageState,
  SourceAdapter,
  SourceFetchResult,
} from "@/lib/news/types";

let inMemoryState: PersistedCoverageState | null = null;
let inMemoryLoaded = false;
let inMemoryStateOrigin: CacheSource = "memory";
let inFlightPayload: Promise<DashboardPayload> | null = null;

function getLatestArticleTimestamp(sourceResults: SourceFetchResult[]) {
  const latestTimestamp = sourceResults
    .flatMap((result) => result.items)
    .map((item) => new Date(item.publishedAt).getTime())
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left)[0];

  return latestTimestamp ? new Date(latestTimestamp).toISOString() : null;
}

function computeStaleMinutes(reference: string | null) {
  if (!reference) {
    return null;
  }

  const timestamp = new Date(reference).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(Math.round((Date.now() - timestamp) / 60_000), 0);
}

function isFresh(cachedAt: string | null) {
  if (!cachedAt) {
    return false;
  }

  const timestamp = new Date(cachedAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < CACHE_TTL_MS;
}

async function ensureStateLoaded() {
  if (inMemoryLoaded) {
    return inMemoryState;
  }

  inMemoryState = await loadPersistedCoverageState();
  inMemoryStateOrigin = inMemoryState ? "disk" : "memory";
  inMemoryLoaded = true;
  return inMemoryState;
}

function withDeliveryMetadata(
  payload: DashboardPayload,
  cacheSource: CacheSource,
  cachedAt: string | null,
  message?: string | null,
): DashboardPayload {
  return {
    ...payload,
    refresh: {
      ...payload.refresh,
      cacheSource,
      cachedAt,
      staleMinutes: computeStaleMinutes(payload.refresh.successfulAt),
      message: message ?? payload.refresh.message,
    },
  };
}

function buildPayloadFromSourceResults(
  sourceResults: SourceFetchResult[],
  refresh: RefreshMeta,
): DashboardPayload {
  const normalizedItems = dedupeItems(sourceResults.flatMap((result) => result.items));
  const storylines = groupStorylines(normalizedItems, sourceResults);
  const latestBySource = buildLatestBySource(sourceResults);
  const sourceStatus = buildSourceStatuses(sourceResults);
  const lastUpdated = getLatestArticleTimestamp(sourceResults) ?? refresh.successfulAt;

  return {
    generatedAt: refresh.attemptedAt,
    lastUpdated,
    storylines,
    latestBySource,
    sourceStatus,
    refresh: {
      ...refresh,
      staleMinutes: computeStaleMinutes(refresh.successfulAt),
    },
    meta: {
      totalNormalizedItems: normalizedItems.length,
      successfulSources: sourceResults.filter((result) => result.status === "online")
        .length,
      degradedSources: sourceResults.filter((result) => result.status === "degraded")
        .length,
      failedSources: sourceResults.filter((result) => result.status === "failed").length,
    },
    debug: {
      sourceSummaries: buildSourceDebugSummaries(sourceResults),
    },
  };
}

function buildPreviousPayloadFallback(
  previousState: PersistedCoverageState,
  attemptedAt: string,
  message: string,
): DashboardPayload {
  return {
    ...previousState.payload,
    generatedAt: attemptedAt,
    refresh: {
      ...previousState.payload.refresh,
      attemptedAt,
      mode: "cached",
      cacheSource: "persisted-fallback",
      cachedAt: previousState.cachedAt,
      partialFailure: true,
      staleMinutes: computeStaleMinutes(previousState.lastSuccessfulRefreshAt),
      message,
    },
  };
}

async function saveState(state: PersistedCoverageState) {
  await savePersistedCoverageState(state);
  inMemoryState = state;
  inMemoryStateOrigin = "memory";
  inMemoryLoaded = true;
}

function fallbackForUnexpectedError(
  adapter: SourceAdapter,
  attemptedAt: string,
  error: unknown,
): SourceFetchResult {
  return buildSourceFailureResult({
    source: adapter.source,
    sourceType: "html",
    attemptedAt,
    durationMs: 0,
    error,
  });
}

function mergeWithPreviousSourceResults(
  sourceResults: SourceFetchResult[],
  previousState: PersistedCoverageState | null,
  attemptedAt: string,
) {
  if (!previousState) {
    return sourceResults;
  }

  const previousBySource = new Map(
    previousState.sourceResults.map((result) => [result.source, result]),
  );

  return sourceResults.map((result) => {
    if (result.status !== "failed") {
      return result;
    }

    const staleResult = previousBySource.get(result.source);
    if (!staleResult || staleResult.items.length === 0) {
      return result;
    }

    return withCachedSourceResult(staleResult, attemptedAt, result);
  });
}

async function refreshLiveState(
  previousState: PersistedCoverageState | null,
): Promise<DashboardPayload> {
  const startedAt = Date.now();
  const attemptedAt = new Date(startedAt).toISOString();

  logNewsEvent("info", "refresh_started", {
    attemptedAt,
    sourceCount: sourceAdapters.length,
  });

  const settledResults = await Promise.allSettled(
    sourceAdapters.map((adapter) => adapter.fetchItems()),
  );

  const rawSourceResults = settledResults.map((result, index) => {
    const adapter = sourceAdapters[index];

    if (result.status === "fulfilled") {
      return result.value;
    }

    return fallbackForUnexpectedError(adapter, attemptedAt, result.reason);
  });

  const mergedSourceResults = mergeWithPreviousSourceResults(
    rawSourceResults,
    previousState,
    attemptedAt,
  );

  const usableSourceCount = mergedSourceResults.filter((result) => result.items.length > 0)
    .length;
  const usedCachedSources = mergedSourceResults.filter((result) => result.usedCachedItems)
    .length;
  const partialFailure = mergedSourceResults.some((result) => result.status !== "online");
  const successfulAt =
    usableSourceCount > 0
      ? attemptedAt
      : previousState?.lastSuccessfulRefreshAt ?? attemptedAt;

  if (usableSourceCount === 0 && previousState) {
    const fallbackPayload = buildPreviousPayloadFallback(
      previousState,
      attemptedAt,
      "Live refresh did not produce usable Ethiopia coverage. Showing the last successful dashboard snapshot.",
    );

    await saveState({
      ...previousState,
      cachedAt: attemptedAt,
      lastAttemptedRefreshAt: attemptedAt,
      payload: fallbackPayload,
    });

    logNewsEvent("warn", "refresh_fell_back_to_previous_payload", {
      attemptedAt,
      durationMs: Date.now() - startedAt,
    });

    return fallbackPayload;
  }

  const mode =
    usedCachedSources > 0
      ? mergedSourceResults.some((result) => result.status === "online")
        ? "mixed"
        : "cached"
      : "live";

  const refresh: RefreshMeta = {
    attemptedAt,
    successfulAt,
    mode,
    cacheSource: "network",
    cachedAt: attemptedAt,
    staleMinutes: null,
    partialFailure,
    usedCachedSources,
    message:
      usedCachedSources > 0
        ? `Using cached source data for ${usedCachedSources} source${usedCachedSources === 1 ? "" : "s"} after live refresh failures.`
        : partialFailure
          ? "Some sources were degraded during the latest refresh, but the dashboard remains usable."
          : null,
  };

  const payload = buildPayloadFromSourceResults(mergedSourceResults, refresh);
  const state: PersistedCoverageState = {
    schemaVersion: PERSISTED_CACHE_SCHEMA_VERSION,
    cachedAt: attemptedAt,
    lastAttemptedRefreshAt: attemptedAt,
    lastSuccessfulRefreshAt: successfulAt,
    payload,
    sourceResults: mergedSourceResults,
  };

  await saveState(state);

  logNewsEvent("info", "refresh_completed", {
    attemptedAt,
    durationMs: Date.now() - startedAt,
    mode,
    partialFailure,
    usedCachedSources,
    storylines: payload.storylines.length,
    normalizedItems: payload.meta.totalNormalizedItems,
  });

  return payload;
}

export async function getDashboardPayload(options?: {
  force?: boolean;
}): Promise<DashboardPayload> {
  const force = options?.force ?? false;
  const state = await ensureStateLoaded();

  if (!force && state && isFresh(state.cachedAt)) {
    const cacheSource = inMemoryStateOrigin;
    logNewsEvent("info", "cache_hit", {
      cacheSource,
      cachedAt: state.cachedAt,
    });
    return withDeliveryMetadata(state.payload, cacheSource, state.cachedAt);
  }

  if (inFlightPayload) {
    return inFlightPayload;
  }

  inFlightPayload = refreshLiveState(state)
    .catch((error) => {
      logNewsEvent("error", "refresh_unhandled_failure", {
        message: error instanceof Error ? error.message : "Unknown refresh failure",
      });

      if (state) {
        return buildPreviousPayloadFallback(
          state,
          new Date().toISOString(),
          "Refresh failed unexpectedly. Showing the last successful dashboard snapshot.",
        );
      }

      const nowIso = new Date().toISOString();
      return {
        ...EMPTY_DASHBOARD_PAYLOAD,
        generatedAt: nowIso,
        lastUpdated: nowIso,
        refresh: {
          ...EMPTY_DASHBOARD_PAYLOAD.refresh,
          attemptedAt: nowIso,
          successfulAt: nowIso,
          message: "Refresh failed and no persisted coverage snapshot was available.",
        },
      };
    })
    .finally(() => {
      inFlightPayload = null;
    });

  return inFlightPayload;
}
