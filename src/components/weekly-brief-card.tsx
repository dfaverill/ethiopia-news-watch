import {
  Bot,
  CalendarRange,
  Sparkles,
} from "lucide-react";

import { PodcastAudioPlayer } from "@/components/podcast-audio-player";
import { StatusPill } from "@/components/status-pill";
import type { WeeklyBrief } from "@/lib/dashboard";
import type { ElevenLabsPodcastPublicState } from "@/lib/elevenlabs-podcast";
import type { NotebookLmPodcastPublicState } from "@/lib/notebooklm-podcast";
import type { PodcastArchiveEntry } from "@/lib/podcast-archive";
import { buildHalfListPreview, buildHalfWordPreview } from "@/lib/word-preview";

interface WeeklyBriefCardProps {
  brief: WeeklyBrief;
  formatDate: (value: string) => string;
  weeklyPodcast: NotebookLmPodcastPublicState | null;
  weeklyPodcastNotice?: string | null;
  isWeeklyPodcastLoading?: boolean;
  isWeeklyPodcastStarting?: boolean;
  onGenerateWeeklyPodcast?: (force?: boolean) => void;
  weeklyArchives: PodcastArchiveEntry[];
  recentPodcast: NotebookLmPodcastPublicState | null;
  recentPodcastNotice?: string | null;
  isRecentPodcastLoading?: boolean;
  isRecentPodcastStarting?: boolean;
  onGenerateRecentPodcast?: (force?: boolean) => void;
  recentArchives: PodcastArchiveEntry[];
  scriptedRecentPodcast: ElevenLabsPodcastPublicState | null;
  scriptedRecentPodcastNotice?: string | null;
  isScriptedRecentPodcastLoading?: boolean;
  isScriptedRecentPodcastStarting?: boolean;
  onGenerateScriptedRecentPodcast?: (force?: boolean) => void;
  scriptedRecentArchives: PodcastArchiveEntry[];
}

interface PodcastEpisodeCardState {
  audioUrl: string | null;
  canGenerate: boolean;
  error: string | null;
  headline?: string | null;
  jobKey: string | null;
  label: string;
  matchesCurrentCoverage: boolean;
  message: string | null;
  notebookUrl?: string | null;
  scope: "weekly" | "recent";
  scriptUrl?: string | null;
  sourceLabel: string;
  status: "idle" | "queued" | "auth-required" | "running" | "ready" | "failed" | "stale";
  theme?: string | null;
  windowEnd: string | null;
  windowStart: string | null;
}

function formatWindow(brief: WeeklyBrief, formatDate: (value: string) => string) {
  if (!brief.windowStart || !brief.windowEnd) {
    return "Last 7 days";
  }

  return `${formatDate(brief.windowStart)} to ${formatDate(brief.windowEnd)}`;
}

