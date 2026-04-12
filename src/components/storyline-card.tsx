import Link from "next/link";
import { memo, type CSSProperties, type ReactNode } from "react";

import {
  ChevronDown,
  ChevronUp,
  Clock3,
} from "lucide-react";

import { OriginalLanguageIndicator } from "@/components/original-language-indicator";
import { SourceBadge } from "@/components/source-badge";
import { StoryThumbnail } from "@/components/story-thumbnail";
import { StatusPill } from "@/components/status-pill";
import { TopicChip } from "@/components/topic-chip";
import type { DashboardStoryline, StorylineSourceRow, TopicName } from "@/lib/dashboard";
import { buildStoryReaderHref, shouldUseInternalStoryReader } from "@/lib/story-links";

interface StorylineCardProps {
  storyline: DashboardStoryline;
  defaultExpanded?: boolean;
  formatTime: (value: string) => string;
  anchorId?: string;
  onTopicSelect?: (topic: TopicName) => void;
  highlightFeed?: boolean;
  feedOutlineColor?: string;
  motionPreset?: number;
}

function getUniqueSources(sources: StorylineSourceRow[]) {
  return [...new Set(sources.map((source) => source.source))];
}

function formatSourceCountLabel(sourceCount: number) {
  return sourceCount === 1 ? "1 source" : `${sourceCount} sources`;
}

function SourceAttribution({
  sources,
}: {
  sources: StorylineSourceRow[];
}) {
  const uniqueSources = getUniqueSources(sources);
  const label = uniqueSources.length === 1 ? "Source" : "Sources";

  return (
    <span className="block space-y-2">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
        {label}
      </span>
      <span className="flex flex-wrap gap-2">
        {uniqueSources.map((source) => (
          <span
            key={source}
            className="inline-flex max-w-full items-center rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-2.5 py-1.5"
          >
            <SourceBadge
              source={source}
              size="sm"
              nameClassName="text-[13px]"
            />
          </span>
        ))}
      </span>
    </span>
  );
}

function SourceIdentity({
  source,
}: {
  source: StorylineSourceRow;
}) {
  const showOriginalLanguageIndicator =
    source.originalLanguage &&
    source.originalLanguage !== "English";

  return (
    <div className="flex items-start gap-3">
      <div className="space-y-1">
        <SourceBadge source={source.source} size="sm" />
        {showOriginalLanguageIndicator ? (
          <OriginalLanguageIndicator originalLanguage={source.originalLanguage} />
        ) : null}
      </div>
    </div>
  );
}

