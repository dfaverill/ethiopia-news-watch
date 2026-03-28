import { createHash } from "node:crypto";

import { STOPWORDS } from "@/lib/news/constants";

function repairMojibake(input: string): string {
  if (!/[ÃÂâ]/.test(input)) {
    return input;
  }

  try {
    const repaired = Buffer.from(input, "latin1").toString("utf8");
    const originalNoise = (input.match(/[ÃÂâ�]/g) ?? []).length;
    const repairedNoise = (repaired.match(/[ÃÂâ�]/g) ?? []).length;

    return repairedNoise <= originalNoise ? repaired : input;
  } catch {
    return input;
  }
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    .replace(/&lsquo;/gi, "'")
    .replace(/&rsquo;/gi, "'");
}

function normalizePunctuation(input: string) {
  return input
    .replace(/�/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(\p{L})["](\p{L})/gu, "$1'$2");
}

export function stripHtml(input: string | null | undefined): string {
  return normalizePunctuation(decodeHtmlEntities(repairMojibake(input ?? "")))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(input: string, maxLength = 220): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength - 3).trimEnd()}...`;
}

export function toAbsoluteUrl(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function removeTrackingParams(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    [...parsed.searchParams.keys()].forEach((key) => {
      if (
        key.startsWith("utm_") ||
        key === "oc" ||
        key === "utm_source" ||
        key === "utm_medium"
      ) {
        parsed.searchParams.delete(key);
      }
    });
    return parsed.toString();
  } catch {
    return url;
  }
}

export function sanitizeHttpUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeTitle(title: string): string {
  return stripHtml(title)
    .toLowerCase()
    .replace(/^news:\s*/i, "")
    .replace(/\s+-\s+(reuters|addis standard)$/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeHeadline(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length > 2 &&
        !STOPWORDS.has(token) &&
        !/^\d+$/.test(token),
    );
}

export function headlineSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeHeadline(left));
  const rightTokens = new Set(tokenizeHeadline(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  });

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function buildStableId(parts: string[]): string {
  return createHash("sha1")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

export function firstSentence(text: string): string {
  const cleaned = stripHtml(text);
  const [sentence] = cleaned.split(/(?<=[.!?])\s+/);
  return sentence ? truncate(sentence, 220) : truncate(cleaned, 220);
}

export function extractEnglishDate(text: string): string | null {
  const cleaned = stripHtml(text);
  const match = cleaned.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
  );

  if (!match) {
    return null;
  }

  const dateMatch = match[0].match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/i,
  );

  if (!dateMatch) {
    return null;
  }

  const [, monthName, dayValue, yearValue] = dateMatch;
  const monthIndex = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].indexOf(monthName.toLowerCase());

  if (monthIndex === -1) {
    return null;
  }

  return new Date(
    Date.UTC(Number(yearValue), monthIndex, Number(dayValue)),
  ).toISOString();
}
