import { Clock3, ExternalLink, Languages } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { TopicChip } from "@/components/topic-chip";
import type { LatestSourceEntry } from "@/lib/dashboard";

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
  return (
    <article className="flex h-full flex-col justify-between rounded-[24px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[0_16px_50px_rgba(17,24,39,0.06)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[color:var(--ink)]">
            {entry.source}
          </p>
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
        <div className="space-y-3">
          <TopicChip label={entry.topic} />
          <h3 className="font-headline text-xl leading-snug font-semibold text-[color:var(--ink)]">
            {entry.headline}
          </h3>
          <p className="text-sm leading-6 text-[color:var(--ink-soft)]">
            {entry.note}
          </p>
        </div>
      </div>
      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-[color:var(--ink-soft)]">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" />
            {formatTime(entry.updatedAt)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5" />
            {entry.language}
          </span>
        </div>
        {entry.url ? (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--accent)] transition hover:text-[color:var(--accent-strong)]"
          >
            Open original
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </article>
  );
}
