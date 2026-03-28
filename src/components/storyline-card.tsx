import {
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Languages,
  RadioTower,
} from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { TopicChip } from "@/components/topic-chip";
import type { DashboardStoryline } from "@/lib/dashboard";

interface StorylineCardProps {
  storyline: DashboardStoryline;
  expanded: boolean;
  onToggle: () => void;
  formatTime: (value: string) => string;
}

const coverageTone = {
  covered: { label: "Live", tone: "success" as const },
  watching: { label: "Fallback", tone: "warning" as const },
  limited: { label: "Cached", tone: "danger" as const },
};

export function StorylineCard({
  storyline,
  expanded,
  onToggle,
  formatTime,
}: StorylineCardProps) {
  const coveredSourceCount = storyline.sources.filter(
    (source) => source.state !== "limited",
  ).length;

  return (
    <article className="overflow-hidden rounded-[28px] border border-[color:var(--line)] bg-[color:var(--card)] shadow-[0_20px_80px_rgba(17,24,39,0.08)]">
      <div className="border-b border-[color:var(--line)] px-6 py-6 md:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {storyline.topics.map((topic) => (
                <TopicChip key={topic} label={topic} />
              ))}
              <StatusPill
                label={`${coveredSourceCount} sources`}
                tone="neutral"
              />
            </div>
            <div className="space-y-3">
              <h3 className="font-headline max-w-4xl text-2xl leading-tight font-semibold text-[color:var(--ink)] md:text-[2rem]">
                {storyline.headline}
              </h3>
              <p className="max-w-3xl text-sm leading-7 text-[color:var(--ink-soft)] md:text-base">
                {storyline.summary}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line)] bg-white/70 px-3 py-2 text-xs font-medium text-[color:var(--ink-soft)]">
              <Clock3 className="h-3.5 w-3.5" />
              Updated {formatTime(storyline.updatedAt)}
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--ink)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--ink-soft)]"
            >
              {expanded ? "Hide comparison" : "Compare coverage"}
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 bg-[color:var(--card-muted)] px-6 py-5 md:px-8">
          {storyline.sources.map((source) => {
            const tone = coverageTone[source.state];

            return (
              <div
                key={`${storyline.id}-${source.source}`}
                className="grid gap-3 rounded-2xl border border-[color:var(--line)] bg-white/80 px-4 py-4 md:grid-cols-[180px_1fr_auto]"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-[color:var(--card-muted)] p-2 text-[color:var(--accent)]">
                    <RadioTower className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[color:var(--ink)]">
                      {source.source}
                    </p>
                    <div className="inline-flex items-center gap-1 text-xs text-[color:var(--ink-soft)]">
                      <Languages className="h-3.5 w-3.5" />
                      {source.language}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold leading-6 text-[color:var(--ink)]">
                    {source.title}
                  </p>
                  <p className="text-sm leading-6 text-[color:var(--ink-soft)]">
                    {source.angle}
                  </p>
                  <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--ink-soft)]/80">
                    Updated {formatTime(source.updatedAt)}
                  </p>
                </div>
                <div className="flex items-start gap-3 md:flex-col md:items-end">
                  <StatusPill label={tone.label} tone={tone.tone} />
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--accent)] transition hover:text-[color:var(--accent-strong)]"
                    >
                      Open original
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
