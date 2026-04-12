import OpenAI from "openai";

import type { WeeklyBrief } from "@/lib/dashboard";
import { logNewsEvent } from "@/lib/news/logger";
import { truncate } from "@/lib/news/text";
import type { NormalizedNewsItem } from "@/lib/news/types";

const SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-5.4-mini";
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const OPENAI_BRIEF_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_SUMMARY_ITEMS = 24;
const MAX_SUMMARY_STORYLINES = 10;
const MAX_SUMMARY_LENGTH = 2_200;

let client: OpenAI | null = null;

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return client;
}

function toIsoWindowStart(referenceIso: string) {
  const timestamp = new Date(referenceIso).getTime();
  return new Date(timestamp - WEEKLY_WINDOW_MS).toISOString();
}

function toFiniteTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

interface WeeklyBriefReuseContext {
  latestContentAt?: string | null;
  sourceCount?: number | null;
  storylineCount?: number | null;
}

export function getReusableWeeklyBrief(
  brief: WeeklyBrief | null | undefined,
  referenceIso: string,
  context: WeeklyBriefReuseContext = {},
): WeeklyBrief | null {
  if (!brief) {
    return null;
  }

  const generatedAt = toFiniteTimestamp(brief.generatedAt);
  const windowEnd = toFiniteTimestamp(brief.windowEnd);
  const referenceAt = toFiniteTimestamp(referenceIso);
  const latestContentAt = context.latestContentAt
    ? toFiniteTimestamp(context.latestContentAt)
    : null;

  if (
    generatedAt === null ||
    windowEnd === null ||
    referenceAt === null ||
    referenceAt < generatedAt
  ) {
    return null;
  }

  if (referenceAt - generatedAt < OPENAI_BRIEF_REFRESH_COOLDOWN_MS) {
    return referenceAt - generatedAt < WEEKLY_WINDOW_MS ? brief : null;
  }

  if (
    typeof context.sourceCount === "number" &&
    context.sourceCount !== brief.sourceCount
  ) {
    return null;
  }

  if (
    typeof context.storylineCount === "number" &&
    context.storylineCount !== brief.storylineCount
  ) {
    return null;
  }

  if (latestContentAt !== null && latestContentAt > windowEnd) {
    return null;
  }

  return referenceAt - generatedAt < WEEKLY_WINDOW_MS ? brief : null;
}

function fallbackBrief(
  referenceIso: string,
  sourceCount: number,
  storylineCount: number,
  note: string,
): WeeklyBrief {
  return {
    status: "unavailable",
    generatedAt: referenceIso,
    windowStart: toIsoWindowStart(referenceIso),
    windowEnd: referenceIso,
    headline: "Weekly AI brief unavailable",
    summary:
      "This section can generate a grounded seven-day summary from the same Ethiopia coverage already collected by the dashboard.",
    keyPoints: [],
    sourceDifferences: [],
    watchList: [],
    note,
    model: process.env.OPENAI_API_KEY ? SUMMARY_MODEL : null,
    sourceCount,
    storylineCount,
  };
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    throw new Error("AI summary did not return a JSON object.");
  }

  return JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
}

function normalizeStringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? truncate(entry.trim(), 180) : ""))
    .filter(Boolean)
    .slice(0, limit);
}

function buildSummaryInput(items: NormalizedNewsItem[], referenceIso: string) {
  const windowStartIso = toIsoWindowStart(referenceIso);
  const windowStart = new Date(windowStartIso).getTime();
  const filtered = items.filter((item) => {
    const publishedAt = new Date(item.publishedAt).getTime();
    return Number.isFinite(publishedAt) && publishedAt >= windowStart;
  });

  const candidateItems = (filtered.length > 0 ? filtered : items)
    .slice()
    .sort((left, right) => {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }

      return (
        new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
      );
    })
    .slice(0, MAX_SUMMARY_ITEMS);

  return {
    windowStartIso,
    items: candidateItems,
  };
}

