import { ReactNode } from "react";

interface SectionHeadingProps {
  title: string;
  description: string;
  eyebrow?: string;
  action?: ReactNode;
}

export function SectionHeading({
  title,
  description,
  eyebrow,
  action,
}: SectionHeadingProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent)]">
            {eyebrow}
          </p>
        ) : null}
        <div className="space-y-1">
          <h2 className="font-headline text-3xl font-semibold text-[color:var(--ink)]">
            {title}
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-[color:var(--ink-soft)]">
            {description}
          </p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
