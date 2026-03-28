interface TopicChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

const topicPalette: Record<string, string> = {
  Politics:
    "border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-400 hover:bg-slate-200",
  Election:
    "border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-400 hover:bg-blue-100",
  Conflict:
    "border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100",
  Diplomacy:
    "border-cyan-300 bg-cyan-50 text-cyan-700 hover:border-cyan-400 hover:bg-cyan-100",
  Economy:
    "border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100",
  Humanitarian:
    "border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100",
};

export function TopicChip({
  label,
  active = false,
  onClick,
}: TopicChipProps) {
  const palette =
    topicPalette[label] ??
    "border-[color:var(--line)] bg-[color:var(--card-muted)] text-[color:var(--ink-soft)] hover:border-[color:var(--ink-soft)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "border-[color:var(--ink)] bg-[color:var(--ink)] text-white shadow-sm"
          : palette
      }`}
    >
      {label}
    </button>
  );
}
