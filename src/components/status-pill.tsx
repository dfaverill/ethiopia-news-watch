interface StatusPillProps {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

const toneClasses: Record<NonNullable<StatusPillProps["tone"]>, string> = {
  neutral:
    "border-[color:var(--line)] bg-white/70 text-[color:var(--ink-soft)]",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
};

export function StatusPill({
  label,
  tone = "neutral",
}: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClasses[tone]}`}
    >
      {label}
    </span>
  );
}
