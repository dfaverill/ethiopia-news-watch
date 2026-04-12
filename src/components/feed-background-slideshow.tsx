"use client";

import { memo, type CSSProperties, useEffect, useEffectEvent, useMemo, useState } from "react";

interface FeedBackgroundSlideshowProps {
  imageUrls: string[];
}

const SLIDE_DURATION_MS = 7200;
const FADE_DURATION_MS = 2200;
const SLIDE_MOTION_PRESETS = [
  {
    fromScale: 1.06,
    toScale: 1.14,
    exitScale: 1.17,
    fromX: "-1.2%",
    fromY: "-0.8%",
    toX: "0.9%",
    toY: "0.6%",
    exitX: "1.5%",
    exitY: "1%",
  },
  {
    fromScale: 1.05,
    toScale: 1.13,
    exitScale: 1.16,
    fromX: "1.1%",
    fromY: "-0.7%",
    toX: "-0.8%",
    toY: "0.7%",
    exitX: "-1.4%",
    exitY: "1.1%",
  },
  {
    fromScale: 1.07,
    toScale: 1.145,
    exitScale: 1.18,
    fromX: "-0.7%",
    fromY: "1%",
    toX: "0.7%",
    toY: "-0.7%",
    exitX: "1.2%",
    exitY: "-1.2%",
  },
] as const;

function getSlideMotionPreset(index: number) {
  return SLIDE_MOTION_PRESETS[index % SLIDE_MOTION_PRESETS.length];
}

function FeedBackgroundSlideshowComponent({
  imageUrls,
}: FeedBackgroundSlideshowProps) {
  const slides = useMemo(
    () => [...new Set(imageUrls.filter(Boolean))],
    [imageUrls],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [outgoingIndex, setOutgoingIndex] = useState<number | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const safeActiveIndex = slides.length > 0 ? activeIndex % slides.length : 0;
  const safeOutgoingIndex =
    outgoingIndex === null || slides.length === 0
      ? null
      : outgoingIndex % slides.length;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || slides.length === 0) {
      return;
    }

    const preloadCandidates = new Set<string>();
    preloadCandidates.add(slides[safeActiveIndex]);

    if (slides.length > 1) {
      preloadCandidates.add(slides[(safeActiveIndex + 1) % slides.length]);
    }

    if (safeOutgoingIndex !== null) {
      preloadCandidates.add(slides[safeOutgoingIndex]);
    }

    for (const imageUrl of preloadCandidates) {
      if (!imageUrl) {
        continue;
      }

      const image = new window.Image();
      image.decoding = "async";
      image.src = imageUrl;
    }
  }, [safeActiveIndex, safeOutgoingIndex, slides]);

  const advanceSlide = useEffectEvent(() => {
    if (slides.length < 2 || prefersReducedMotion) {
      return;
    }

    setOutgoingIndex(safeActiveIndex);
    setActiveIndex((safeActiveIndex + 1) % slides.length);
  });

  useEffect(() => {
    if (slides.length < 2 || prefersReducedMotion) {
      return;
    }

    const intervalId = window.setInterval(advanceSlide, SLIDE_DURATION_MS);

    return () => window.clearInterval(intervalId);
  }, [prefersReducedMotion, slides.length]);

  useEffect(() => {
    if (outgoingIndex === null) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => setOutgoingIndex(null),
      FADE_DURATION_MS,
    );

    return () => window.clearTimeout(timeoutId);
  }, [outgoingIndex]);

  if (slides.length === 0) {
    return <div aria-hidden="true" className="news-feed-background" />;
  }

  const activeMotion = getSlideMotionPreset(safeActiveIndex);
  const outgoingMotion =
    safeOutgoingIndex === null ? null : getSlideMotionPreset(safeOutgoingIndex);

  return (
    <div aria-hidden="true" className="news-feed-background">
      <div
        key={`active-${slides[safeActiveIndex]}`}
        className="news-feed-background__image news-feed-background__image--current"
        style={
          {
            backgroundImage: `url("${slides[safeActiveIndex]}")`,
            "--news-feed-pan-duration": `${SLIDE_DURATION_MS}ms`,
            "--news-feed-zoom-from": activeMotion.fromScale,
            "--news-feed-zoom-to": activeMotion.toScale,
            "--news-feed-zoom-exit": activeMotion.exitScale,
            "--news-feed-pan-x-from": activeMotion.fromX,
            "--news-feed-pan-y-from": activeMotion.fromY,
            "--news-feed-pan-x-to": activeMotion.toX,
            "--news-feed-pan-y-to": activeMotion.toY,
            "--news-feed-pan-x-exit": activeMotion.exitX,
            "--news-feed-pan-y-exit": activeMotion.exitY,
          } as CSSProperties
        }
      />
      {safeOutgoingIndex !== null && safeOutgoingIndex !== safeActiveIndex ? (
        <div
          key={`outgoing-${slides[safeOutgoingIndex]}`}
          className="news-feed-background__image news-feed-background__image--outgoing"
          style={
            {
              backgroundImage: `url("${slides[safeOutgoingIndex]}")`,
              "--news-feed-fade-duration": `${FADE_DURATION_MS}ms`,
              "--news-feed-zoom-from": outgoingMotion?.fromScale,
              "--news-feed-zoom-to": outgoingMotion?.toScale,
              "--news-feed-zoom-exit": outgoingMotion?.exitScale,
              "--news-feed-pan-x-from": outgoingMotion?.fromX,
              "--news-feed-pan-y-from": outgoingMotion?.fromY,
              "--news-feed-pan-x-to": outgoingMotion?.toX,
              "--news-feed-pan-y-to": outgoingMotion?.toY,
              "--news-feed-pan-x-exit": outgoingMotion?.exitX,
              "--news-feed-pan-y-exit": outgoingMotion?.exitY,
            } as CSSProperties
          }
        />
      ) : null}
      <div className="news-feed-background__overlay" />
      <div className="news-feed-background__vignette" />
    </div>
  );
}

export const FeedBackgroundSlideshow = memo(FeedBackgroundSlideshowComponent);
FeedBackgroundSlideshow.displayName = "FeedBackgroundSlideshow";
