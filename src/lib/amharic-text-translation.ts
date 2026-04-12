import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import OpenAI from "openai";

import { stripHtml, truncate } from "@/lib/news/text";

const DEFAULT_CACHE_DIRECTORY = path.join(process.cwd(), ".cache");
const CACHE_DIRECTORY = process.env.NEWS_WATCH_CACHE_DIR
  ? path.resolve(process.env.NEWS_WATCH_CACHE_DIR)
  : DEFAULT_CACHE_DIRECTORY;
const TEXT_TRANSLATION_CACHE_DIRECTORY = path.join(
  CACHE_DIRECTORY,
  "notebooklm",
  "text-translations",
);
const DEFAULT_TEXT_TRANSLATION_MODEL =
  process.env.OPENAI_TEXT_TRANSLATION_MODEL || "gpt-5.4-mini";
const TEXT_TRANSLATION_CACHE_VERSION = "v2";
const NEWS_TRANSLATION_PROMPT = [
  "Translate this Ethiopia-related news item faithfully into English.",
  "The source text may be Amharic script or Afaan Oromoo written in Latin script.",
  "If the text is not already English, translate it fully into natural English.",
  "Do not leave non-English text unchanged unless it is a proper name.",
  "Return JSON only with keys title and body.",
  "Do not summarize, do not omit facts, and do not add commentary.",
  "Preserve names of people, parties, institutions, places, and programs.",
  "Keep references to Ethiopia, Addis Ababa, Tigray, Amhara, Oromia, Sudan, Eritrea, NEBE, ENA, Prosperity Party, and the African Union clear and consistent.",
  "Translate as a professional news translation, not as marketing copy.",
].join(" ");

interface CachedTranslationRecord {
  body: string;
  captureNote: string;
  createdAt: string;
  model: string;
  title: string;
}

export interface TranslatedAmharicNewsItem {
  body: string;
  captureNote: string;
  model: string;
  title: string;
}

let client: OpenAI | null = null;
const NEWS_TRANSLATION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
  required: ["title", "body"],
} as const;

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return client;
}

function normalizeTranslationText(value: string) {
  return stripHtml(value)
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Translation response did not return a JSON object.");
  }

  return JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
}

function buildCacheKey(args: {
  source: string;
  title: string;
  body: string;
  publishedAt: string;
  url: string | null;
  languageHint?: string | null;
}) {
  const hash = createHash("sha256");
  hash.update(TEXT_TRANSLATION_CACHE_VERSION);
  hash.update(args.source);
  hash.update(args.languageHint ?? "no-language-hint");
  hash.update(args.title);
  hash.update(args.body);
  hash.update(args.publishedAt);
  hash.update(args.url ?? "no-url");

  return hash.digest("hex");
}

async function loadCachedTranslation(cachePath: string) {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as CachedTranslationRecord;

    if (
      typeof parsed?.title !== "string" ||
      typeof parsed?.body !== "string" ||
      typeof parsed?.captureNote !== "string" ||
      typeof parsed?.model !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function saveCachedTranslation(
  cachePath: string,
  record: CachedTranslationRecord,
) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(record, null, 2), "utf8");
}

export function looksLikeAmharicText(value: string) {
  return /[\u1200-\u137f]/.test(value);
}

export async function translateNewsItemToEnglish(args: {
  source: string;
  title: string;
  body: string;
  publishedAt: string;
  url: string | null;
  force?: boolean;
  languageHint?: string | null;
  maxOutputTokens?: number;
}): Promise<TranslatedAmharicNewsItem | null> {
  const normalizedTitle = normalizeTranslationText(args.title);
  const normalizedBody = normalizeTranslationText(args.body);
  const combined = `${normalizedTitle}\n${normalizedBody}`.trim();

  if (!combined) {
    return null;
  }

  if (!args.force && !looksLikeAmharicText(combined)) {
    return null;
  }

  const openai = getClient();
  if (!openai) {
    return null;
  }

  const cacheKey = buildCacheKey({
    source: args.source,
    languageHint: args.languageHint ?? null,
    title: normalizedTitle,
    body: normalizedBody,
    publishedAt: args.publishedAt,
    url: args.url,
  });
  const cachePath = path.join(TEXT_TRANSLATION_CACHE_DIRECTORY, `${cacheKey}.json`);
  const cached = await loadCachedTranslation(cachePath);

  if (cached) {
    return {
      title: cached.title,
      body: cached.body,
      captureNote: cached.captureNote,
      model: cached.model,
    } satisfies TranslatedAmharicNewsItem;
  }

  const response = await openai.responses.create({
    model: DEFAULT_TEXT_TRANSLATION_MODEL,
    max_output_tokens: args.maxOutputTokens ?? 3_500,
    instructions: NEWS_TRANSLATION_PROMPT,
    text: {
      format: {
        type: "json_schema",
        name: "ethiopia_news_translation",
        strict: true,
        schema: NEWS_TRANSLATION_RESPONSE_SCHEMA,
      },
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(
              {
                source: args.source,
                languageHint: args.languageHint ?? null,
                publishedAt: args.publishedAt,
                url: args.url,
                title: normalizedTitle,
                body: normalizedBody,
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
  });

  const parsed =
    (response.output_parsed as Record<string, unknown> | null) ??
    parseJsonObject(response.output_text);
  const translatedTitle =
    typeof parsed.title === "string" && parsed.title.trim()
      ? truncate(normalizeTranslationText(parsed.title), 220)
      : truncate(normalizedTitle, 220);
  const translatedBody =
    typeof parsed.body === "string" && parsed.body.trim()
      ? normalizeTranslationText(parsed.body)
      : "";

  if (!translatedBody) {
    return null;
  }

  const record = {
    title: translatedTitle,
    body: translatedBody,
    captureNote: `Translated into English using ${DEFAULT_TEXT_TRANSLATION_MODEL}.`,
    createdAt: new Date().toISOString(),
    model: DEFAULT_TEXT_TRANSLATION_MODEL,
  } satisfies CachedTranslationRecord;

  await saveCachedTranslation(cachePath, record);

  return {
    title: record.title,
    body: record.body,
    captureNote: record.captureNote,
    model: record.model,
  } satisfies TranslatedAmharicNewsItem;
}

export async function translateAmharicNewsItemToEnglish(args: {
  source: string;
  title: string;
  body: string;
  publishedAt: string;
  url: string | null;
}): Promise<TranslatedAmharicNewsItem | null> {
  return translateNewsItemToEnglish({
    ...args,
    languageHint: "Amharic",
  });
}
