"use client";

import { useRouter } from "next/navigation";

interface StoryBackButtonProps {
  fallbackHref?: string;
}

export function StoryBackButton({
  fallbackHref = "/",
}: StoryBackButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }

        router.push(fallbackHref);
      }}
      className="text-left text-sm font-medium text-[color:var(--ink-soft)] transition hover:text-[color:var(--ink)]"
    >
      Back to Ethiopia News Watch
    </button>
  );
}
