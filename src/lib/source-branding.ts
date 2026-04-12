import type { SourceName } from "@/lib/dashboard";

export const SOURCE_ICON_PATHS: Record<SourceName, string> = {
  "Addis Standard": "/source-icons/addis-standard.png",
  "The Reporter Ethiopia": "/source-icons/the-reporter.png",
  "Ethiopia Insight": "/source-icons/ethiopia-insight.jpg",
  ENA: "/source-icons/ena.png",
  NEBE: "/source-icons/nebe.png",
  "VOA Amharic": "/source-icons/voa-amharic.svg",
};

export function getSourceInitials(source: SourceName) {
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();

  return initials || source.slice(0, 2).toUpperCase();
}

export function getSourceIconImageClass(
  source: SourceName,
  size: "micro" | "standard" = "standard",
) {
  if (source === "Addis Standard") {
    return size === "micro"
      ? "object-contain p-[1px]"
      : "object-contain p-[2px]";
  }

  return size === "micro" ? "object-contain" : "object-contain p-[1px]";
}
