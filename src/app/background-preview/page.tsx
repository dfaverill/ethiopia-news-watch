import Link from "next/link";

import { BACKGROUND_THEME_OPTIONS } from "@/lib/background-themes";

export const dynamic = "force-dynamic";

export default function BackgroundPreviewPage() {
  const creativeThemes = BACKGROUND_THEME_OPTIONS.filter(
    (option) => option.collection === "creative",
  );
  const editorialThemes = BACKGROUND_THEME_OPTIONS.filter(
    (option) => option.collection === "editorial",
  );

  function renderThemeGrid(
    options: (typeof BACKGROUND_THEME_OPTIONS)[number][],
    highlightRecommended = false,
  ) {
    return (
      <section className="grid gap-6 xl:grid-cols-2 2xl:grid-cols-3">
        {options.map((option) => (
          <article
            key={option.slug}
            className="overflow-hidden rounded-[30px] border border-[color:var(--line)] bg-[color:var(--card)] p-5 shadow-[0_20px_80px_rgba(17,24,39,0.08)]"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-headline text-2xl font-semibold text-[color:var(--ink)]">
                    {option.name}
                  </h2>
                  {highlightRecommended && option.slug === "relief-briefing" ? (
                    <span className="inline-flex items-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                      Recommended
                    </span>
                  ) : null}
                </div>
                <p className="max-w-2xl text-sm leading-7 text-[color:var(--ink-soft)]">
                  {option.summary}
                </p>
              </div>

              <Link
                href={`/?bgPreview=${option.slug}`}
                className="inline-flex items-center justify-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-white hover:text-black"
              >
                Open this one
              </Link>
            </div>

            <div className="app-background-preview-shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/background-preview-shots/${option.slug}.png?v=2`}
                alt={`${option.name} on Ethiopia News Watch`}
                className="app-background-preview-shot__image"
              />
            </div>
          </article>
        ))}
      </section>
    );
  }

  return (
    <main className="background-preview-page min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-strong)]">
              Ethiopia News Watch Background Study
            </p>
            <h1 className="font-headline text-4xl leading-tight font-semibold text-[color:var(--ink)] sm:text-5xl">
              See every wallpaper on the actual app
            </h1>
            <p className="max-w-3xl text-base leading-8 text-[color:var(--ink-soft)]">
              These previews do not move buttons or sections around. Each card
              is a screenshot of the current app with only the background layer
              changed.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-white hover:text-black"
            >
              Back to app
            </Link>
          </div>
        </div>

        <section className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-strong)]">
              New creative directions
            </p>
            <h2 className="font-headline text-3xl font-semibold text-[color:var(--ink)]">
              Three more distinct background-only options
            </h2>
            <p className="max-w-3xl text-sm leading-7 text-[color:var(--ink-soft)]">
              These are meant to feel clearly different from the earlier map
              set: one orbital, one archival newspaper, and one Ethiopian
              pattern-led direction.
            </p>
          </div>
          {renderThemeGrid(creativeThemes)}
        </section>

        <section className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-strong)]">
              Earlier editorial set
            </p>
            <h2 className="font-headline text-3xl font-semibold text-[color:var(--ink)]">
              Map, texture, and skyline directions
            </h2>
            <p className="max-w-3xl text-sm leading-7 text-[color:var(--ink-soft)]">
              Keeping the first six here in case you want to compare the new
              ideas against the earlier newsroom-map direction you liked.
            </p>
          </div>
          {renderThemeGrid(editorialThemes, true)}
        </section>
      </div>
    </main>
  );
}
