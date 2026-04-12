"use client";

import Image from "next/image";

import { SourceInfoTrigger } from "@/components/source-info-trigger";
import type { SourceName } from "@/lib/dashboard";
import {
  SOURCE_ICON_PATHS,
  getSourceIconImageClass,
  getSourceInitials,
} from "@/lib/source-branding";

interface SourceBadgeProps {
  source: SourceName;
  size?: "xs" | "sm" | "md";
  showName?: boolean;
  className?: string;
  nameClassName?: string;
}

const sourceBadgeSizeClasses = {
  xs: {
    container: "gap-1.5",
    frame: "h-5 w-5 rounded-[6px]",
    text: "text-xs",
    iconSize: 20,
  },
  sm: {
    container: "gap-2",
    frame: "h-8 w-8 rounded-full",
    text: "text-sm",
    iconSize: 32,
  },
  md: {
    container: "gap-2.5",
    frame: "h-10 w-10 rounded-full",
    text: "text-sm",
    iconSize: 40,
  },
} as const;

export function SourceBadge({
  source,
  size = "sm",
  showName = true,
  className,
  nameClassName,
}: SourceBadgeProps) {
  const sizeClasses = sourceBadgeSizeClasses[size];
  const sourceIconPath = SOURCE_ICON_PATHS[source];
  const sourceIconClassName = getSourceIconImageClass(source);
  const initials = getSourceInitials(source);

  return (
    <SourceInfoTrigger
      source={source}
      buttonClassName={`inline-flex min-w-0 items-center ${sizeClasses.container} ${
        className ?? ""
      } cursor-pointer text-left transition hover:opacity-90`}
    >
      <span
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-[color:var(--line-strong)] bg-[color:color-mix(in_srgb,var(--card-elevated)_82%,white_18%)] ${sizeClasses.frame}`}
      >
        {sourceIconPath ? (
          <Image
            src={sourceIconPath}
            alt=""
            width={sizeClasses.iconSize}
            height={sizeClasses.iconSize}
            unoptimized
            className={`h-full w-full ${sourceIconClassName}`}
          />
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ink)]">
            {initials}
          </span>
        )}
      </span>
      {showName ? (
        <span
          className={`min-w-0 truncate font-semibold text-[color:var(--ink)] ${sizeClasses.text} ${
            nameClassName ?? ""
          }`}
        >
          {source}
        </span>
      ) : null}
    </SourceInfoTrigger>
  );
}
