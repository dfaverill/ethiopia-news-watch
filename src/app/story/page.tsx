import { notFound } from "next/navigation";

import { StoryBackButton } from "@/components/story-back-button";
import { StoryReaderHeroImage } from "@/components/story-reader-hero-image";
import { SOURCE_NAMES, type SourceName } from "@/lib/dashboard";
import type { VariantLanguage } from "@/lib/news/multilingual-dedupe";
import { getStoryReaderArticle } from "@/lib/story-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface StoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isKnownSourceName(value: string): value is SourceName {
  return SOURCE_NAMES.includes(value as SourceName);
}

function formatPublishedAt(value: string | null) {
  if (!value) {
    return "Date unavailable";
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatLanguageLabel(value: string) {
  switch (value) {
    case "oromo":
      return "Afaan Oromoo";
    case "amharic":
      return "Amharic";
    case "english":
      return "English";
    default:
      return "Unknown";
  }
}

function normalizeOriginalLanguageParam(
  value: string | null,
): VariantLanguage | null {
  if (!value) {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "english":
      return "english";
    case "amharic":
      return "amharic";
    case "afaan oromoo":
    case "afaanoromoo":
    case "oromo":
      return "oromo";
    default:
      return null;
  }
}

function buildReaderStatusNote(article: Awaited<ReturnType<typeof getStoryReaderArticle>>) {
  if (!article) {
    return null;
  }

  if (article.recoverySource === "official-post" && article.previewOnly) {
    if (article.translationFailed) {
      return "Addis Standard only exposed a shortened official post for this story, and the English translation did not finish cleanly this time. The original source link is still available above.";
    }

    if (article.translatedOnDemand) {
      return "Addis Standard only exposed a shortened official post for this story, so the app translated the longest recoverable version into English here. The original source link is still available above.";
    }

    return "Addis Standard only exposed a shortened official post for this story, so the app is showing the longest recoverable version here. The original source link is still available above.";
  }

  if (article.recoverySource === "official-post" && article.translationFailed) {
    return "We recovered Addis Standard's official post for this story, but the English translation did not finish cleanly this time, so you're seeing the recovered source version here.";
  }

  if (
    article.recoverySource === "official-post" &&
    article.originalLanguage !== "english"
  ) {
    return "We recovered Addis Standard's official post for this story and translated it into English so you can read it here in the app.";
  }

  if (article.recoverySource === "official-post") {
    return "We recovered this story from Addis Standard's official post so you can read it here in the app.";
  }

  if (article.excerptFallback && article.translationFailed) {
    return "The publisher blocked the full article in the app, so we’re showing the clearest excerpt we could recover. The original page is still available above.";
  }

  if (article.excerptFallback && article.originalLanguage !== "english") {
    return "This source story was published in another language. Because the full article body was not available in the app, you’re seeing the clearest English version we could recover here.";
  }

  if (article.excerptFallback) {
    return "The publisher did not expose the full article body to the in-app reader, so you’re seeing the clearest version we could recover here.";
  }

  if (article.translatedOnDemand && article.translationFailed) {
    return "The English version did not finish cleanly this time. The original article is still available above.";
  }

  if (article.translatedOnDemand) {
    return "This article was translated into English so you can read it here in the app.";
  }

  return null;
}

function buildOpenOriginalLabel(
  article: Awaited<ReturnType<typeof getStoryReaderArticle>>,
) {
  if (!article) {
    return "Open original";
  }

  try {
    const parsed = new URL(article.openOriginalUrl);

    if (/^(?:www\.)?news\.google\.com$/i.test(parsed.hostname)) {
      return "Open original source link";
    }

    if (/^(?:www\.)?t\.me$/i.test(parsed.hostname)) {
      return "Open original Addis Standard post";
    }
  } catch {}

  return "Open original Addis Standard article";
}

export default async function StoryPage({ searchParams }: StoryPageProps) {
  const params = await searchParams;
  const source = getFirstSearchParam(params.source);
  const url = getFirstSearchParam(params.url);
  const title = getFirstSearchParam(params.title) ?? null;
  const publishedAt = getFirstSearchParam(params.updatedAt) ?? null;
  const snippet = getFirstSearchParam(params.snippet) ?? null;
  const originalLanguage = normalizeOriginalLanguageParam(
    getFirstSearchParam(params.originalLanguage) ?? null,
  );

  if (!source || !isKnownSourceName(source) || !url) {
    notFound();
  }

  let article = null;

  try {
    article = await getStoryReaderArticle({
      source,
      title,
      publishedAt,
      snippet,
      knownOriginalLanguage: originalLanguage,
      url,
    });
  } catch {
    article = null;
  }

  if (!article) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <StoryBackButton />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-white hover:text-black"
          >
            Open original
          </a>
        </div>
        <section className="rounded-[28px] border border-[color:var(--line)] bg-[color:var(--card)] p-8 shadow-[0_20px_80px_rgba(17,24,39,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent)]">
            Story Reader
          </p>
          <h1 className="font-headline mt-4 text-3xl font-semibold text-[color:var(--ink)]">
            We couldn&apos;t load this article inside the reader yet.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--ink-soft)]">
            The original source page is still available, but the app could not
            recover enough article text to show a readable in-app version this
            time.
          </p>
        </section>
      </main>
    );
  }

  const readerStatusNote = buildReaderStatusNote(article);
  const openOriginalLabel = buildOpenOriginalLabel(article);
  const shouldShowRecoveredBody =
    article.bodyParagraphs.length > 0 &&
    (!article.translationFailed ||
      article.excerptFallback ||
      article.recoverySource === "official-post");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <StoryBackButton />
        <a
          href={article.openOriginalUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-white hover:text-black"
        >
          {openOriginalLabel}
        </a>
      </div>

      <article className="overflow-hidden rounded-[30px] border border-[color:var(--line)] bg-[color:var(--card)] shadow-[0_20px_80px_rgba(17,24,39,0.08)]">
        <StoryReaderHeroImage
          articleUrl={article.resolvedUrl}
          imageUrl={article.imageUrl}
          alt={article.displayTitle}
        />

        <div className="space-y-8 px-6 py-8 sm:px-8 lg:px-12 lg:py-10">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">
              <span>{article.source}</span>
              <span className="h-1 w-1 rounded-full bg-[color:var(--ink-soft)]" />
              <span>{formatPublishedAt(article.publishedAt)}</span>
              <span className="h-1 w-1 rounded-full bg-[color:var(--ink-soft)]" />
              <span>
                Source language: {formatLanguageLabel(article.originalLanguage)}
              </span>
            </div>

            <h1 className="font-headline max-w-4xl text-3xl leading-tight font-semibold text-[color:var(--ink)] sm:text-4xl lg:text-5xl">
              {article.displayTitle}
            </h1>

            <p className="max-w-3xl text-base leading-8 text-[color:var(--ink-soft)]">
              {article.summary}
            </p>

            {readerStatusNote ? (
              <div className="inline-flex max-w-3xl items-center rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-4 py-2 text-sm text-[color:var(--ink-soft)]">
                {readerStatusNote}
              </div>
            ) : null}
          </div>

          {!shouldShowRecoveredBody ? (
            <div className="rounded-[24px] border border-dashed border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-5 py-6">
              <p className="text-sm leading-7 text-[color:var(--ink-soft)]">
                We opened the story, but the app could not recover a readable
                in-app version yet. The original source is still available above.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {article.bodyParagraphs.map((paragraph, index) => (
                <p
                  key={`story-reader-paragraph-${index}`}
                  className="text-[17px] leading-8 text-[color:var(--ink)]"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          )}
        </div>
      </article>
    </main>
  );
}
