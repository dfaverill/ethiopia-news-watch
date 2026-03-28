export const SOURCE_NAMES = [
  "Reuters",
  "Addis Standard",
  "The Reporter Ethiopia",
  "Ethiopia Insight",
  "ENA",
  "NEBE",
  "VOA Amharic",
] as const;

export const SOURCE_OPTIONS = ["All sources", ...SOURCE_NAMES] as const;

export const TOPIC_NAMES = [
  "Politics",
  "Election",
  "Conflict",
  "Diplomacy",
  "Economy",
  "Humanitarian",
] as const;

export const TOPIC_OPTIONS = ["All topics", ...TOPIC_NAMES] as const;

export const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "widest", label: "Most compared" },
] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];
export type SourceFilter = (typeof SOURCE_OPTIONS)[number];
export type TopicName = (typeof TOPIC_NAMES)[number];
export type TopicFilter = (typeof TOPIC_OPTIONS)[number];
export type SortValue = (typeof SORT_OPTIONS)[number]["value"];
export type CoverageRowState = "covered" | "watching" | "limited";
export type SourceStatusState = "online" | "degraded" | "failed";
export type LanguageLabel = "English" | "Amharic";
export type SourceHealthKind =
  | "healthy"
  | "fallback"
  | "cached"
  | "timed-out"
  | "http-error"
  | "parse-error"
  | "network-error"
  | "no-matches"
  | "failed";
export type RefreshMode = "live" | "mixed" | "cached";
export type CacheSource = "network" | "memory" | "disk" | "persisted-fallback";

export interface StorylineSourceRow {
  source: SourceName;
  title: string;
  angle: string;
  language: LanguageLabel;
  state: CoverageRowState;
  updatedAt: string;
  url: string | null;
  sourceType: string;
  healthKind: SourceHealthKind;
  usedCachedItems: boolean;
}

export interface DashboardStoryline {
  id: string;
  headline: string;
  summary: string;
  topics: TopicName[];
  updatedAt: string;
  sources: StorylineSourceRow[];
}

export interface LatestSourceEntry {
  source: SourceName;
  headline: string;
  topic: TopicName;
  updatedAt: string;
  language: LanguageLabel;
  status: SourceStatusState;
  note: string;
  url: string | null;
  healthKind: SourceHealthKind;
  usedCachedItems: boolean;
}

export interface SourceStatusEntry {
  source: SourceName;
  status: SourceStatusState;
  healthKind: SourceHealthKind;
  healthLabel: string;
  checkedAt: string;
  lastSuccessfulAt: string | null;
  note: string;
  coverageCount: number;
  durationMs: number | null;
  sourceType: string;
  usedCachedItems: boolean;
}

export interface RefreshMeta {
  attemptedAt: string;
  successfulAt: string;
  mode: RefreshMode;
  cacheSource: CacheSource;
  cachedAt: string | null;
  staleMinutes: number | null;
  partialFailure: boolean;
  usedCachedSources: number;
  message: string | null;
}

export interface DashboardDebugSourceEntry {
  source: SourceName;
  status: SourceStatusState;
  healthKind: SourceHealthKind;
  sourceType: string;
  rawCount: number;
  relevantCount: number;
  keptCount: number;
  filteredOutCount: number;
  durationMs: number | null;
  diagnostics: string[];
  usedCachedItems: boolean;
}

export interface DashboardPayload {
  generatedAt: string;
  lastUpdated: string;
  storylines: DashboardStoryline[];
  latestBySource: LatestSourceEntry[];
  sourceStatus: SourceStatusEntry[];
  refresh: RefreshMeta;
  meta: {
    totalNormalizedItems: number;
    successfulSources: number;
    degradedSources: number;
    failedSources: number;
  };
  debug: {
    sourceSummaries: DashboardDebugSourceEntry[];
  };
}

export const EMPTY_DASHBOARD_PAYLOAD: DashboardPayload = {
  generatedAt: "",
  lastUpdated: "",
  storylines: [],
  latestBySource: SOURCE_NAMES.map((source) => ({
    source,
    headline: "Coverage unavailable during the latest refresh.",
    topic: "Politics",
    updatedAt: "",
    language: source === "VOA Amharic" ? "Amharic" : "English",
    status: "failed",
    note: "No data has been loaded yet.",
    url: null,
    healthKind: "failed",
    usedCachedItems: false,
  })),
  sourceStatus: SOURCE_NAMES.map((source) => ({
    source,
    status: "failed",
    healthKind: "failed",
    healthLabel: "Failed",
    checkedAt: "",
    lastSuccessfulAt: null,
    note: "No data has been loaded yet.",
    coverageCount: 0,
    durationMs: null,
    sourceType: "unknown",
    usedCachedItems: false,
  })),
  refresh: {
    attemptedAt: "",
    successfulAt: "",
    mode: "cached",
    cacheSource: "memory",
    cachedAt: null,
    staleMinutes: null,
    partialFailure: false,
    usedCachedSources: 0,
    message: "No data has been loaded yet.",
  },
  meta: {
    totalNormalizedItems: 0,
    successfulSources: 0,
    degradedSources: 0,
    failedSources: SOURCE_NAMES.length,
  },
  debug: {
    sourceSummaries: SOURCE_NAMES.map((source) => ({
      source,
      status: "failed",
      healthKind: "failed",
      sourceType: "unknown",
      rawCount: 0,
      relevantCount: 0,
      keptCount: 0,
      filteredOutCount: 0,
      durationMs: null,
      diagnostics: ["No data has been loaded yet."],
      usedCachedItems: false,
    })),
  },
};

export function redactDashboardDebug(
  payload: DashboardPayload,
): DashboardPayload {
  return {
    ...payload,
    debug: {
      sourceSummaries: [],
    },
  };
}
