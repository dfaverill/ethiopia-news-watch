import type {
  CacheSource,
  LanguageLabel,
  SourceHealthKind,
  SourceName,
  SourceStatusState,
  TopicName,
} from "@/lib/dashboard";

export type SourceSurfaceType =
  | "rss"
  | "html"
  | "sitemap"
  | "search-fallback";

export interface NormalizedNewsItem {
  id: string;
  source: SourceName;
  title: string;
  url: string | null;
  imageUrl?: string | null;
  publishedAt: string;
  snippet: string;
  section: string;
  language: LanguageLabel;
  originalLanguage?: LanguageLabel | null;
  sourceType: SourceSurfaceType;
  matchedKeywords: string[];
  topicTags: TopicName[];
  relevanceScore: number;
}

export interface SourceFetchMetrics {
  rawCount: number;
  relevantCount: number;
  keptCount: number;
  filteredOutCount: number;
}

export interface SourceFetchResult {
  source: SourceName;
  items: NormalizedNewsItem[];
  status: SourceStatusState;
  healthKind: SourceHealthKind;
  note: string;
  sourceType: SourceSurfaceType;
  attemptedAt: string;
  lastSuccessfulAt: string | null;
  durationMs: number | null;
  usedCachedItems: boolean;
  cacheSource: CacheSource | null;
  diagnostics: string[];
  metrics: SourceFetchMetrics;
}

export interface SourceAdapter {
  source: SourceName;
  fetchItems: () => Promise<SourceFetchResult>;
}

export interface PersistedCoverageState {
  schemaVersion: number;
  cachedAt: string;
  lastAttemptedRefreshAt: string;
  lastSuccessfulRefreshAt: string;
  payload: import("@/lib/dashboard").DashboardPayload;
  sourceResults: SourceFetchResult[];
}
