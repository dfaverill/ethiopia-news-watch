"use client";
import {
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  Sparkles,
  X,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

import { FeedBackgroundSlideshow } from "@/components/feed-background-slideshow";
import { EthiopiaLiveTime } from "@/components/ethiopia-live-time";
import { SectionHeading } from "@/components/section-heading";
import { SourceBadge } from "@/components/source-badge";
import { SourceStatusCard } from "@/components/source-status-card";
import { StatusPill } from "@/components/status-pill";
import { StorylineCard } from "@/components/storyline-card";
import { TopicChip } from "@/components/topic-chip";
import { WeeklyBriefCard } from "@/components/weekly-brief-card";
import type { BackgroundTheme } from "@/lib/background-themes";
import {
  buildCurrentWeekSourceOptions,
  EMPTY_DASHBOARD_PAYLOAD,
  SOURCE_NAMES,
  SORT_OPTIONS,
  TOPIC_OPTIONS,
  type DashboardFilters,
  type DashboardPayload,
  type SortValue,
  type SourceFilter,
  type TopicFilter,
  type TopicName,
  normalizeDashboardPayload,
  normalizeDashboardFilters,
} from "@/lib/dashboard";
import type {
  NotebookLmPodcastPublicState,
  NotebookLmPodcastScope,
} from "@/lib/notebooklm-podcast";
import {
  applySelectedSourceToStorylines,
  filterStorylinesBySearchAndSource,
  filterStorylinesByTopic,
  sortDashboardStorylines,
} from "@/lib/storyline-browser";
import type { ElevenLabsPodcastPublicState } from "@/lib/elevenlabs-podcast";
import type { PodcastArchiveCollections } from "@/lib/podcast-archive";
import { buildStoryImageSrc } from "@/lib/story-image-proxy";

interface NewsWatchDashboardProps {
  initialData: DashboardPayload;
  initialFilters: DashboardFilters;
  backgroundTheme?: BackgroundTheme | null;
}

const TOPIC_FEED_OUTLINE_COLORS: Record<TopicFilter, string> = {
  "All topics": "#0e648b",
  Politics: "#0e648b",
  Election: "#0e648b",
  Conflict: "#0e648b",
  Diplomacy: "#0e648b",
  Economy: "#0e648b",
  Humanitarian: "#0e648b",
};

const WEEKLY_FEED_SECTION_ID = "weekly-storyline-feed";
const PODCAST_SCOPES = ["weekly", "recent"] as const satisfies readonly NotebookLmPodcastScope[];
const EMPTY_PODCAST_ARCHIVES: PodcastArchiveCollections = {
  weekly: [],
  recent: [],
  scriptedRecent: [],
};

interface DashboardPodcastAlert {
  id: string;
  title: string;
  message: string;
  tone: "success" | "danger";
  actionHref?: string | null;
  actionLabel?: string | null;
}

function createPodcastScopeRecord<T>(factory: (scope: NotebookLmPodcastScope) => T) {
  return {
    weekly: factory("weekly"),
    recent: factory("recent"),
  } satisfies Record<NotebookLmPodcastScope, T>;
}

function isPodcastStatusActive(status: string | null | undefined) {
  return status === "queued" || status === "running" || status === "auth-required";
}

function isNotebookLmPodcastFinished(
  podcast: NotebookLmPodcastPublicState | null | undefined,
) {
  return Boolean(podcast?.audioUrl) && (podcast?.status === "ready" || podcast?.status === "stale");
}

function isScriptedPodcastFinished(
  podcast: ElevenLabsPodcastPublicState | null | undefined,
) {
  return Boolean(podcast?.audioUrl) && (podcast?.status === "ready" || podcast?.status === "stale");
}

function buildFilterQueryString(filters: DashboardFilters) {
  const params = new URLSearchParams();

  if (filters.searchQuery) {
    params.set("search", filters.searchQuery);
  }

  if (filters.selectedTopic !== "All topics") {
    params.set("topic", filters.selectedTopic);
  }

  if (filters.selectedSource !== "All sources") {
    params.set("source", filters.selectedSource);
  }

  if (filters.sortBy !== "newest") {
    params.set("sort", filters.sortBy);
  }

  return params.toString();
}

function buildStorylineAnchorId(storylineId: string) {
  return `storyline-${storylineId}`;
}

export function NewsWatchDashboard({
  initialData,
  initialFilters,
  backgroundTheme = null,
}: NewsWatchDashboardProps) {
  const normalizedInitialPayload = normalizeDashboardPayload(
    initialData ?? EMPTY_DASHBOARD_PAYLOAD,
  );
  const initialCurrentWeekSourceOptions = buildCurrentWeekSourceOptions(
    normalizedInitialPayload,
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [payload] = useState<DashboardPayload>(normalizedInitialPayload);
  const [selectedTopic, setSelectedTopic] = useState<TopicFilter>(
    initialFilters.selectedTopic,
  );
  const [selectedSource, setSelectedSource] = useState<SourceFilter>(
    initialCurrentWeekSourceOptions.includes(initialFilters.selectedSource)
      ? initialFilters.selectedSource
      : "All sources",
  );
  const [sortBy, setSortBy] = useState<SortValue>(initialFilters.sortBy);
  const [podcasts, setPodcasts] = useState(
    createPodcastScopeRecord<NotebookLmPodcastPublicState | null>(() => null),
  );
  const [podcastLoading, setPodcastLoading] = useState(
    createPodcastScopeRecord(() => true),
  );
  const [podcastStarting, setPodcastStarting] = useState(
    createPodcastScopeRecord(() => false),
  );
  const [podcastNotice, setPodcastNotice] = useState(
    createPodcastScopeRecord<string | null>(() => null),
  );
  const [scriptedRecentPodcast, setScriptedRecentPodcast] =
    useState<ElevenLabsPodcastPublicState | null>(null);
  const [scriptedRecentPodcastLoading, setScriptedRecentPodcastLoading] =
    useState(true);
  const [scriptedRecentPodcastStarting, setScriptedRecentPodcastStarting] =
    useState(false);
  const [scriptedRecentPodcastNotice, setScriptedRecentPodcastNotice] =
    useState<string | null>(null);
  const [podcastArchives, setPodcastArchives] =
    useState<PodcastArchiveCollections>(EMPTY_PODCAST_ARCHIVES);
  const [podcastAlerts, setPodcastAlerts] = useState<DashboardPodcastAlert[]>([]);
  const previousPodcastsRef = useRef(
    createPodcastScopeRecord<NotebookLmPodcastPublicState | null>(() => null),
  );
  const previousScriptedRecentPodcastRef =
    useRef<ElevenLabsPodcastPublicState | null>(null);
  const announcedPodcastEventsRef = useRef<Set<string>>(new Set());

  const sourceFilteredStorylines = useMemo(
    () =>
      applySelectedSourceToStorylines(
        filterStorylinesBySearchAndSource(
          payload.storylines,
          "",
          selectedSource,
        ),
        selectedSource,
      ),
    [payload.storylines, selectedSource],
  );
  const filteredStorylines = useMemo(
    () =>
      sortDashboardStorylines(
        filterStorylinesByTopic(sourceFilteredStorylines, selectedTopic),
        sortBy,
      ),
    [selectedTopic, sortBy, sourceFilteredStorylines],
  );

  const comparisonCount = filteredStorylines.reduce(
    (total, storyline) =>
      total + (storyline.sources.length > 1 ? storyline.sources.length : 0),
    0,
  );
  const heroSourceEntries = useMemo(() => {
    const latestBySourceMap = new Map(
      payload.latestBySource.map((entry) => [entry.source, entry] as const),
    );

    return SOURCE_NAMES.map((source) => {
      const entry = latestBySourceMap.get(source);

      return {
        source,
        updatedAt: entry?.updatedAt ?? "",
        hasRecentPublication: Boolean(entry?.updatedAt),
      };
    });
  }, [payload.latestBySource]);
  const currentWeekSourceOptions = useMemo(
    () => buildCurrentWeekSourceOptions(payload),
    [payload],
  );

  function dismissPodcastAlert(id: string) {
    setPodcastAlerts((current) => current.filter((alert) => alert.id !== id));
  }

  function addPodcastAlert(alert: Omit<DashboardPodcastAlert, "id">) {
    setPodcastAlerts((current) => {
      const next = [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...alert,
        },
        ...current,
      ];

      return next.slice(0, 4);
    });
  }

  async function maybeRequestNotificationPermission() {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "default"
    ) {
      return;
    }

    try {
      await Notification.requestPermission();
    } catch {
      // Ignore permission errors and keep the in-app alert path working.
    }
  }

  function maybeSendBrowserNotification(title: string, body: string) {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        requireInteraction: true,
        tag: "ethiopia-news-watch-podcast",
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      window.setTimeout(() => {
        notification.close();
      }, 20_000);
    } catch {
      // Fall back to the in-app banner only.
    }
  }

  function syncFilterUrl(filters: DashboardFilters, historyMode: "push" | "replace") {
    const nextQuery = buildFilterQueryString(filters);
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;

    if (historyMode === "replace") {
      window.history.replaceState(null, "", nextUrl);
      return;
    }

    window.history.pushState(null, "", nextUrl);
  }

  function scrollToWeeklyFeed() {
    window.requestAnimationFrame(() => {
      document
        .getElementById(WEEKLY_FEED_SECTION_ID)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handleTopicSelect(topic: TopicName | TopicFilter) {
    const nextTopic = topic as TopicFilter;
    const nextFilters = {
      searchQuery: "",
      selectedTopic: nextTopic,
      selectedSource,
      sortBy,
    } satisfies DashboardFilters;

    setSelectedTopic(nextTopic);
    syncFilterUrl(nextFilters, "push");
  }

  function handleSourceChange(nextSource: SourceFilter) {
    const nextFilters = {
      searchQuery: "",
      selectedTopic,
      selectedSource: nextSource,
      sortBy,
    } satisfies DashboardFilters;

    setSelectedSource(nextSource);
    syncFilterUrl(nextFilters, "push");
    scrollToWeeklyFeed();
  }

  function handleSortChange(nextSort: SortValue) {
    const nextFilters = {
      searchQuery: "",
      selectedTopic,
      selectedSource,
      sortBy: nextSort,
    } satisfies DashboardFilters;

    setSortBy(nextSort);
    syncFilterUrl(nextFilters, "push");
    scrollToWeeklyFeed();
  }

  function handleResetFilters() {
    const nextFilters = {
      searchQuery: "",
      selectedTopic: "All topics",
      selectedSource: "All sources",
      sortBy: "newest",
    } satisfies DashboardFilters;

    setSelectedTopic(nextFilters.selectedTopic);
    setSelectedSource(nextFilters.selectedSource);
    setSortBy(nextFilters.sortBy);
    syncFilterUrl(nextFilters, "push");
    scrollToWeeklyFeed();
  }

  async function loadPodcastState(
    scope: NotebookLmPodcastScope,
    options?: {
    silent?: boolean;
  }) {
    const silent = options?.silent ?? false;

    if (!silent) {
      setPodcastLoading((current) => ({ ...current, [scope]: true }));
    }

    try {
      const response = await fetch(`/api/podcast?scope=${scope}`, {
        cache: "no-store",
      });
      const nextPayload = (await response.json()) as {
        data?: NotebookLmPodcastPublicState;
        error?: string;
      };

      if (nextPayload.data) {
        setPodcasts((current) => ({ ...current, [scope]: nextPayload.data ?? null }));
      }

      if (nextPayload.error) {
        setPodcastNotice((current) => ({ ...current, [scope]: nextPayload.error ?? null }));
      }
    } catch (error) {
      setPodcastNotice((current) => ({
        ...current,
        [scope]:
          error instanceof Error && error.message
            ? error.message
            : "Unable to load the Google deep-dive status right now.",
      }));
    } finally {
      if (!silent) {
        setPodcastLoading((current) => ({ ...current, [scope]: false }));
      }
    }
  }

  async function startPodcastGeneration(
    scope: NotebookLmPodcastScope,
    force = false,
  ) {
    void maybeRequestNotificationPermission();
    setPodcastStarting((current) => ({ ...current, [scope]: true }));
    setPodcastNotice((current) => ({ ...current, [scope]: null }));

    try {
      const response = await fetch(
        force
          ? `/api/podcast?scope=${scope}&force=1`
          : `/api/podcast?scope=${scope}`,
        {
        method: "POST",
        cache: "no-store",
        },
      );
      const nextPayload = (await response.json()) as {
        data?: NotebookLmPodcastPublicState;
        error?: string;
        notice?: string;
      };

      if (nextPayload.data) {
        setPodcasts((current) => ({ ...current, [scope]: nextPayload.data ?? null }));
      }

      if (!response.ok) {
        throw new Error(
          nextPayload.error ?? `Podcast generation failed with ${response.status}`,
        );
      }

      if (nextPayload.notice) {
        setPodcastNotice((current) => ({ ...current, [scope]: nextPayload.notice ?? null }));
      }
    } catch (error) {
      setPodcastNotice((current) => ({
        ...current,
        [scope]:
          error instanceof Error && error.message
            ? error.message
            : "Unable to start the Google deep-dive automation right now.",
      }));
    } finally {
      setPodcastStarting((current) => ({ ...current, [scope]: false }));
      setPodcastLoading((current) => ({ ...current, [scope]: false }));
    }
  }

  async function loadScriptedRecentPodcastState(options?: {
    silent?: boolean;
  }) {
    const silent = options?.silent ?? false;

    if (!silent) {
      setScriptedRecentPodcastLoading(true);
    }

    try {
      const response = await fetch("/api/podcast/elevenlabs", {
        cache: "no-store",
      });
      const nextPayload = (await response.json()) as {
        data?: ElevenLabsPodcastPublicState;
        error?: string;
      };

      if (nextPayload.data) {
        setScriptedRecentPodcast(nextPayload.data);
      }

      if (nextPayload.error) {
        setScriptedRecentPodcastNotice(nextPayload.error);
      }
    } catch (error) {
      setScriptedRecentPodcastNotice(
        error instanceof Error && error.message
          ? error.message
          : "Unable to load the scripted ElevenLabs status right now.",
      );
    } finally {
      if (!silent) {
        setScriptedRecentPodcastLoading(false);
      }
    }
  }

  async function loadPodcastArchives() {
    try {
      const response = await fetch("/api/podcast/archive", {
        cache: "no-store",
      });
      const nextPayload = (await response.json()) as {
        data?: PodcastArchiveCollections;
      };

      if (nextPayload.data) {
        setPodcastArchives(nextPayload.data);
      }
    } catch {
      setPodcastArchives(EMPTY_PODCAST_ARCHIVES);
    }
  }

  async function startScriptedRecentPodcastGeneration(force = false) {
    void maybeRequestNotificationPermission();
    setScriptedRecentPodcastStarting(true);
    setScriptedRecentPodcastNotice(null);

    try {
      const response = await fetch(
        force ? "/api/podcast/elevenlabs?force=1" : "/api/podcast/elevenlabs",
        {
          method: "POST",
          cache: "no-store",
        },
      );
      const nextPayload = (await response.json()) as {
        data?: ElevenLabsPodcastPublicState;
        error?: string;
        notice?: string;
      };

      if (nextPayload.data) {
        setScriptedRecentPodcast(nextPayload.data);
      }

      if (!response.ok) {
        throw new Error(
          nextPayload.error ??
            `Scripted podcast generation failed with ${response.status}`,
        );
      }

      if (nextPayload.notice) {
        setScriptedRecentPodcastNotice(nextPayload.notice);
      }
    } catch (error) {
      setScriptedRecentPodcastNotice(
        error instanceof Error && error.message
          ? error.message
          : "Unable to start the scripted ElevenLabs episode right now.",
      );
    } finally {
      setScriptedRecentPodcastStarting(false);
      setScriptedRecentPodcastLoading(false);
    }
  }

  function formatTimestamp(value: string) {
    if (!value) {
      return "Unavailable";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Unavailable";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function formatSourcePublicationDate(value: string) {
    if (!value) {
      return "Unavailable";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Unavailable";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function formatDate(value: string) {
    if (!value) {
      return "Unavailable";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Unavailable";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  }

  useEffect(() => {
    const nextFilters = normalizeDashboardFilters({
      topic: searchParams.get("topic") ?? undefined,
      source: searchParams.get("source") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
    });

    setSelectedTopic((current) =>
      current === nextFilters.selectedTopic ? current : nextFilters.selectedTopic,
    );
    setSelectedSource((current) =>
      current === nextFilters.selectedSource
        ? current
        : nextFilters.selectedSource,
    );
    setSortBy((current) => (current === nextFilters.sortBy ? current : nextFilters.sortBy));
  }, [searchParams]);

  useEffect(() => {
    const normalizedFilters = normalizeDashboardFilters({
      topic: searchParams.get("topic") ?? undefined,
      source: searchParams.get("source") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
    });
    const currentQuery = searchParams.toString();
    const normalizedQuery = buildFilterQueryString(normalizedFilters);

    if (currentQuery === normalizedQuery) {
      return;
    }

    const nextUrl = normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (
      selectedSource === "All sources" ||
      currentWeekSourceOptions.includes(selectedSource)
    ) {
      return;
    }

    const nextFilters = {
      searchQuery: "",
      selectedTopic,
      selectedSource: "All sources",
      sortBy,
    } satisfies DashboardFilters;

    setSelectedSource("All sources");
    const nextQuery = buildFilterQueryString(nextFilters);
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [currentWeekSourceOptions, pathname, selectedSource, selectedTopic, sortBy]);

  useEffect(() => {
    setPodcastNotice(createPodcastScopeRecord<string | null>(() => null));
    setScriptedRecentPodcastNotice(null);
    void Promise.all([
      ...PODCAST_SCOPES.map((scope) => loadPodcastState(scope)),
      loadScriptedRecentPodcastState(),
    ]);
  }, [payload.weeklyBrief.generatedAt]);

  useEffect(() => {
    void loadPodcastArchives();
  }, [
    podcasts.weekly?.jobKey,
    podcasts.recent?.jobKey,
    scriptedRecentPodcast?.jobKey,
  ]);

  useEffect(() => {
    const activeScopes = PODCAST_SCOPES.filter((scope) => {
      const status = podcasts[scope]?.status;
      return (
        status === "queued" ||
        status === "running" ||
        status === "auth-required"
      );
    });

    if (activeScopes.length === 0) {
      if (scriptedRecentPodcast?.status !== "running") {
        return;
      }
    }

    const intervalId = window.setInterval(() => {
      activeScopes.forEach((scope) => {
        void loadPodcastState(scope, { silent: true });
      });
      if (scriptedRecentPodcast?.status === "running") {
        void loadScriptedRecentPodcastState({ silent: true });
      }
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [podcasts, scriptedRecentPodcast?.status]);

  useEffect(() => {
    PODCAST_SCOPES.forEach((scope) => {
      const previous = previousPodcastsRef.current[scope];
      const current = podcasts[scope];

      if (!previous || !current) {
        return;
      }

      const completedSuccessfully = isNotebookLmPodcastFinished(current);
      const failed = current.status === "failed";
      const transitionedFromActive =
        isPodcastStatusActive(previous.status) &&
        (completedSuccessfully || failed);

      if (!transitionedFromActive) {
        return;
      }

      const completionKey = [
        "notebooklm",
        scope,
        current.jobKey ?? "current",
        current.status,
        current.completedAt ?? current.updatedAt ?? "no-time",
      ].join(":");

      if (announcedPodcastEventsRef.current.has(completionKey)) {
        return;
      }

      announcedPodcastEventsRef.current.add(completionKey);

      const title = completedSuccessfully
        ? scope === "weekly"
          ? "Weekly podcast is ready"
          : "Two-day podcast is ready"
        : scope === "weekly"
          ? "Weekly podcast failed"
          : "Two-day podcast failed";
      const message = completedSuccessfully
        ? scope === "weekly"
          ? "NotebookLM finished the weekly audio overview."
          : "NotebookLM finished the last two days audio overview."
        : current.error ||
          current.message ||
          "NotebookLM stopped before finishing the audio overview.";

      addPodcastAlert({
        title,
        message,
        tone: completedSuccessfully ? "success" : "danger",
        actionHref: completedSuccessfully
          ? current.audioUrl
          : current.notebookUrl ?? null,
        actionLabel: completedSuccessfully ? "Open audio" : "Open notebook",
      });
      maybeSendBrowserNotification(title, message);
    });

    previousPodcastsRef.current = podcasts;
  }, [podcasts]);

  useEffect(() => {
    const previous = previousScriptedRecentPodcastRef.current;
    const current = scriptedRecentPodcast;

    if (!previous || !current) {
      previousScriptedRecentPodcastRef.current = current;
      return;
    }

    const completedSuccessfully = isScriptedPodcastFinished(current);
    const failed = current.status === "failed";
    const transitionedFromActive =
      isPodcastStatusActive(previous.status) &&
      (completedSuccessfully || failed);

    if (transitionedFromActive) {
      const completionKey = [
        "scripted",
        current.jobKey ?? "current",
        current.status,
        current.completedAt ?? current.updatedAt ?? "no-time",
      ].join(":");

      if (!announcedPodcastEventsRef.current.has(completionKey)) {
        announcedPodcastEventsRef.current.add(completionKey);

        const title = completedSuccessfully
          ? "Scripted two-day podcast is ready"
          : "Scripted two-day podcast failed";
        const message = completedSuccessfully
          ? "The scripted two-day audio episode finished."
          : current.error ||
            current.message ||
            "The scripted two-day audio episode stopped before finishing.";

        addPodcastAlert({
          title,
          message,
          tone: completedSuccessfully ? "success" : "danger",
          actionHref: completedSuccessfully
            ? current.audioUrl
            : current.scriptUrl ?? null,
          actionLabel: completedSuccessfully ? "Open audio" : "Open script",
        });
        maybeSendBrowserNotification(title, message);
      }
    }

    previousScriptedRecentPodcastRef.current = current;
  }, [scriptedRecentPodcast]);

  const storylineSectionTitle =
    selectedTopic === "All topics"
      ? selectedSource === "All sources"
        ? "This Week's Ethiopia Coverage"
        : `${selectedSource} Coverage This Week`
      : `${selectedTopic} Coverage This Week`;
  const storylineSectionDescription =
    selectedTopic === "All topics"
      ? `Freshly grouped reporting from ${selectedSource === "All sources" ? "all tracked outlets" : selectedSource}, ordered ${sortBy === "oldest" ? "from the oldest reporting still inside this week's window to the newest" : "with the newest developments first"}.`
      : `Focused ${selectedTopic.toLowerCase()} reporting from ${selectedSource === "All sources" ? "all tracked outlets" : selectedSource}, ordered ${sortBy === "oldest" ? "from the oldest reporting in this week's window to the newest" : "so the latest movement lands first"}.`;
  const sourceStatusEntriesNeedingAttention = payload.sourceStatus.filter(
    (entry) =>
      entry.coverageCount > 0 &&
      (entry.status !== "online" ||
        (entry.healthKind !== "healthy" && entry.healthKind !== "no-matches") ||
        entry.usedCachedItems),
  );
  const hasRefreshAttention =
    payload.refresh.partialFailure ||
    payload.refresh.usedCachedSources > 0 ||
    (payload.refresh.staleMinutes !== null && payload.refresh.staleMinutes >= 15);
  const shouldShowSourceStatus =
    sourceStatusEntriesNeedingAttention.length > 0 || hasRefreshAttention;
  const activeFeedOutlineColor =
    TOPIC_FEED_OUTLINE_COLORS[selectedTopic] ??
    TOPIC_FEED_OUTLINE_COLORS["All topics"];
  const feedBackgroundImageUrls = useMemo(() => {
    const uniqueImageUrls = new Set<string>();

    for (const storyline of filteredStorylines) {
      for (const source of storyline.sources) {
        if (!source.url) {
          continue;
        }

        uniqueImageUrls.add(
          buildStoryImageSrc({
            articleUrl: source.url,
            imageUrl: source.imageUrl,
            source: source.source,
          }),
        );
      }
    }

    return [...uniqueImageUrls];
  }, [filteredStorylines]);

  return (
    <>
      {backgroundTheme ? (
        <div
          aria-hidden="true"
          className={`app-background-layer app-background-layer--${backgroundTheme}`}
        />
      ) : (
        <FeedBackgroundSlideshow imageUrls={feedBackgroundImageUrls} />
      )}
      {podcastAlerts.length > 0 ? (
        <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 sm:right-6 sm:bottom-6">
          {podcastAlerts.map((alert) => (
            <div
              key={alert.id}
              role={alert.tone === "danger" ? "alert" : "status"}
              aria-live="polite"
              className="pointer-events-auto rounded-[22px] border border-[color:var(--line)] bg-[color:var(--card)] px-4 py-4 shadow-[0_18px_60px_rgba(17,24,39,0.2)]"
            >
              <div className="flex items-start gap-3">
                <div
                  className={
                    alert.tone === "danger"
                      ? "mt-0.5 text-[#d66a5b]"
                      : "mt-0.5 text-[color:var(--accent)]"
                  }
                >
                  {alert.tone === "danger" ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[color:var(--ink)]">
                      {alert.title}
                    </p>
                    <p className="text-sm leading-6 text-[color:var(--ink-soft)]">
                      {alert.message}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {alert.actionHref ? (
                      <a
                        href={alert.actionHref}
                        className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--accent)] transition hover:text-[color:var(--accent-strong)]"
                      >
                        {alert.actionLabel ?? "Open"}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => dismissPodcastAlert(alert.id)}
                      className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)] transition hover:text-[color:var(--ink)]"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissPodcastAlert(alert.id)}
                  className="rounded-full p-1 text-[color:var(--ink-soft)] transition hover:bg-[color:var(--card-elevated)] hover:text-[color:var(--ink)]"
                  aria-label="Dismiss podcast alert"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <main className="relative z-[1] mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <section className="px-6 py-8 lg:px-8 lg:py-10">
        <div>
          <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex w-fit flex-col items-center gap-3">
                <StatusPill
                  label="Live coverage"
                  tone="neutral"
                  className="!border-[color:var(--line)] !bg-[color:var(--card-elevated)] !text-[#c95b4a]"
                />
                <EthiopiaLiveTime />
              </div>
              <div className="flex flex-col items-center gap-1 self-start text-center sm:self-auto">
                <div className="space-y-0.5 text-center text-[9px] leading-4 text-[color:var(--ink-soft)] sm:text-[10px]">
                  <p>Last refresh</p>
                  <p>{formatTimestamp(payload.refresh.successfulAt)}</p>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <h1 className="font-headline mx-auto max-w-4xl text-center text-4xl leading-none font-semibold text-[color:var(--ink)] md:text-6xl">
                Ethiopia News Watch
              </h1>
              <div className="mx-auto max-w-4xl pt-1 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
                  Tracked sources this week
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-[14px] text-[color:var(--ink)]">
                  {heroSourceEntries.map((entry) => (
                    <div
                      key={`hero-source-publication-${entry.source}`}
                      className="inline-flex items-center gap-2"
                    >
                      <SourceBadge
                        source={entry.source}
                        size="xs"
                        className="shrink-0"
                        nameClassName="!text-[15px] !font-medium"
                      />
                      <span className="text-[14px] text-[color:var(--ink-soft)]">
                        {entry.hasRecentPublication
                          ? formatSourcePublicationDate(entry.updatedAt)
                          : "No update"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-9 pb-4" aria-hidden="true">
                <div className="h-[50px]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="-mt-6 mb-2 mx-auto max-w-4xl">
        </div>

      <WeeklyBriefCard
        key={`${payload.weeklyBrief.generatedAt}-${payload.weeklyBrief.headline}`}
        brief={payload.weeklyBrief ?? EMPTY_DASHBOARD_PAYLOAD.weeklyBrief}
        formatDate={formatDate}
        weeklyPodcast={podcasts.weekly}
        weeklyPodcastNotice={podcastNotice.weekly}
        isWeeklyPodcastLoading={podcastLoading.weekly}
        isWeeklyPodcastStarting={podcastStarting.weekly}
        onGenerateWeeklyPodcast={(force) =>
          void startPodcastGeneration("weekly", force)
        }
        weeklyArchives={podcastArchives.weekly}
        recentPodcast={podcasts.recent}
        recentPodcastNotice={podcastNotice.recent}
        isRecentPodcastLoading={podcastLoading.recent}
        isRecentPodcastStarting={podcastStarting.recent}
        onGenerateRecentPodcast={(force) =>
          void startPodcastGeneration("recent", force)
        }
        recentArchives={podcastArchives.recent}
        scriptedRecentPodcast={scriptedRecentPodcast}
        scriptedRecentPodcastNotice={scriptedRecentPodcastNotice}
        isScriptedRecentPodcastLoading={scriptedRecentPodcastLoading}
        isScriptedRecentPodcastStarting={scriptedRecentPodcastStarting}
        onGenerateScriptedRecentPodcast={(force) =>
          void startScriptedRecentPodcastGeneration(force)
        }
        scriptedRecentArchives={podcastArchives.scriptedRecent}
      />

      <section className="overflow-hidden rounded-[30px] border border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(18,18,18,0.94),rgba(9,9,9,0.96))] p-5 shadow-[0_20px_80px_rgba(17,24,39,0.08)] lg:p-6">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent)]">
              Weekly News Navigator
            </p>
            <h2 className="font-headline max-w-4xl text-3xl font-semibold text-[color:var(--ink)] md:text-[2.5rem]">
              Browse this week&apos;s Ethiopia coverage by category
            </h2>
            <p className="max-w-3xl text-sm leading-7 text-[color:var(--ink-soft)]">
              Choose a topic and we&apos;ll take you straight to this week&apos;s
              matching reporting from your selected Ethiopian news sources,
              with the newest developments leading the feed.
            </p>
          </div>

          <div id="dashboard-filters" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="relative rounded-[24px] border border-[color:var(--line)] bg-[color:var(--card-muted)] px-4 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                  Source set
                </span>
                <select
                  name="source"
                  value={selectedSource}
                  onChange={(event) =>
                    handleSourceChange(event.target.value as SourceFilter)
                  }
                  className="mt-2 h-8 w-full appearance-none bg-transparent pr-8 text-sm font-medium text-[color:var(--ink)] outline-none"
                >
                  {currentWeekSourceOptions.map((source) => (
                    <option
                      key={source}
                      value={source}
                      style={{
                        color: "#111827",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      {source}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-[calc(50%+10px)] h-4 w-4 text-[color:var(--ink-soft)]" />
              </label>

              <label className="relative rounded-[24px] border border-[color:var(--line)] bg-[color:var(--card-muted)] px-4 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                  Feed order
                </span>
                <div className="mt-2 flex items-center gap-2 pr-8">
                  <ArrowDownUp className="h-4 w-4 text-[color:var(--ink-soft)]" />
                <select
                  name="sort"
                  value={sortBy}
                  onChange={(event) =>
                    handleSortChange(event.target.value as SortValue)
                  }
                  className="h-8 w-full appearance-none bg-transparent text-sm font-medium text-[color:var(--ink)] outline-none"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      style={{
                        color: "#111827",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
                </div>
                <ChevronDown className="pointer-events-none absolute right-4 top-[calc(50%+10px)] h-4 w-4 text-[color:var(--ink-soft)]" />
              </label>

            </div>

            <div className="border-t border-[color:var(--line)] pt-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                    Open a real topic feed
                  </p>
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    Click a topic to jump into this week&apos;s matching Ethiopia
                    reporting from your selected outlets.
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                  {selectedTopic === "All topics"
                    ? "Showing all categories"
                    : `Focused on ${selectedTopic}`}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
                {TOPIC_OPTIONS.map((topic) => (
                  <TopicChip
                    key={topic}
                    label={topic}
                    active={selectedTopic === topic}
                    onClick={() => handleTopicSelect(topic)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id={WEEKLY_FEED_SECTION_ID} className="space-y-6">
        <SectionHeading
          eyebrow="Main section"
          title={storylineSectionTitle}
          description={storylineSectionDescription}
          action={
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--card)] px-4 py-2 text-sm text-[color:var(--ink-soft)]">
              <span>{filteredStorylines.length} storylines</span>
              <span className="h-1 w-1 rounded-full bg-[color:var(--ink-soft)]" />
              <span>{comparisonCount} source comparisons</span>
            </div>
          }
        />

        {filteredStorylines.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-[color:var(--line-strong)] bg-[color:var(--card)] px-6 py-12 text-center shadow-[0_20px_80px_rgba(17,24,39,0.04)]">
            <p className="font-headline text-3xl font-semibold text-[color:var(--ink)]">
              {payload.storylines.length === 0
                ? "No Ethiopia-related storylines are available right now."
                : "No storylines match these filters."}
            </p>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--ink-soft)]">
              {payload.storylines.length === 0
                ? "The dashboard refreshed, but no grouped coverage met the Ethiopia relevance threshold. Check Source Status below for degraded or failed sources, or try a fresh refresh."
                : "Try clearing the search or changing topic and source filters to restore the storyline comparison grid."}
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-6 inline-flex items-center justify-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-white hover:text-black"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid gap-5">
            {filteredStorylines.map((storyline, index) => (
              <StorylineCard
                key={storyline.id}
                anchorId={buildStorylineAnchorId(storyline.id)}
                storyline={storyline}
                defaultExpanded={index < 2}
                formatTime={formatTimestamp}
                onTopicSelect={handleTopicSelect}
                highlightFeed
                feedOutlineColor={activeFeedOutlineColor}
                motionPreset={index}
              />
            ))}
          </div>
        )}
      </section>

      {shouldShowSourceStatus ? (
        <section className="space-y-6">
          <SectionHeading
            eyebrow="Operational panel"
            title="Source Status"
            description="Only shown when a monitored source needs attention, falls back to cached coverage, or fails during refresh."
          />
          {hasRefreshAttention ? (
            <div className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--card)] px-5 py-4 shadow-[0_16px_50px_rgba(17,24,39,0.06)]">
              <div className="flex flex-wrap items-center gap-2">
                {payload.refresh.partialFailure ? (
                  <StatusPill label="Partial refresh" tone="warning" />
                ) : null}
                {payload.refresh.usedCachedSources > 0 ? (
                  <StatusPill
                    label={`${payload.refresh.usedCachedSources} cached sources`}
                    tone="warning"
                  />
                ) : null}
                {payload.refresh.staleMinutes !== null && payload.refresh.staleMinutes >= 15 ? (
                  <StatusPill label="Stale data" tone="warning" />
                ) : null}
              </div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-[color:var(--ink-soft)]">
                {payload.refresh.message ? (
                  <p>{payload.refresh.message}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {sourceStatusEntriesNeedingAttention.map((entry) => (
              <SourceStatusCard
                key={entry.source}
                entry={entry}
                formatTime={formatTimestamp}
              />
            ))}
          </div>
        </section>
      ) : null}
      </main>
    </>
  );
}
