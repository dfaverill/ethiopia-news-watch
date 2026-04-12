import { describe, expect, it } from "vitest";

import {
  WEEKLY_BRIEF_PREVIEW_RATIO,
  buildHalfListPreview,
  buildHalfWordPreview,
  buildWordPreview,
} from "@/lib/word-preview";

describe("word preview helpers", () => {
  it("keeps the weekly brief preview ratio locked to half", () => {
    expect(WEEKLY_BRIEF_PREVIEW_RATIO).toBe(0.5);
  });

  it("returns the full text when it fits within the limit", () => {
    const preview = buildWordPreview(
      "This is a compact summary that should stay unchanged.",
      20,
    );

    expect(preview.hasOverflow).toBe(false);
    expect(preview.preview).toBe(preview.normalized);
    expect(preview.wordCount).toBe(9);
  });

  it("builds a preview when the text exceeds the word limit", () => {
    const preview = buildWordPreview(
      "One two three four five six seven eight nine ten eleven twelve.",
      6,
    );

    expect(preview.hasOverflow).toBe(true);
    expect(preview.preview).toBe("One two three four five six");
    expect(preview.wordCount).toBe(12);
  });

  it("uses half of a longer summary for the preview", () => {
    const summary = Array.from({ length: 140 }, (_, index) => `word${index + 1}`).join(" ");
    const preview = buildHalfWordPreview(summary);

    expect(preview.hasOverflow).toBe(true);
    expect(preview.preview.split(" ")).toHaveLength(70);
    expect(preview.wordCount).toBe(140);
  });

  it("keeps shorter summaries intact when half would be too aggressive", () => {
    const summary = Array.from({ length: 80 }, (_, index) => `word${index + 1}`).join(" ");
    const preview = buildHalfWordPreview(summary);

    expect(preview.hasOverflow).toBe(true);
    expect(preview.preview.split(" ")).toHaveLength(60);
    expect(preview.wordCount).toBe(80);
  });

  it("keeps shorter bullet lists intact when they stay under the shared half-preview rule", () => {
    const preview = buildHalfListPreview([
      "This point stays visible because the total list stays under the shared threshold.",
      "So does this second point in the same card.",
    ]);

    expect(preview.hasOverflow).toBe(false);
    expect(preview.preview).toEqual([
      {
        text: "This point stays visible because the total list stays under the shared threshold.",
        truncated: false,
      },
      {
        text: "So does this second point in the same card.",
        truncated: false,
      },
    ]);
    expect(preview.itemCount).toBe(2);
  });

  it("keeps the fuller list preview and trims the final visible bullet when needed", () => {
    const items = Array.from({ length: 4 }, (_, itemIndex) =>
      Array.from({ length: 25 }, (_, wordIndex) => `item${itemIndex + 1}-${wordIndex + 1}`).join(" "),
    );

    const preview = buildHalfListPreview(items);
    const previewWordCount = preview.preview
      .map((item) => item.text)
      .join(" ")
      .split(" ");

    expect(preview.hasOverflow).toBe(true);
    expect(preview.wordCount).toBe(100);
    expect(preview.preview).toHaveLength(3);
    expect(preview.preview).toEqual([
      { text: items[0] ?? "", truncated: false },
      { text: items[1] ?? "", truncated: false },
      {
        text: Array.from({ length: 10 }, (_, wordIndex) => `item3-${wordIndex + 1}`).join(" "),
        truncated: true,
      },
    ]);
    expect(previewWordCount).toHaveLength(60);
  });
});
