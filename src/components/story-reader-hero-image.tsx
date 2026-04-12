"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { buildStoryImageSrc } from "@/lib/story-image-proxy";

interface StoryReaderHeroImageProps {
  articleUrl: string | null;
  imageUrl: string | null;
  alt: string;
}

export function StoryReaderHeroImage({
  articleUrl,
  imageUrl,
  alt,
}: StoryReaderHeroImageProps) {
  const proxyImageUrl = useMemo(
    () =>
      articleUrl
        ? buildStoryImageSrc({ articleUrl })
        : null,
    [articleUrl],
  );
  const [activeImageUrl, setActiveImageUrl] = useState(
    proxyImageUrl ?? imageUrl ?? null,
  );

  if (!activeImageUrl) {
    return null;
  }

  return (
    <div className="relative h-[240px] border-b border-[color:var(--line)] bg-[color:var(--card-elevated)] sm:h-[320px] lg:h-[420px]">
      <Image
        key={activeImageUrl}
        src={activeImageUrl}
        alt={alt}
        fill
        unoptimized
        sizes="(min-width: 1024px) 1024px, 100vw"
        className="object-cover"
        onError={() => {
          if (activeImageUrl === proxyImageUrl && imageUrl) {
            setActiveImageUrl(imageUrl);
            return;
          }

          setActiveImageUrl(null);
        }}
      />
    </div>
  );
}
