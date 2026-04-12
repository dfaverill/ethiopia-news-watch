"use client";

import Image from "next/image";
import { useState } from "react";

import { SourceBadge } from "@/components/source-badge";
import type { SourceName } from "@/lib/dashboard";
import { buildStoryImageSrc } from "@/lib/story-image-proxy";

interface StoryThumbnailProps {
  articleUrl: string | null;
  imageUrl?: string | null;
  source: SourceName;
  size?: "hero" | "row" | "card";
}

const storyThumbnailSizeClasses = {
  hero: {
    frame: "h-[168px] w-full sm:w-[228px]",
    sizes: "(min-width: 1280px) 228px, (min-width: 640px) 228px, 100vw",
  },
  row: {
    frame: "h-[96px] w-full sm:w-[144px]",
    sizes: "(min-width: 640px) 144px, 100vw",
  },
  card: {
    frame: "h-[132px] w-full sm:w-[196px]",
    sizes: "(min-width: 640px) 196px, 100vw",
  },
} as const;

export function StoryThumbnail({
  articleUrl,
  imageUrl,
  source,
  size = "row",
}: StoryThumbnailProps) {
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const sizeClasses = storyThumbnailSizeClasses[size];
  const imageSrc = articleUrl
    ? buildStoryImageSrc({ articleUrl, imageUrl, source })
    : null;
  const hasImageError = !imageSrc || failedImageSrc === imageSrc;

  return (
    <div
      className={`relative overflow-hidden rounded-[22px] border border-[color:var(--line)] bg-[linear-gradient(145deg,rgba(14,100,139,0.18),rgba(17,24,39,0.18))] ${sizeClasses.frame}`}
    >
      {imageSrc && !hasImageError ? (
        <Image
          src={imageSrc}
          alt=""
          fill
          unoptimized
          sizes={sizeClasses.sizes}
          className="object-cover"
          onError={() => setFailedImageSrc(imageSrc)}
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,8,14,0.02),rgba(6,8,14,0.3))]" />
      {hasImageError ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full border border-[color:var(--line-strong)] bg-[rgba(10,14,20,0.72)] px-3 py-2 backdrop-blur">
            <SourceBadge source={source} size="xs" showName={false} />
          </span>
        </div>
      ) : null}
    </div>
  );
}
