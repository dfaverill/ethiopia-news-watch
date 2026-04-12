import type { MouseEvent } from "react";

interface TopicChipProps {
  label: string;
  active?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  buttonType?: "button" | "submit";
  form?: string;
  name?: string;
  value?: string;
  className?: string;
  disabled?: boolean;
}

export function TopicChip({
  label,
  active = false,
  onClick,
  buttonType = "button",
  form,
  name,
  value,
  className,
  disabled = false,
}: TopicChipProps) {
  return (
    <button
      type={buttonType}
      onClick={onClick}
      form={form}
      name={name}
      value={value}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
        active
          ? "border-white bg-white text-black shadow-sm"
          : "border-transparent bg-transparent text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
      } ${disabled ? "cursor-not-allowed opacity-45" : ""} ${className ?? ""}`}
    >
      {label}
    </button>
  );
}
