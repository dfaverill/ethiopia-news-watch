export interface WordPreview {
  normalized: string;
  preview: string;
  hasOverflow: boolean;
  wordCount: number;
}

export interface ListPreviewItem {
  text: string;
  truncated: boolean;
}

export interface ListPreview {
  normalized: string[];
  preview: ListPreviewItem[];
  hasOverflow: boolean;
  wordCount: number;
  itemCount: number;
}

export const WEEKLY_BRIEF_PREVIEW_RATIO = 0.5;
const MIN_HALF_PREVIEW_WORDS = 60;

function normalizeWords(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function countWords(input: string): number {
  return input ? input.split(" ").length : 0;
}

function getHalfPreviewTarget(wordCount: number): number {
  return Math.max(
    MIN_HALF_PREVIEW_WORDS,
    Math.ceil(wordCount * WEEKLY_BRIEF_PREVIEW_RATIO),
  );
}

export function buildWordPreview(
  input: string,
  maxWords: number,
): WordPreview {
  const normalized = normalizeWords(input);

  if (!normalized) {
    return {
      normalized: "",
      preview: "",
      hasOverflow: false,
      wordCount: 0,
    };
  }

  const words = normalized.split(" ");

  if (words.length <= maxWords) {
    return {
      normalized,
      preview: normalized,
      hasOverflow: false,
      wordCount: words.length,
    };
  }

  return {
    normalized,
    preview: words.slice(0, maxWords).join(" "),
    hasOverflow: true,
    wordCount: words.length,
  };
}

export function buildHalfWordPreview(input: string): WordPreview {
  const normalized = normalizeWords(input);

  if (!normalized) {
    return {
      normalized: "",
      preview: "",
      hasOverflow: false,
      wordCount: 0,
    };
  }

  const words = normalized.split(" ");
  const targetWords = getHalfPreviewTarget(words.length);

  return buildWordPreview(normalized, targetWords);
}

export function buildHalfListPreview(items: string[]): ListPreview {
  const normalized = items.map(normalizeWords).filter(Boolean);

  if (normalized.length === 0) {
    return {
      normalized: [],
      preview: [],
      hasOverflow: false,
      wordCount: 0,
      itemCount: 0,
    };
  }

  const wordCount = normalized.reduce((total, item) => total + countWords(item), 0);
  const targetWords = getHalfPreviewTarget(wordCount);

  if (wordCount <= targetWords) {
    return {
      normalized,
      preview: normalized.map((text) => ({ text, truncated: false })),
      hasOverflow: false,
      wordCount,
      itemCount: normalized.length,
    };
  }

  let remainingWords = targetWords;
  const preview: ListPreviewItem[] = [];

  for (const item of normalized) {
    if (remainingWords <= 0) {
      break;
    }

    const words = item.split(" ");

    if (words.length <= remainingWords) {
      preview.push({ text: item, truncated: false });
      remainingWords -= words.length;
      continue;
    }

    preview.push({
      text: words.slice(0, remainingWords).join(" "),
      truncated: true,
    });
    remainingWords = 0;
  }

  return {
    normalized,
    preview,
    hasOverflow: true,
    wordCount,
    itemCount: normalized.length,
  };
}