function StorySourceLink({
  children,
  className,
  source,
}: {
  children: ReactNode;
  className: string;
  source: StorylineSourceRow;
}) {
  if (!source.url) {
    return <>{children}</>;
  }

  if (shouldUseInternalStoryReader(source)) {
    return (
      <Link
        href={buildStoryReaderHref({
          ...source,
          snippet: source.angle,
        })}
        prefetch={false}
        className={className}
      >
        {children}
      </Link>
    );
  }

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

function StorylineCardComponent({
  storyline,
  defaultExpanded = false,
  formatTime,
  anchorId,
  onTopicSelect,
  highlightFeed = false,
  feedOutlineColor,
  motionPreset = 0,
}: StorylineCardProps) {
  const sourceCount = storyline.sources.length;
  const hasComparison = sourceCount > 1;
  const primarySource = storyline.sources[0] ?? null;
  const showPrimaryOriginalLanguageIndicator =
    Boolean(primarySource) &&
    primarySource.originalLanguage &&
    primarySource.originalLanguage !== "English";
  const topicSummary = storyline.topics.join(" / ");
  const normalizedMotionPreset = Math.abs(motionPreset % 4);
  const motionDirection =
    normalizedMotionPreset % 2 === 0 ? "normal" : "reverse";
  const highlightedCardStyle: CSSProperties | undefined = highlightFeed
    ? ({
        "--live-feed-outline": feedOutlineColor ?? "var(--topic-feed-outline)",
        "--live-feed-angle": `${118 + normalizedMotionPreset * 14}deg`,
        "--live-feed-duration": `${5.9 + normalizedMotionPreset * 0.7}s`,
        "--live-feed-ambient-duration": `${8.4 + normalizedMotionPreset * 0.9}s`,
        "--live-feed-delay": `${normalizedMotionPreset * -1.55}s`,
        "--live-feed-opacity": `${0.82 + normalizedMotionPreset * 0.03}`,
        "--live-feed-glow-opacity": `${0.38 + normalizedMotionPreset * 0.03}`,
        "--live-feed-border-direction": motionDirection,
        "--live-feed-ambient-direction": motionDirection,
        borderColor: feedOutlineColor ?? "var(--topic-feed-outline)",
      } as CSSProperties)
    : undefined;

  const headerContent = (
    <span className="block space-y-4 px-6 py-6 md:px-8">
      <span className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill
            label={formatSourceCountLabel(sourceCount)}
            tone="neutral"
          />
          {topicSummary ? (
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {topicSummary}
            </span>
          ) : null}
        </span>
        {hasComparison ? (
          <span className="inline-flex items-center justify-center gap-2 self-start rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-4 py-2.5 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-[color:var(--card)]">
            <span className="storyline-disclosure__label-closed">
              Compare coverage
            </span>
            <span className="storyline-disclosure__label-open">
              Hide comparison
            </span>
            <ChevronDown className="storyline-disclosure__icon-closed h-4 w-4" />
            <ChevronUp className="storyline-disclosure__icon-open h-4 w-4" />
          </span>
        ) : null}
      </span>

      <span className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <span className="block flex-1 space-y-3">
          <SourceAttribution sources={storyline.sources} />
          {showPrimaryOriginalLanguageIndicator ? (
            <OriginalLanguageIndicator
              originalLanguage={primarySource?.originalLanguage}
            />
          ) : null}
          <span className="font-headline block max-w-4xl text-2xl leading-tight font-semibold text-[color:var(--ink)] md:text-[2rem]">
            {!hasComparison && primarySource?.url ? (
              <StorySourceLink
                source={primarySource}
                className="transition hover:text-[color:var(--accent)] hover:underline focus-visible:text-[color:var(--accent)] focus-visible:underline"
              >
                {storyline.headline}
              </StorySourceLink>
            ) : (
              storyline.headline
            )}
          </span>
          <span
            className={`block max-w-3xl text-sm leading-7 text-[color:var(--ink-soft)] md:text-base ${
              hasComparison ? "storyline-disclosure__preview-copy" : ""
            }`}
          >
            {storyline.summary}
          </span>
        </span>
        {primarySource ? (
          <div className="xl:pt-1">
            <StoryThumbnail
              articleUrl={primarySource.url}
              imageUrl={primarySource.imageUrl}
              source={primarySource.source}
              size="hero"
            />
          </div>
        ) : null}
      </span>

      <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-3 py-2 text-xs font-medium text-[color:var(--ink-soft)]">
        <Clock3 className="h-3.5 w-3.5" />
        Updated {formatTime(storyline.updatedAt)}
      </span>
    </span>
  );

  return (
    <article
      id={anchorId}
      className={`storyline-card-shell overflow-hidden rounded-[28px] border border-[color:var(--line)] bg-[color:var(--card)] shadow-[0_20px_80px_rgba(17,24,39,0.08)] ${
        highlightFeed ? "live-feed-card" : ""
      }`}
      style={highlightedCardStyle}
    >
      {hasComparison ? (
        <details open={defaultExpanded} className="storyline-disclosure">
          <summary className="storyline-disclosure__summary block list-none">
            {headerContent}
          </summary>

          <div className="border-t border-[color:var(--line)] px-6 py-5 md:px-8">
            {storyline.topics.length > 0 ? (
              <div className="flex flex-wrap gap-x-6 gap-y-3 pb-5">
                {storyline.topics.map((topic) => (
                  <TopicChip
                    key={topic}
                    label={topic}
                    onClick={() => onTopicSelect?.(topic)}
                  />
                ))}
              </div>
            ) : null}

            <div className="divide-y divide-[color:var(--line)]">
              {storyline.sources.map((source) => {
                return (
                  <div
                    key={`${storyline.id}-${source.source}`}
                    className="grid gap-4 py-5 md:grid-cols-[180px_minmax(0,1fr)_144px] md:items-start"
                  >
                    <SourceIdentity source={source} />
                    <div className="space-y-2">
                      {source.url ? (
                        <StorySourceLink
                          source={source}
                          className="inline text-sm font-semibold leading-6 text-[color:var(--ink)] transition hover:text-[color:var(--accent)] hover:underline focus-visible:text-[color:var(--accent)] focus-visible:underline"
                        >
                          {source.title}
                        </StorySourceLink>
                      ) : (
                        <p className="text-sm font-semibold leading-6 text-[color:var(--ink)]">
                          {source.title}
                        </p>
                      )}
                      <p className="text-sm leading-6 text-[color:var(--ink-soft)]">
                        {source.angle}
                      </p>
                      <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--ink-soft)]/80">
                        Updated {formatTime(source.updatedAt)}
                      </p>
                    </div>
                    <div className="md:justify-self-end">
                      <StoryThumbnail
                        articleUrl={source.url}
                        imageUrl={source.imageUrl}
                        source={source.source}
                        size="row"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      ) : (
        <div>{headerContent}</div>
      )}
    </article>
  );
}

export const StorylineCard = memo(StorylineCardComponent);
StorylineCard.displayName = "StorylineCard";
