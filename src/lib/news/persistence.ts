import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { PERSISTED_CACHE_SCHEMA_VERSION } from "@/lib/news/constants";
import { logNewsEvent } from "@/lib/news/logger";
import type { PersistedCoverageState } from "@/lib/news/types";

const CACHE_DIRECTORY = process.env.NEWS_WATCH_CACHE_DIR || ".cache";
const STATE_FILE = path.join(CACHE_DIRECTORY, "coverage-state.json");
const TEMP_STATE_FILE = path.join(CACHE_DIRECTORY, "coverage-state.tmp.json");

function isPersistedCoverageState(
  value: unknown,
): value is PersistedCoverageState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === PERSISTED_CACHE_SCHEMA_VERSION &&
    typeof candidate.cachedAt === "string" &&
    typeof candidate.lastAttemptedRefreshAt === "string" &&
    typeof candidate.lastSuccessfulRefreshAt === "string" &&
    Array.isArray(candidate.sourceResults) &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}

export async function loadPersistedCoverageState(): Promise<PersistedCoverageState | null> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isPersistedCoverageState(parsed)) {
      logNewsEvent("warn", "cache_invalid_shape", {
        path: STATE_FILE,
      });
      return null;
    }

    logNewsEvent("info", "cache_loaded", {
      path: STATE_FILE,
      cachedAt: parsed.cachedAt,
      sourceCount: parsed.sourceResults.length,
    });

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      logNewsEvent("warn", "cache_load_failed", {
        path: STATE_FILE,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return null;
  }
}

export async function savePersistedCoverageState(
  state: PersistedCoverageState,
): Promise<void> {
  try {
    await mkdir(CACHE_DIRECTORY, { recursive: true });
    await writeFile(TEMP_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
    await rename(TEMP_STATE_FILE, STATE_FILE);

    logNewsEvent("info", "cache_saved", {
      path: STATE_FILE,
      cachedAt: state.cachedAt,
      sourceCount: state.sourceResults.length,
    });
  } catch (error) {
    logNewsEvent("warn", "cache_save_failed", {
      path: STATE_FILE,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function clearPersistedCoverageState(): Promise<void> {
  try {
    await unlink(STATE_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

export function getPersistedCoveragePath() {
  return STATE_FILE;
}
