import { Languages } from "lucide-react";

import type { LanguageLabel } from "@/lib/dashboard";

interface OriginalLanguageIndicatorProps {
  originalLanguage?: LanguageLabel | null;
  className?: string;
}

export function OriginalLanguageIndicator({
  originalLanguage,
  className = "",
}: OriginalLanguageIndicatorProps) {
  if (!originalLanguage || originalLanguage === "English") {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-[color:var(--ink-soft)] ${className}`.trim()}
      title={`Originally published in ${originalLanguage}. Opening this story prepares the English reader.`}
    >
      <Languages className="h-3.5 w-3.5" />
      {originalLanguage}
    </span>
  );
}