function buildDisclosureId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function BulletList({
  items,
}: {
  items: Array<{ text: string; truncated?: boolean }>;
}) {
  return (
    <ul className="space-y-2.5 text-[13px] leading-[1.45] text-[color:var(--ink-soft)]">
      {items.map((item, index) => (
        <li key={`${item.text}-${index}`} className="flex gap-2">
          <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ink)]" />
          <span>
            {item.text}
            {item.truncated ? (
              <span className="weekly-brief-disclosure__ellipsis">...</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BulletListDisclosure({
  items,
  emptyMessage,
  disclosureId,
}: {
  items: string[];
  emptyMessage: string;
  disclosureId: string;
}) {
  const preview = buildHalfListPreview(items);

  if (preview.itemCount === 0) {
    return (
      <p className="mt-4 text-sm leading-6 text-[color:var(--ink-soft)]">
        {emptyMessage}
      </p>
    );
  }

  if (!preview.hasOverflow) {
    return (
      <div className="mt-4">
        <BulletList items={preview.preview} />
      </div>
    );
  }

  return (
    <div className="weekly-brief-disclosure weekly-brief-disclosure--compact mt-4">
      <input
        id={disclosureId}
        type="checkbox"
        className="weekly-brief-disclosure__input"
      />
      <div className="weekly-brief-disclosure__body">
        <div className="weekly-brief-disclosure__preview-list">
          <BulletList items={preview.preview} />
        </div>
        <div className="weekly-brief-disclosure__full-list">
          <BulletList items={preview.normalized.map((text) => ({ text }))} />
        </div>
      </div>
      <div className="weekly-brief-disclosure__actions">
        <label
          htmlFor={disclosureId}
          className="weekly-brief-disclosure__button weekly-brief-disclosure__button--compact inline-flex cursor-pointer list-none items-center rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
        >
          <span className="weekly-brief-disclosure__label-closed">
            Show more
          </span>
          <span className="weekly-brief-disclosure__label-open">
            Show less
          </span>
        </label>
      </div>
    </div>
  );
}

function buildPodcastPlaybackLabel(
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
  useUtcDisplayDates: boolean,
  formatDate: (value: string) => string,
) {
  if (!windowStart || !windowEnd) {
    return "Ethiopia News Watch";
  }

  const formatWindowDate = (value: string) => {
    if (!useUtcDisplayDates) {
      return formatDate(value);
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return formatDate(value);
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  };

  return `Ethiopia News Watch | ${formatWindowDate(windowStart)} to ${formatWindowDate(windowEnd)}`;
}

interface PodcastEpisodeSectionProps {
  archives: PodcastArchiveEntry[];
  formatDate: (value: string) => string;
  podcast: PodcastEpisodeCardState | null;
  title: string;
  archiveTitle?: string;
  emptyStateMessage?: string;
  fallbackWindowEnd?: string | null;
  fallbackWindowStart?: string | null;
}

function PastPodcastArchiveDropdown({
  archives,
  formatDate,
  title,
  archiveTitle,
}: {
  archives: PodcastArchiveEntry[];
  formatDate: (value: string) => string;
  title: string;
  archiveTitle?: string;
}) {
  if (archives.length === 0) {
    return null;
  }

  return (
    <details className="space-y-4 border-t border-[color:var(--line)] pt-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-4 py-3 text-sm font-semibold text-[color:var(--ink)] transition hover:border-[color:var(--line-strong)]">
        <span className="inline-flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-[color:var(--accent)]" />
          Past {(archiveTitle ?? title.toLowerCase())} episodes
        </span>
        <span className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
          {archives.length} saved
        </span>
      </summary>

      <div className="space-y-3">
        {archives.map((archive) => (
          <div
            key={archive.id}
            className="rounded-[18px] border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-4 py-4"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[color:var(--ink)]">
                  {archive.label}
                </p>
                {archive.savedAt ? (
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    Saved {formatDate(archive.savedAt)}
                  </p>
                ) : null}
              </div>

              <a
                href={archive.downloadUrl}
                className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)] transition hover:text-[color:var(--ink)]"
              >
                Download audio
              </a>
            </div>

            <PodcastAudioPlayer
              className="mt-3"
              src={archive.audioUrl}
            />
          </div>
        ))}
      </div>
    </details>
  );
}

function PodcastEpisodeSection({
  archives,
  archiveTitle,
  emptyStateMessage,
  formatDate,
  podcast,
  title,
  fallbackWindowEnd = null,
  fallbackWindowStart = null,
}: PodcastEpisodeSectionProps) {
  const windowStart = podcast?.windowStart ?? fallbackWindowStart;
  const windowEnd = podcast?.windowEnd ?? fallbackWindowEnd;
  const currentAudioUrl = podcast?.audioUrl ?? null;
  const podcastPlaybackLabel = buildPodcastPlaybackLabel(
    windowStart,
    windowEnd,
    podcast?.scope === "recent",
    formatDate,
  );
  const hasCurrentAudio = Boolean(currentAudioUrl);

  if (!podcast && archives.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {hasCurrentAudio ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--ink)]">
                <Sparkles className="h-4 w-4 text-[color:var(--accent)]" />
                {podcastPlaybackLabel}
              </div>
              <a
                href={`${currentAudioUrl}&download=1`}
                className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)] transition hover:text-[color:var(--ink)]"
              >
                Download audio
              </a>
            </div>

            {currentAudioUrl ? (
              <PodcastAudioPlayer src={currentAudioUrl} />
            ) : null}
          </div>
        ) : null}

        {!hasCurrentAudio && emptyStateMessage ? (
          <p className="text-sm leading-6 text-[color:var(--ink-soft)]">
            {emptyStateMessage}
          </p>
        ) : null}

        <PastPodcastArchiveDropdown
          archives={archives}
          archiveTitle={archiveTitle}
          formatDate={formatDate}
          title={title}
        />
      </div>
    </div>
  );
}

