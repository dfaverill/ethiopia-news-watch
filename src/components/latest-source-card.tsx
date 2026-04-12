import Link from "next/link";
import { Clock3 } from "lucide-react";

import { OriginalLanguageIndicator } from "@/components/original-language-indicator";
import { SourceBadge } from "@/components/source-badge";
import { StoryThumbnail } from "@/components/story-thumbnail";
import { StatusPill } from "@/components/status-pill";
import { TopicChip } from "@/components/topic-chip";
import type { LatestSourceEntry } from "@/lib/dashboard";
import { buildStoryReaderHref, shouldUseInternalStoryReader } from "@/lib/story-links";

interface LatestSourceCardProps {
  entry: LatestSourceEntry;
  formatTime: (value: string) => string;
}

const statusTone = {
  online: "success" as const,
  degraded: "warning" as const,
  failed: "danger" as const,
};

const statusLabel = {
  online: "Online",
  degraded: "Degraded",
  failed: "Failed",
};

export function LatestSourceCard({
  entry,
  formatTime,
}: LatestSourceCardProps) {
  const showOriginalLanguageIndicator =
    shouldUseInternalStoryReader(entry) &&
    entry.originalLanguage &&
    entry.originalLanguage !== "English";
  const headlineClassName =
    "transition hover:text-[color:var(--accent)] hover:underline focus-visible:text-[color:var(--accent)] focus-visible:underline";

  return (
    <article className="flex h-full flex-col justify-between rounded-[24px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[0_16px_50px_rgba(17,24,39,0.06)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SourceBadge source={entry.source} size="sm" />
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              label={statusLabel[entry.status]}
              tone={statusTone[entry.status]}
            />
            {entry.usedCachedItems ? (
              <StatusPill label="Cached" tone="warning" />
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1 space-y-3">
            <TopicChip label={entry.topic} />
            <h3 className="font-headline text-xl leading-snug font-semibold text-[color:var(--ink)]">
              {entry.url ? (
                shouldUseInternalStoryReader(entry) ? (
                  <Link
                    href={buildStoryReaderHref({
                      source: entry.source,
                      title: entry.headline,
                      updatedAt: entry.updatedAt,
                      url: entry.url,
                      originalLanguage: entry.originalLanguage,
                      snippet: entry.note,
                    })}
                    prefetch={false}
                    className={headlineClassName}
                  >
                    {entry.headline}
                  </Link>
                ) : (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className={headlineClassName}
                  >
                    {entry.headline}
                  </a>
                )
              ) : (
                entry.headline
              )}
            </h3>
            <p className="text-sm leading-6 text-[color:var(--ink-soft)]">
              {entry.note}
            </p>
          </div>
          <StoryThumbnail
            articleUrl={entry.url}
            imageUrl={entry.imageUrl}
            source={entry.source}
            size="card"
          />
        </div>
      </div>
      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-[color:var(--ink-soft)]">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" />
            {formatTime(entry.updatedAt)}
          </span>
          {showOriginalLanguageIndicator ? (
            <OriginalLanguageIndicator originalLanguage={entry.originalLanguage} />
          ) : null}
        </div>
      </div>
    </article>
  );
}
