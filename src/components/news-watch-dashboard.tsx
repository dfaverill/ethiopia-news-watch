"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowDownUp,
  LoaderCircle,
  RefreshCcw,
  Search,
  Sparkles,
} from "lucide-react";

import { LatestSourceCard } from "@/components/latest-source-card";
import { SectionHeading } from "@/components/section-heading";
import { SourceStatusCard } from "@/components/source-status-card";
import { StatusPill } from "@/components/status-pill";
import { StorylineCard } from "@/components/storyline-card";
import { TopicChip } from "@/components/topic-chip";
import {
  EMPTY_DASHBOARD_PAYLOAD,
  SORT_OPTIONS,
  SOURCE_OPTIONS,
  TOPIC_OPTIONS,
  type DashboardPayload,
  type SortValue,
  type SourceFilter,
  type TopicFilter,
} from "@/lib/dashboard";

interface NewsWatchDashboardProps {
  initialData: DashboardPayload;
}

export function NewsWatchDashboard({
  initialData,
}: NewsWatchDashboardProps) {
  const [payload, setPayload] = useState<DashboardPayload>(
    initialData ?? EMPTY_DASHBOARD_PAYLOAD,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [selectedTopic, setSelectedTopic] =
    useState<TopicFilter>("All topics");
  const [selectedSource, setSelectedSource] =
    useState<SourceFilter>("All sources");
  const [sortBy, setSortBy] = useState<SortValue>("newest");
  const [expandedStorylines, setExpandedStorylines] = useState<string[]>(
    initialData.storylines.slice(0, 2).map((storyline) => storyline.id),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  useEffect(() => {
    const validStorylineIds = new Set(
      payload.storylines.map((storyline) => storyline.id),
    );

    setExpandedStorylines((current) => {
      const filtered = current.filter((storylineId) =>
        validStorylineIds.has(storylineId),
      );

      if (filtered.length > 0 || payload.storylines.length === 0) {
        return filtered;
      }

      return payload.storylines.slice(0, 2).map((storyline) => storyline.id);
    });
  }, [payload.storylines]);

  const filteredStorylines = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();

    const next = payload.storylines.filter((storyline) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        `${storyline.headline} ${storyline.summary} ${storyline.sources
          .map((source) => `${source.source} ${source.title} ${source.angle}`)
          .join(" ")}`
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesTopic =
        selectedTopic === "All topics"
          ? true
          : storyline.topics.includes(selectedTopic);

      const matchesSource =
        selectedSource === "All sources" ||
        storyline.sources.some((source) => source.source === selectedSource);

      return matchesSearch && matchesTopic && matchesSource;
    });

    if (sortBy === "widest") {
      return [...next].sort(
        (left, right) => right.sources.length - left.sources.length,
      );
    }

    return [...next].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
  }, [deferredSearch, payload.storylines, selectedSource, selectedTopic, sortBy]);

  const comparisonCount = filteredStorylines.reduce(
    (total, storyline) => total + storyline.sources.length,
    0,
  );
  const liveCoverageTone =
    payload.refresh.mode === "cached"
      ? "warning"
      : payload.refresh.partialFailure
        ? "warning"
        : payload.meta.totalNormalizedItems > 0
          ? "success"
          : "warning";

  async function handleRefresh() {
    setIsRefreshing(true);
    setRefreshError(null);
    setRefreshNotice(null);

    try {
      const response = await fetch("/api/coverage", {
        method: "POST",
        cache: "no-store",
      });
      const nextPayload = (await response.json()) as {
        data?: DashboardPayload;
        error?: string;
        notice?: string;
      };

      const nextData = nextPayload.data;

      if (nextData) {
        startTransition(() => {
          setPayload(nextData);
        });
      }

      if (!response.ok) {
        throw new Error(
          nextPayload.error ?? `Refresh failed with ${response.status}`,
        );
      }

      if (nextPayload.notice) {
        setRefreshNotice(nextPayload.notice);
      }
    } catch (error) {
      setRefreshError(
        error instanceof Error && error.message
          ? error.message
          : "Refresh failed. Showing the latest available coverage.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleStoryToggle(storylineId: string) {
    setExpandedStorylines((current) =>
      current.includes(storylineId)
        ? current.filter((entry) => entry !== storylineId)
        : [...current, storylineId],
    );
  }

  function clearFilters() {
    setSearchQuery("");
    setSelectedTopic("All topics");
    setSelectedSource("All sources");
    setSortBy("newest");
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

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <section className="overflow-hidden rounded-[32px] border border-[color:var(--line-strong)] bg-[color:var(--card)] shadow-[0_30px_120px_rgba(15,23,42,0.10)]">
        <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-8 lg:py-10">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill
                label="Live coverage"
                tone={liveCoverageTone}
              />
              <StatusPill label="Server-side aggregation" tone="neutral" />
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
              {refreshError ? (
                <StatusPill label="Refresh degraded" tone="danger" />
              ) : null}
            </div>
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[color:var(--accent)]">
                Ethiopia breaking news and politics
              </p>
              <h1 className="font-headline max-w-4xl text-4xl leading-none font-semibold text-[color:var(--ink)] md:text-6xl">
                Ethiopia News Watch
              </h1>
              <p className="max-w-3xl text-base leading-8 text-[color:var(--ink-soft)]">
                A storyline comparison dashboard that helps you scan how major
                outlets frame the same Ethiopia-centered developments across
                politics, security, diplomacy, elections, and humanitarian
                coverage.
              </p>
            </div>
          </div>

          <div className="grid gap-4 self-start rounded-[28px] border border-[color:var(--line)] bg-[color:var(--card-muted)] p-5">
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex items-center justify-center gap-3 rounded-full bg-[color:var(--accent)] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
            >
              {isRefreshing ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Refresh Ethiopia Coverage
            </button>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[color:var(--line)] bg-white/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                  Last updated
                </p>
                <p className="mt-2 text-base font-semibold text-[color:var(--ink)]">
                  {formatTimestamp(payload.lastUpdated)}
                </p>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-white/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                  Last attempted
                </p>
                <p className="mt-2 text-base font-semibold text-[color:var(--ink)]">
                  {formatTimestamp(payload.refresh.attemptedAt)}
                </p>
              </div>
              <div className="rounded-2xl border border-[color:var(--line)] bg-white/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                  Last successful
                </p>
                <p className="mt-2 text-base font-semibold text-[color:var(--ink)]">
                  {formatTimestamp(payload.refresh.successfulAt)}
                </p>
              </div>
            </div>
            <p className="inline-flex items-center gap-2 text-sm text-[color:var(--ink-soft)]">
              <Sparkles className="h-4 w-4 text-[color:var(--accent)]" />
              Comparing live source coverage with a Ground News-style lens, a
              full-coverage grouping model, and Reuters-style restraint.
            </p>
            {payload.refresh.message ? (
              <p className="text-sm leading-7 text-[color:var(--ink-soft)]">
                {payload.refresh.message}
              </p>
            ) : null}
            {refreshError ? (
              <p className="text-sm leading-7 text-[color:var(--ink-soft)]">
                {refreshError}
              </p>
            ) : null}
            {refreshNotice ? (
              <p className="text-sm leading-7 text-[color:var(--ink-soft)]">
                {refreshNotice}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[0_20px_80px_rgba(17,24,39,0.06)] lg:p-6">
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr_220px_220px]">
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-4 h-4 w-4 text-[color:var(--ink-soft)]" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search storylines, angles, or source language"
              className="h-[52px] w-full rounded-full border border-[color:var(--line)] bg-[color:var(--card-muted)] px-11 text-sm text-[color:var(--ink)] outline-none transition focus:border-[color:var(--accent)]"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {TOPIC_OPTIONS.map((topic) => (
              <TopicChip
                key={topic}
                label={topic}
                active={selectedTopic === topic}
                onClick={() => setSelectedTopic(topic)}
              />
            ))}
          </div>

          <label className="rounded-full border border-[color:var(--line)] bg-[color:var(--card-muted)] px-4">
            <span className="sr-only">Filter by source</span>
            <select
              value={selectedSource}
              onChange={(event) =>
                setSelectedSource(event.target.value as SourceFilter)
              }
              className="h-[52px] w-full bg-transparent text-sm font-medium text-[color:var(--ink)] outline-none"
            >
              {SOURCE_OPTIONS.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>

          <label className="rounded-full border border-[color:var(--line)] bg-[color:var(--card-muted)] px-4">
            <span className="sr-only">Sort storylines</span>
            <div className="flex h-[52px] items-center gap-2">
              <ArrowDownUp className="h-4 w-4 text-[color:var(--ink-soft)]" />
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortValue)}
                className="w-full bg-transparent text-sm font-medium text-[color:var(--ink)] outline-none"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>
      </section>

      <section className="space-y-6">
        <SectionHeading
          eyebrow="Main section"
          title="Grouped Storylines"
          description="Clustered live coverage so you can compare how each outlet frames the same Ethiopia-related development instead of scanning a flat article list."
          action={
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--card)] px-4 py-2 text-sm text-[color:var(--ink-soft)]">
              <span>{filteredStorylines.length} storylines</span>
              <span className="h-1 w-1 rounded-full bg-[color:var(--ink-soft)]" />
              <span>{comparisonCount} source comparisons</span>
            </div>
          }
        />

        {isRefreshing ? (
          <div className="grid gap-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                className="overflow-hidden rounded-[28px] border border-[color:var(--line)] bg-[color:var(--card)] p-6 shadow-[0_20px_80px_rgba(17,24,39,0.06)]"
              >
                <div className="animate-pulse space-y-4">
                  <div className="flex gap-2">
                    <div className="h-7 w-24 rounded-full bg-[color:var(--card-muted)]" />
                    <div className="h-7 w-20 rounded-full bg-[color:var(--card-muted)]" />
                  </div>
                  <div className="space-y-3">
                    <div className="h-9 w-4/5 rounded-xl bg-[color:var(--card-muted)]" />
                    <div className="h-4 w-full rounded-full bg-[color:var(--card-muted)]" />
                    <div className="h-4 w-3/4 rounded-full bg-[color:var(--card-muted)]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredStorylines.length === 0 ? (
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
              onClick={clearFilters}
              className="mt-6 inline-flex items-center justify-center rounded-full border border-[color:var(--ink)] px-5 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--ink)] hover:text-white"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid gap-5">
            {filteredStorylines.map((storyline) => (
              <StorylineCard
                key={storyline.id}
                storyline={storyline}
                expanded={expandedStorylines.includes(storyline.id)}
                onToggle={() => handleStoryToggle(storyline.id)}
                formatTime={formatTimestamp}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-6">
        <SectionHeading
          eyebrow="Secondary section"
          title="Latest by Source"
          description="The freshest Ethiopia-related item kept for each source so you can scan outlet-by-outlet movement without leaving the comparison dashboard."
        />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {payload.latestBySource.map((entry) => (
            <LatestSourceCard
              key={entry.source}
              entry={entry}
              formatTime={formatTimestamp}
            />
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <SectionHeading
          eyebrow="Operational panel"
          title="Source Status"
          description="Live fetch health across the monitored sources, including graceful degradation when a source blocks or fails during refresh."
        />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {payload.sourceStatus.map((entry) => (
            <SourceStatusCard
              key={entry.source}
              entry={entry}
              formatTime={formatTimestamp}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
