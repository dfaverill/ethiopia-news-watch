export const SOURCE_NAMES = [
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
  { value: "oldest", label: "Oldest this week" },
] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];
export type SourceFilter = (typeof SOURCE_OPTIONS)[number];
export type TopicName = (typeof TOPIC_NAMES)[number];
export type TopicFilter = (typeof TOPIC_OPTIONS)[number];
export type SortValue = (typeof SORT_OPTIONS)[number]["value"];
export type CoverageRowState = "covered" | "watching" | "limited";
export type SourceStatusState = "online" | "degraded" | "failed";
export type LanguageLabel = "English" | "Amharic" | "Afaan Oromoo";
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
export type WeeklyBriefStatus = "ready" | "unavailable";

const SOURCE_NAME_SET = new Set<string>(SOURCE_NAMES);
const RECENT_NEWS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isKnownSourceName(value: string): value is SourceName {
  return SOURCE_NAME_SET.has(value);
}

function getFiniteTimestamp(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isWithinRecentNewsWindow(
  value: string | null | undefined,
  referenceTimestamp: number | null,
) {
  const timestamp = getFiniteTimestamp(value);

  if (timestamp === null || referenceTimestamp === null) {
    return false;
  }

  return (
    timestamp >= referenceTimestamp - RECENT_NEWS_WINDOW_MS &&
    timestamp <= referenceTimestamp
  );
}

export interface LatestPublicationMeta {
  publishedAt: string | null;
  sources: SourceName[];
}

export interface StorylineSourceRow {
  source: SourceName;
  title: string;
  angle: string;
  language: LanguageLabel;
  originalLanguage?: LanguageLabel | null;
  state: CoverageRowState;
  updatedAt: string;
  url: string | null;
  imageUrl?: string | null;
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
  originalLanguage?: LanguageLabel | null;
  status: SourceStatusState;
  note: string;
  url: string | null;
  imageUrl?: string | null;
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

export interface WeeklyBrief {
  status: WeeklyBriefStatus;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  headline: string;
  summary: string;
  keyPoints: string[];
  sourceDifferences: string[];
  watchList: string[];
  note: string | null;
  model: string | null;
  sourceCount: number;
  storylineCount: number;
}

export interface DashboardFilters {
  searchQuery: string;
  selectedTopic: TopicFilter;
  selectedSource: SourceFilter;
  sortBy: SortValue;
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
  latestPublication: LatestPublicationMeta;
  weeklyBrief: WeeklyBrief;
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

export function buildCurrentWeekSourceOptions(
  payload: Pick<DashboardPayload, "latestBySource" | "storylines">,
): SourceFilter[] {
  const activeSources = new Set<SourceName>();

  for (const entry of payload.latestBySource ?? []) {
    if (isKnownSourceName(entry.source)) {
      activeSources.add(entry.source);
    }
  }

  for (const storyline of payload.storylines ?? []) {
    for (const sourceRow of storyline.sources) {
      if (isKnownSourceName(sourceRow.source)) {
        activeSources.add(sourceRow.source);
      }
    }
  }

  return [
    "All sources",
    ...SOURCE_NAMES.filter((source) => activeSources.has(source)),
  ];
}

function createEmptyWeeklyBrief(): WeeklyBrief {
  return {
    status: "unavailable",
    generatedAt: "",
    windowStart: "",
    windowEnd: "",
    headline: "Weekly AI brief unavailable",
    summary:
      "Add an OpenAI API key to generate a grounded seven-day summary from the Ethiopia coverage already collected by the dashboard.",
    keyPoints: [],
    sourceDifferences: [],
    watchList: [],
    note: "OPENAI_API_KEY is not configured.",
    model: null,
    sourceCount: 0,
    storylineCount: 0,
  };
}

function getFirstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeDashboardFilters(
  searchParams:
    | Record<string, string | string[] | undefined>
    | null
    | undefined,
): DashboardFilters {
  const rawSearch = getFirstSearchParam(searchParams?.search)?.trim() ?? "";
  const rawTopic = getFirstSearchParam(searchParams?.topic) ?? "All topics";
  const rawSource = getFirstSearchParam(searchParams?.source) ?? "All sources";
  const rawSort = getFirstSearchParam(searchParams?.sort) ?? "newest";

  return {
    searchQuery: rawSearch.slice(0, 120),
    selectedTopic: TOPIC_OPTIONS.includes(rawTopic as TopicFilter)
      ? (rawTopic as TopicFilter)
      : "All topics",
    selectedSource: SOURCE_OPTIONS.includes(rawSource as SourceFilter)
      ? (rawSource as SourceFilter)
      : "All sources",
    sortBy: SORT_OPTIONS.some((option) => option.value === rawSort)
      ? (rawSort as SortValue)
      : "newest",
  };
}

export const EMPTY_DASHBOARD_PAYLOAD: DashboardPayload = {
  generatedAt: "",
  lastUpdated: "",
  latestPublication: {
    publishedAt: null,
    sources: [],
  },
  weeklyBrief: createEmptyWeeklyBrief(),
  storylines: [],
  latestBySource: SOURCE_NAMES.map((source) => ({
    source,
    headline: "Coverage unavailable during the latest refresh.",
    topic: "Politics",
    updatedAt: "",
    language: source === "VOA Amharic" ? "Amharic" : "English",
    originalLanguage: null,
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

export function normalizeDashboardPayload(
  payload: DashboardPayload | null | undefined,
): DashboardPayload {
  if (!payload) {
    return EMPTY_DASHBOARD_PAYLOAD;
  }

  const referenceTimestamp =
    getFiniteTimestamp(payload.generatedAt) ??
    getFiniteTimestamp(payload.refresh?.successfulAt) ??
    Date.now();

  const filteredStorylines = (payload.storylines ?? [])
    .map((storyline) => ({
      ...storyline,
      sources: storyline.sources.filter((source) =>
        isKnownSourceName(source.source) &&
        isWithinRecentNewsWindow(source.updatedAt, referenceTimestamp),
      ),
    }))
    .filter(
      (storyline) =>
        isWithinRecentNewsWindow(storyline.updatedAt, referenceTimestamp) &&
        storyline.sources.length > 0,
    );

  const filteredLatestBySource = (
    payload.latestBySource ?? EMPTY_DASHBOARD_PAYLOAD.latestBySource
  ).filter(
    (entry) =>
      isKnownSourceName(entry.source) &&
      isWithinRecentNewsWindow(entry.updatedAt, referenceTimestamp),
  );

  const visibleSourceNames = new Set(
    filteredLatestBySource.map((entry) => entry.source),
  );

  const filteredSourceStatus = (
    payload.sourceStatus ?? EMPTY_DASHBOARD_PAYLOAD.sourceStatus
  ).filter(
    (entry) =>
      isKnownSourceName(entry.source) && visibleSourceNames.has(entry.source),
  );

  const filteredDebugSummaries = (
    payload.debug?.sourceSummaries ?? EMPTY_DASHBOARD_PAYLOAD.debug.sourceSummaries
  ).filter(
    (entry) =>
      isKnownSourceName(entry.source) && visibleSourceNames.has(entry.source),
  );

  const latestPublicationPublishedAt = isWithinRecentNewsWindow(
    payload.latestPublication?.publishedAt ?? null,
    referenceTimestamp,
  )
    ? payload.latestPublication?.publishedAt ?? null
    : null;

  return {
    ...EMPTY_DASHBOARD_PAYLOAD,
    ...payload,
    latestPublication: {
      ...EMPTY_DASHBOARD_PAYLOAD.latestPublication,
      ...(payload.latestPublication ?? {}),
      publishedAt: latestPublicationPublishedAt,
      sources: (payload.latestPublication?.sources ?? []).filter(
        (source) => isKnownSourceName(source) && visibleSourceNames.has(source),
      ),
    },
    weeklyBrief: {
      ...createEmptyWeeklyBrief(),
      ...(payload.weeklyBrief ?? {}),
      keyPoints: payload.weeklyBrief?.keyPoints ?? [],
      sourceDifferences: payload.weeklyBrief?.sourceDifferences ?? [],
      watchList: payload.weeklyBrief?.watchList ?? [],
    },
    storylines: filteredStorylines,
    latestBySource: filteredLatestBySource,
    sourceStatus: filteredSourceStatus,
    refresh: {
      ...EMPTY_DASHBOARD_PAYLOAD.refresh,
      ...payload.refresh,
    },
    meta: {
      ...EMPTY_DASHBOARD_PAYLOAD.meta,
      ...payload.meta,
    },
    debug: {
      sourceSummaries: filteredDebugSummaries,
    },
  };
}

export function redactDashboardDebug(
  payload: DashboardPayload,
): DashboardPayload {
  const normalizedPayload = normalizeDashboardPayload(payload);

  return {
    ...normalizedPayload,
    debug: {
      sourceSummaries: [],
    },
  };
}
