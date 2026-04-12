import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  TriangleAlert,
} from "lucide-react";

import { SourceBadge } from "@/components/source-badge";
import { StatusPill } from "@/components/status-pill";
import type { SourceStatusEntry } from "@/lib/dashboard";

interface SourceStatusCardProps {
  entry: SourceStatusEntry;
  formatTime: (value: string) => string;
}

const statusConfig = {
  online: {
    label: "Online",
    tone: "success" as const,
    icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    tone: "warning" as const,
    icon: TriangleAlert,
  },
  failed: {
    label: "Failed",
    tone: "danger" as const,
    icon: AlertTriangle,
  },
};

export function SourceStatusCard({
  entry,
  formatTime,
}: SourceStatusCardProps) {
  const config = statusConfig[entry.status];
  const Icon = config.icon;
  const showHealthDetail = entry.healthLabel !== config.label;

  return (
    <article className="rounded-[24px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[0_16px_50px_rgba(17,24,39,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--ink)]">
            <Icon className="h-4 w-4 text-[color:var(--accent)]" />
            <SourceBadge source={entry.source} size="xs" />
          </div>
          <p className="text-sm leading-6 text-[color:var(--ink-soft)]">
            {entry.note}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={config.label} tone={config.tone} />
          {showHealthDetail ? (
            <StatusPill
              label={entry.healthLabel}
              tone={entry.healthKind === "cached" ? "warning" : "neutral"}
            />
          ) : null}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
        <span>{entry.coverageCount} relevant items</span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" />
          Checked {formatTime(entry.checkedAt)}
        </span>
        {entry.lastSuccessfulAt ? (
          <span>Last good {formatTime(entry.lastSuccessfulAt)}</span>
        ) : null}
        {entry.usedCachedItems ? <span>Using cached source data</span> : null}
      </div>
    </article>
  );
}
