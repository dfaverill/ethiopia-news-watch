import type { StorylineSourceRow } from "@/lib/dashboard";

type StoryLinkArgs = Pick<
  StorylineSourceRow,
  "source" | "title" | "url" | "updatedAt" | "originalLanguage"
> & {
  snippet?: string | null;
};

export function shouldUseInternalStoryReader(args: Pick<StorylineSourceRow, "source" | "url">) {
  return args.source === "Addis Standard" && Boolean(args.url);
}

export function buildStoryReaderHref(args: StoryLinkArgs) {
  const params = new URLSearchParams();
  params.set("source", args.source);
  params.set("title", args.title);
  params.set("updatedAt", args.updatedAt);
  params.set("url", args.url ?? "");

  if (args.originalLanguage) {
    params.set("originalLanguage", args.originalLanguage);
  }

  if (args.snippet?.trim()) {
    params.set("snippet", args.snippet.trim());
  }

  return `/story?${params.toString()}`;
}
