"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const INITIAL_ESTIMATED_SECONDS = 30;

function requiresTranslation(originalLanguage: string | null) {
  return Boolean(originalLanguage) && originalLanguage !== "English";
}

function buildLoadingMessage(
  secondsRemaining: number,
  source: string | null,
  originalLanguage: string | null,
) {
  const translationRequired = requiresTranslation(originalLanguage);

  if (source === "Addis Standard") {
    if (translationRequired) {
      if (secondsRemaining > 18) {
        return "Opening the Addis Standard story and checking which source-language version is available in the app.";
      }

      if (secondsRemaining > 8) {
        return "If the best recoverable version is not already in English, the reader will translate it automatically.";
      }

      return "Finalizing the in-app reader now.";
    }

    if (secondsRemaining > 20) {
      return "Opening the Addis Standard article and checking whether it is already in English.";
    }

    if (secondsRemaining > 8) {
      return "If this story is not already in English, the reader will switch into English automatically.";
    }

    return "Finishing the story reader now.";
  }

  if (secondsRemaining > 20) {
    return "Opening the article and preparing the in-app reader.";
  }

  if (secondsRemaining > 8) {
    return "If this article is not already in English, the app will translate it here for easier reading.";
  }

  return "Almost done. The story will appear here as soon as it is ready.";
}

function buildLoadingHeading(originalLanguage: string | null) {
  if (requiresTranslation(originalLanguage)) {
    return "This story is being prepared in the reader for you now.";
  }

  return "The app is opening the story here in the reader.";
}

function buildLoadingEyebrow(originalLanguage: string | null) {
  if (requiresTranslation(originalLanguage)) {
    return "Preparing the in-app reader";
  }

  return "Preparing the in-app reader";
}

export default function StoryLoading() {
  const searchParams = useSearchParams();
  const [secondsRemaining, setSecondsRemaining] = useState(
    INITIAL_ESTIMATED_SECONDS,
  );
  const source = searchParams.get("source");
  const originalLanguage = searchParams.get("originalLanguage");
  const translationRequired = requiresTranslation(originalLanguage);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const loadingMessage = useMemo(
    () => buildLoadingMessage(secondsRemaining, source, originalLanguage),
    [secondsRemaining, originalLanguage, source],
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-stretch">
        <section className="flex flex-col justify-center rounded-[30px] border border-[color:var(--line)] bg-[color:var(--card)] px-6 py-8 shadow-[0_20px_80px_rgba(17,24,39,0.08)] sm:px-8 lg:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--accent)]">
            {buildLoadingEyebrow(originalLanguage)}
          </p>
          <h1 className="font-headline mt-4 max-w-3xl text-3xl leading-tight font-semibold text-[color:var(--ink)] sm:text-4xl">
            {buildLoadingHeading(originalLanguage)}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-[color:var(--ink-soft)]">
            {loadingMessage}
          </p>
          <div className="mt-6 inline-flex max-w-max items-center rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)]">
            Estimated time remaining: about {Math.max(secondsRemaining, 3)} seconds
          </div>
          <div className="mt-6 grid gap-3 text-sm leading-7 text-[color:var(--ink-soft)]">
            {translationRequired ? (
              <>
                <p>
                  The app recognized that this source story is not already in English.
                </p>
                <p>
                  It is translating the story for easier reading inside the app.
                </p>
              </>
            ) : (
              <p>
                If the story turns out to be in another language, the app will switch to an English reading view automatically.
              </p>
            )}
            <p>
              If the publisher blocks the full article, the app will still try to show the clearest version it can recover here.
            </p>
          </div>
        </section>

        <article className="overflow-hidden rounded-[30px] border border-[color:var(--line)] bg-[color:var(--card)] shadow-[0_20px_80px_rgba(17,24,39,0.08)]">
          <div className="h-[220px] animate-pulse bg-[color:var(--card-muted)] sm:h-[280px] lg:h-full lg:min-h-[420px]" />
          <div className="space-y-5 border-t border-[color:var(--line)] px-6 py-6">
            <div className="flex gap-3">
              <div className="h-4 w-24 animate-pulse rounded-full bg-[color:var(--card-muted)]" />
              <div className="h-4 w-32 animate-pulse rounded-full bg-[color:var(--card-muted)]" />
              <div className="h-4 w-28 animate-pulse rounded-full bg-[color:var(--card-muted)]" />
            </div>

            <div className="space-y-4">
              <div className="h-10 w-3/4 animate-pulse rounded-[18px] bg-[color:var(--card-muted)]" />
              <div className="h-10 w-2/3 animate-pulse rounded-[18px] bg-[color:var(--card-muted)]" />
              <div className="h-5 w-full animate-pulse rounded-full bg-[color:var(--card-muted)]" />
              <div className="h-5 w-4/5 animate-pulse rounded-full bg-[color:var(--card-muted)]" />
            </div>

            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={`story-loading-paragraph-${index}`}
                  className="h-5 animate-pulse rounded-full bg-[color:var(--card-muted)]"
                  style={{ width: `${100 - index * 8}%` }}
                />
              ))}
            </div>
          </div>
        </article>
      </div>
    </main>
  );
}
