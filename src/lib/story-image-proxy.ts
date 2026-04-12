import type { SourceName } from "@/lib/dashboard";

export type StoryImageProxyVariant = "feed" | "background";

const STORY_IMAGE_PROXY_VERSION = "2026-04-11-addis-direct-images-4";

interface BuildStoryImageSrcArgs {
  articleUrl: string;
  imageUrl?: string | null;
  source?: SourceName | null;
  variant?: StoryImageProxyVariant;
}

export function buildStoryImageSrc({
  articleUrl,
  imageUrl,
  source,
  variant = "feed",
}: BuildStoryImageSrcArgs) {
  const params = new URLSearchParams({
    article: articleUrl,
    v: STORY_IMAGE_PROXY_VERSION,
  });

  if (source) {
    params.set("source", source);
  }

  if (imageUrl) {
    params.set("image", imageUrl);
  }

  if (variant !== "feed") {
    params.set("variant", variant);
  }

  return `/api/story-image?${params.toString()}`;
}