function buildPromptPayload(items: NormalizedNewsItem[], referenceIso: string) {
  const { windowStartIso, items: candidateItems } = buildSummaryInput(
    items,
    referenceIso,
  );

  const groupedPreview = candidateItems.slice(0, MAX_SUMMARY_STORYLINES).map((item) => ({
    source: item.source,
    publishedAt: item.publishedAt,
    title: item.title,
    snippet: truncate(item.snippet, 220),
    topics: item.topicTags,
    matchedKeywords: item.matchedKeywords.slice(0, 8),
  }));

  return {
    windowStartIso,
    windowEndIso: referenceIso,
    candidateItems,
    groupedPreview,
  };
}

export async function buildWeeklyBrief(
  items: NormalizedNewsItem[],
  referenceIso: string,
): Promise<WeeklyBrief> {
  const sourceCount = new Set(items.map((item) => item.source)).size;
  const storylineCount = new Set(items.map((item) => item.title)).size;

  if (items.length === 0) {
    return fallbackBrief(
      referenceIso,
      sourceCount,
      storylineCount,
      "No recent Ethiopia coverage was available to summarize.",
    );
  }

  const openai = getClient();
  if (!openai) {
    return fallbackBrief(
      referenceIso,
      sourceCount,
      storylineCount,
      "Add OPENAI_API_KEY to enable the weekly AI summary. You can optionally set OPENAI_SUMMARY_MODEL, for example gpt-5.4-mini.",
    );
  }

  const promptPayload = buildPromptPayload(items, referenceIso);

  try {
    const response = await openai.responses.create({
      model: SUMMARY_MODEL,
      max_output_tokens: 1_400,
      instructions:
        "You are a careful editor writing a neutral weekly briefing for Ethiopia News Watch. Only use the supplied coverage data. Do not invent facts. If outlets emphasize different angles, say so clearly. Keep the tone serious, specific, comprehensive, and grounded in reported developments.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Summarize the last seven days of Ethiopia-related coverage from the provided source data.",
                "Return JSON only with this shape:",
                '{"headline":"string","summary":"string","keyPoints":["string"],"sourceDifferences":["string"],"watchList":["string"]}',
                "Requirements:",
                "- headline under 16 words",
                "- summary as one paragraph between 220 and 320 words",
                "- make the summary comprehensive enough to stand on its own before the bullets below",
                "- lead with the most consequential developments, then connect the main political, conflict, diplomatic, economic, and humanitarian threads when the supplied data supports them",
                "- 4 to 6 keyPoints",
                "- 2 to 4 sourceDifferences",
                "- 2 to 3 watchList bullets",
                "- stay neutral and specific",
                "",
                JSON.stringify(
                  {
                    windowStart: promptPayload.windowStartIso,
                    windowEnd: promptPayload.windowEndIso,
                    items: promptPayload.groupedPreview,
                  },
                  null,
                  2,
                ),
              ].join("\n"),
            },
          ],
        },
      ],
    });

    const parsed = parseJsonObject(response.output_text);
    const headline =
      typeof parsed.headline === "string" && parsed.headline.trim()
        ? truncate(parsed.headline.trim(), 120)
        : "This week in Ethiopia coverage";
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? truncate(parsed.summary.trim(), MAX_SUMMARY_LENGTH)
        : "AI summary returned without a usable overview paragraph.";
    const keyPoints = normalizeStringList(parsed.keyPoints, 6);
    const sourceDifferences = normalizeStringList(parsed.sourceDifferences, 4);
    const watchList = normalizeStringList(parsed.watchList, 3);

    return {
      status: "ready",
      generatedAt: referenceIso,
      windowStart: promptPayload.windowStartIso,
      windowEnd: promptPayload.windowEndIso,
      headline,
      summary,
      keyPoints,
      sourceDifferences,
      watchList,
      note: `AI-generated from ${promptPayload.candidateItems.length} recent items across ${sourceCount} sources.`,
      model: SUMMARY_MODEL,
      sourceCount,
      storylineCount,
    };
  } catch (error) {
    logNewsEvent("warn", "weekly_brief_failed", {
      message: error instanceof Error ? error.message : "Unknown weekly brief error",
      model: SUMMARY_MODEL,
    });

    return fallbackBrief(
      referenceIso,
      sourceCount,
      storylineCount,
      "The AI weekly summary could not be generated this time. Coverage data is still available below.",
    );
  }
}