export function WeeklyBriefCard({
  brief,
  formatDate,
  weeklyPodcast,
  weeklyArchives,
  recentPodcast,
  recentArchives,
  scriptedRecentPodcast,
  scriptedRecentArchives,
}: WeeklyBriefCardProps) {
  const isReady = brief.status === "ready";
  const summaryPreview = buildHalfWordPreview(brief.summary);
  const disclosureBaseId = buildDisclosureId(
    brief.generatedAt || brief.headline || "summary",
  );
  const disclosureId = `weekly-brief-${disclosureBaseId}`;
  const keyPointsDisclosureId = `weekly-brief-key-points-${disclosureBaseId}`;
  const sourceDifferencesDisclosureId = `weekly-brief-source-differences-${disclosureBaseId}`;
  const hasWeeklyPodcastSection =
    Boolean(weeklyPodcast) || weeklyArchives.length > 0;
  const hasRecentPodcastSection =
    Boolean(recentPodcast) || recentArchives.length > 0;
  const hasScriptedRecentPodcastSection =
    Boolean(scriptedRecentPodcast) || scriptedRecentArchives.length > 0;
  const hasAnyPodcastSection =
    hasWeeklyPodcastSection ||
    hasRecentPodcastSection ||
    hasScriptedRecentPodcastSection;

  return (
    <section className="overflow-hidden rounded-[28px] border border-[color:var(--line)] bg-[color:var(--card)] shadow-[0_20px_80px_rgba(17,24,39,0.06)]">
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_1fr] lg:px-8">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              label={isReady ? "AI weekly brief" : "AI unavailable"}
              tone={isReady ? "success" : "warning"}
            />
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              <CalendarRange className="h-3.5 w-3.5" />
              {formatWindow(brief, formatDate)}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent)]">
              Top summary
            </p>
            <h2 className="font-headline text-3xl leading-tight font-semibold text-[color:var(--ink)]">
              {brief.headline}
            </h2>
            <div className="max-w-3xl space-y-3">
              {summaryPreview.hasOverflow ? (
                <div className="weekly-brief-disclosure">
                  <input
                    id={disclosureId}
                    type="checkbox"
                    className="weekly-brief-disclosure__input"
                  />
                  <div className="weekly-brief-disclosure__body">
                    <p className="text-sm leading-7 text-[color:var(--ink-soft)] md:text-base">
                      <span className="weekly-brief-disclosure__preview">
                        {summaryPreview.preview}
                        <span className="weekly-brief-disclosure__ellipsis">
                          ...
                        </span>
                      </span>
                      <span className="weekly-brief-disclosure__full">
                        {summaryPreview.normalized}
                      </span>
                    </p>
                  </div>
                  <div className="weekly-brief-disclosure__actions">
                    <label
                      htmlFor={disclosureId}
                      className="weekly-brief-disclosure__button inline-flex cursor-pointer list-none items-center rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
                    >
                      <span className="weekly-brief-disclosure__label-closed">
                        Read more
                      </span>
                      <span className="weekly-brief-disclosure__label-open">
                        Show less
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}
              {!summaryPreview.hasOverflow ? (
                <p className="text-sm leading-7 text-[color:var(--ink-soft)] md:text-base">
                  {summaryPreview.normalized}
                </p>
              ) : null}
            </div>
          </div>

          {brief.note ? (
            <p className="inline-flex items-start gap-2 text-sm leading-6 text-[color:var(--ink-soft)]">
              <Sparkles className="mt-0.5 h-4 w-4 text-[color:var(--accent)]" />
              {brief.note}
            </p>
          ) : null}
        </div>

        <div className="grid gap-6 md:grid-cols-2 md:gap-8 lg:border-l lg:border-[color:var(--line)] lg:pl-8">
          <div className="border-t border-[color:var(--line)] pt-4 md:border-t-0 md:pt-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--ink)]">
              <Bot className="h-4 w-4" />
              Key developments
            </div>
            <BulletListDisclosure
              items={brief.keyPoints}
              emptyMessage="Weekly AI points will appear here after the OpenAI summary feature is configured."
              disclosureId={keyPointsDisclosureId}
            />
          </div>

          <div className="border-t border-[color:var(--line)] pt-4 md:border-t-0 md:pt-0">
            <p className="text-sm font-semibold text-[color:var(--ink)]">
              Where sources differed
            </p>
            <BulletListDisclosure
              items={brief.sourceDifferences}
              emptyMessage="Cross-source framing differences will show up here when the AI brief is available."
              disclosureId={sourceDifferencesDisclosureId}
            />
          </div>
        </div>
      </div>

      {hasAnyPodcastSection ? (
        <div className="border-t border-[color:var(--line)] px-6 py-5 lg:px-8">
          <div className="space-y-6">
            {hasWeeklyPodcastSection ? (
              <PodcastEpisodeSection
                archives={weeklyArchives}
                archiveTitle="weekly podcast"
                title="Weekly podcast"
                formatDate={formatDate}
                podcast={weeklyPodcast}
                emptyStateMessage="Current weekly audio is not available right now."
                fallbackWindowStart={brief.windowStart}
                fallbackWindowEnd={brief.windowEnd}
              />
            ) : null}

            {hasRecentPodcastSection ? (
              <div
                className={
                  hasWeeklyPodcastSection
                    ? "border-t border-[color:var(--line)] pt-6"
                    : undefined
                }
              >
                <PodcastEpisodeSection
                  archives={recentArchives}
                  archiveTitle="48 hours podcast"
                  title="Last two days podcast"
                  formatDate={formatDate}
                  podcast={recentPodcast}
                  emptyStateMessage="Current 48-hour audio is not available right now."
                  fallbackWindowStart={recentPodcast?.windowStart}
                  fallbackWindowEnd={recentPodcast?.windowEnd}
                />
              </div>
            ) : null}

            {hasScriptedRecentPodcastSection ? (
              <div
                className={
                  hasWeeklyPodcastSection || hasRecentPodcastSection
                    ? "border-t border-[color:var(--line)] pt-6"
                    : undefined
                }
              >
                <PodcastEpisodeSection
                  archives={scriptedRecentArchives}
                  archiveTitle="48 hours scripted podcast"
                  title="Last two days scripted podcast"
                  formatDate={formatDate}
                  podcast={scriptedRecentPodcast}
                  emptyStateMessage="Current scripted 48-hour audio is not available right now."
                  fallbackWindowStart={recentPodcast?.windowStart}
                  fallbackWindowEnd={recentPodcast?.windowEnd}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
