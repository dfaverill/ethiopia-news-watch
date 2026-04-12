import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { load } from "cheerio";

import { ADDIS_STANDARD_OFFICIAL_TELEGRAM_CHANNELS } from "@/lib/addis-standard-official-platforms";
import type { SourceName } from "@/lib/dashboard";
import { decodeGoogleNewsArticleUrl } from "@/lib/news/story-images";
import { translateNewsItemToEnglish } from "@/lib/amharic-text-translation";
import {
  inferVariantLanguage,
  isItemProbablyEnglish,
  type VariantLanguage,
} from "@/lib/news/multilingual-dedupe";
import { firstSentence, stripHtml, truncate } from "@/lib/news/text";

const GOOGLE_NEWS_RESOLVER_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "resolve-google-news-urls.mjs",
);
const ADDIS_STANDARD_BROWSER_EXTRACTOR_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "extract-addis-standard-article.mjs",
);
const ADDIS_STANDARD_BROWSER_PROFILE_DIRECTORY =
  process.env.ADDIS_STANDARD_BROWSER_PROFILE_DIRECTORY ||
  path.join(process.cwd(), ".cache", "addis-standard-profile");
const DEFAULT_CACHE_DIRECTORY = path.join(process.cwd(), ".cache");
const CACHE_DIRECTORY = process.env.NEWS_WATCH_CACHE_DIR
  ? path.resolve(process.env.NEWS_WATCH_CACHE_DIR)
  : DEFAULT_CACHE_DIRECTORY;
const STORY_READER_CACHE_DIRECTORY = path.join(
  CACHE_DIRECTORY,
  "story-reader",
);
const STORY_READER_CACHE_VERSION = "v7";
const NOTEBOOKLM_CACHE_DIRECTORY = path.join(CACHE_DIRECTORY, "notebooklm");
const NOTEBOOKLM_PREPARED_REQUEST_RECENT_PATH = path.join(
  NOTEBOOKLM_CACHE_DIRECTORY,
  "prepared-request-recent.json",
);
const NOTEBOOKLM_SOURCE_PACKETS_DIRECTORY = path.join(
  NOTEBOOKLM_CACHE_DIRECTORY,
  "source-packets",
);
const pendingStoryReaderRequests = new Map<string, Promise<StoryReaderArticle | null>>();
const STORY_READER_TRANSLATION_CHUNK_MAX_CHARACTERS = 2_600;
const STORY_READER_TRANSLATION_CHUNK_MAX_PARAGRAPHS = 5;
const STORY_READER_BROWSER_EXTRACT_TIMEOUT_MS = 10_000;
const ADDIS_STANDARD_OFFICIAL_POST_LIMIT = 6;
const ADDIS_STANDARD_OFFICIAL_POST_MATCH_THRESHOLD = 3;

type StoryReaderRecoverySource = "article" | "official-post" | "excerpt";

interface AddisStandardBrowserArticle {
  body: string;
  description: string | null;
  finalUrl: string;
  imageUrl: string | null;
  publishedAt: string | null;
  title: string;
}

export interface StoryReaderArticle {
  source: SourceName;
  requestedUrl: string;
  resolvedUrl: string;
  openOriginalUrl: string;
  originalTitle: string;
  displayTitle: string;
  summary: string;
  bodyParagraphs: string[];
  imageUrl: string | null;
  publishedAt: string | null;
  originalLanguage: VariantLanguage;
  translatedOnDemand: boolean;
  translationFailed: boolean;
  excerptFallback: boolean;
  previewOnly: boolean;
  recoverySource: StoryReaderRecoverySource;
}

interface CachedStoryReaderArticle extends StoryReaderArticle {
  cachedAt: string;
}

interface AddisStandardOfficialPostCandidate {
  body: string;
  language: VariantLanguage;
  linkedPublicationUrl: string | null;
  publishedAt: string | null;
  telegramUrl: string;
  title: string;
}

interface AddisStandardOfficialPostRecovery {
  bodyParagraphs: string[];
  imageUrl: string | null;
  publishedAt: string | null;
  readMoreUrl: string | null;
  title: string;
}

function buildGoogleNewsFetchHeaders() {
  return {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
  };
}

function isGoogleVerificationUrl(url: string) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === "www.google.com" &&
      parsed.pathname.toLowerCase().startsWith("/sorry")
    );
  } catch {
    return false;
  }
}

function normalizeOriginalLanguageHint(value: string | null | undefined): VariantLanguage | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  switch (normalized) {
    case "english":
      return "english";
    case "amharic":
      return "amharic";
    case "afaan oromoo":
    case "oromo":
    case "afaanoromoo":
      return "oromo";
    default:
      return null;
  }
}

function unwrapGoogleContinueUrl(url: string) {
  try {
    const parsed = new URL(url);
    const continued = parsed.searchParams.get("continue");

    return continued?.trim() ? continued.trim() : null;
  } catch {
    return null;
  }
}

function normalizeComparableUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    parsed.hash = "";

    if (/addisstandard\.com$/i.test(parsed.hostname)) {
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    }

    return parsed.toString();
  } catch {
    return url.trim() || null;
  }
}

function inferAddisStandardTelegramLanguage(telegramUrl: string) {
  return (
    ADDIS_STANDARD_OFFICIAL_TELEGRAM_CHANNELS.find((channel) =>
      telegramUrl.startsWith(channel.postUrlPrefix),
    )?.language ?? "english"
  );
}

function buildTelegramPreviewBody(args: {
  messageText: string;
  previewDescription: string;
  previewTitle: string;
}) {
  const parts = [
    args.messageText,
    args.previewTitle,
    args.previewDescription,
  ]
    .map((value) => stripHtml(value))
    .map((value) => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const key = part.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(part);
  }

  return unique.join("\n\n");
}

function buildTelegramPreviewTitle(args: {
  messageText: string;
  previewTitle: string;
}) {
  const previewTitle = stripHtml(args.previewTitle).trim();

  if (previewTitle) {
    return truncate(previewTitle, 220);
  }

  const [headline] = stripHtml(args.messageText)
    .replace(/\u00a0/g, " ")
    .split(/(?<=[.!?])\s+/);

  return truncate((headline || stripHtml(args.messageText)).trim(), 220);
}

function buildStoryReaderCachePath(args: {
  source: SourceName;
  url: string;
}) {
  const hash = createHash("sha256");
  hash.update(STORY_READER_CACHE_VERSION);
  hash.update(args.source);
  hash.update(args.url);

  return path.join(STORY_READER_CACHE_DIRECTORY, `${hash.digest("hex")}.json`);
}

async function loadCachedStoryReaderArticle(args: {
  source: SourceName;
  url: string;
}) {
  try {
    const raw = await readFile(buildStoryReaderCachePath(args), "utf8");
    const parsed = JSON.parse(raw) as CachedStoryReaderArticle;

    if (
      typeof parsed?.source !== "string" ||
      typeof parsed?.requestedUrl !== "string" ||
      typeof parsed?.resolvedUrl !== "string" ||
      typeof parsed?.displayTitle !== "string" ||
      typeof parsed?.summary !== "string" ||
      !Array.isArray(parsed?.bodyParagraphs)
    ) {
      return null;
    }

    return {
      ...parsed,
      openOriginalUrl:
        typeof parsed.openOriginalUrl === "string" && parsed.openOriginalUrl.trim()
          ? parsed.openOriginalUrl
          : parsed.resolvedUrl,
      previewOnly: parsed.previewOnly === true,
      recoverySource:
        parsed.recoverySource === "official-post" ||
        parsed.recoverySource === "excerpt"
          ? parsed.recoverySource
          : "article",
    } satisfies CachedStoryReaderArticle;
  } catch {
    return null;
  }
}

async function saveCachedStoryReaderArticle(
  article: StoryReaderArticle,
  urls: string[],
) {
  await mkdir(STORY_READER_CACHE_DIRECTORY, { recursive: true });

  const record = {
    ...article,
    cachedAt: new Date().toISOString(),
  } satisfies CachedStoryReaderArticle;

  await Promise.all(
    [...new Set(urls.filter(Boolean))].map((url) =>
      writeFile(
        buildStoryReaderCachePath({
          source: article.source,
          url,
        }),
        JSON.stringify(record, null, 2),
        "utf8",
      ),
    ),
  );
}

function normalizeBodyParagraphs(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => stripHtml(paragraph))
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeComparableToken(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > 5 && normalized.endsWith("s")) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function tokenizeComparableText(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "been",
    "being",
    "but",
    "for",
    "from",
    "has",
    "have",
    "into",
    "its",
    "legal",
    "more",
    "news",
    "that",
    "the",
    "their",
    "them",
    "they",
    "this",
    "under",
    "with",
  ]);

  return [
    ...new Set(
      value
        .split(/[\s/,:;'"“”‘’()[\]{}!?<>|]+/)
        .map((token) => normalizeComparableToken(token))
        .filter(
          (token): token is string =>
            Boolean(token) && token.length >= 4 && !stopWords.has(token),
        ),
    ),
  ];
}

function scoreOfficialPostMatch(args: {
  candidateBody: string;
  candidateTitle: string;
  publishedAt: string | null;
  targetPublishedAt: string | null | undefined;
  targetTitle: string | null | undefined;
}) {
  const titleTokens = tokenizeComparableText(args.targetTitle);
  const candidateTokens = new Set(
    tokenizeComparableText(`${args.candidateTitle}\n${args.candidateBody}`),
  );
  const overlap = titleTokens.filter((token) => candidateTokens.has(token));
  let score = overlap.length;

  if (
    overlap.includes("judge") &&
    overlap.includes("ethiopian") &&
    (overlap.includes("block") || overlap.includes("termination"))
  ) {
    score += 2;
  }

  const targetPublishedAt = args.targetPublishedAt
    ? new Date(args.targetPublishedAt)
    : null;
  const candidatePublishedAt = args.publishedAt
    ? new Date(args.publishedAt)
    : null;

  if (
    targetPublishedAt &&
    candidatePublishedAt &&
    !Number.isNaN(targetPublishedAt.getTime()) &&
    !Number.isNaN(candidatePublishedAt.getTime())
  ) {
    const diffMs = Math.abs(
      targetPublishedAt.getTime() - candidatePublishedAt.getTime(),
    );

    if (diffMs <= 18 * 60 * 60 * 1_000) {
      score += 2;
    } else if (diffMs <= 36 * 60 * 60 * 1_000) {
      score += 1;
    }
  }

  return score;
}

function parsePreparedRequestSourcePacket(raw: string, source: SourceName) {
  try {
    const parsed = JSON.parse(raw) as {
      request?: {
        sourcePackets?: Array<{
          content?: string;
          source?: string;
        }>;
      };
    };

    return (
      parsed.request?.sourcePackets?.find((packet) => packet.source === source)
        ?.content ?? null
    );
  } catch {
    return null;
  }
}

function parseTelegramMarkdownPosts(markdown: string) {
  const matches = markdown.matchAll(
    /###\s+\d+\.\s+([^\n]+)\nPlatform:\s+Official Telegram posts\nLanguage:\s+([^\n]+)\nPublished:\s+([^\n]+)\nURL:\s+(https:\/\/t\.me\/Addisstandard(?:Eng|Amh|AO)\/\d+)\n\n([\s\S]*?)(?=\n###\s+\d+\.\s+|\n##\s+|$)/g,
  );

  return [...matches].map((match) => ({
    title: stripHtml(match[1] || "").trim(),
    language:
      normalizeOriginalLanguageHint(match[2]?.trim() || null) ??
      inferAddisStandardTelegramLanguage(match[4]?.trim() || ""),
    publishedAt: match[3]?.trim() || null,
    telegramUrl: match[4]?.trim() || "",
    linkedPublicationUrl: null,
    body: stripHtml(match[5] || "").trim(),
  }));
}

async function listRecentAddisSourcePacketContents() {
  try {
    const entries = await readdir(NOTEBOOKLM_SOURCE_PACKETS_DIRECTORY, {
      withFileTypes: true,
    });
    const packets = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const filePath = path.join(
            NOTEBOOKLM_SOURCE_PACKETS_DIRECTORY,
            entry.name,
            "addis-standard.md",
          );

          try {
            const [raw, fileStats] = await Promise.all([
              readFile(filePath, "utf8"),
              stat(filePath),
            ]);

            return {
              raw,
              lastModified: fileStats.mtimeMs,
            };
          } catch {
            return null;
          }
        }),
    );

    return packets
      .filter(Boolean)
      .sort((left, right) => right!.lastModified - left!.lastModified)
      .slice(0, ADDIS_STANDARD_OFFICIAL_POST_LIMIT)
      .map((packet) => packet!.raw);
  } catch {
    return [];
  }
}

async function listLiveAddisStandardTelegramCandidates() {
  const candidates: AddisStandardOfficialPostCandidate[] = [];

  await Promise.all(
    ADDIS_STANDARD_OFFICIAL_TELEGRAM_CHANNELS.map(async (channel) => {
      try {
        const response = await fetch(channel.previewUrl, {
          headers: buildGoogleNewsFetchHeaders(),
          redirect: "follow",
        });

        if (!response.ok) {
          return;
        }

        const html = await response.text();
        const $ = load(html);

        $(".tgme_widget_message_wrap")
          .slice(0, ADDIS_STANDARD_OFFICIAL_POST_LIMIT * 2)
          .each((_, element) => {
            const messageText = $(element)
              .find(".tgme_widget_message_text")
              .text();
            const previewTitle = $(element).find(".link_preview_title").text();
            const previewDescription = $(element)
              .find(".link_preview_description")
              .text();
            const telegramUrl =
              $(element).find(".tgme_widget_message_date").attr("href")?.trim() ||
              "";

            if (!telegramUrl) {
              return;
            }

            const linkedPublicationUrl =
              $(element)
                .find(
                  '.tgme_widget_message_text a[href^="http"], .link_preview a[href^="http"]',
                )
                .toArray()
                .map((link) => $(link).attr("href")?.trim() || "")
                .find(
                  (href) =>
                    /^https?:\/\//i.test(href) && !/https?:\/\/t\.me\//i.test(href),
                ) || null;
            const body = buildTelegramPreviewBody({
              messageText,
              previewDescription,
              previewTitle,
            });

            if (!body) {
              return;
            }

            candidates.push({
              title: buildTelegramPreviewTitle({
                messageText,
                previewTitle,
              }),
              body,
              language: channel.language,
              linkedPublicationUrl,
              publishedAt:
                $(element).find("time").attr("datetime")?.trim() || null,
              telegramUrl,
            });
          });
      } catch {}
    }),
  );

  return candidates;
}

async function findMatchingAddisStandardOfficialPost(args: {
  preferredLanguage?: VariantLanguage | null;
  resolvedUrl?: string | null;
  publishedAt?: string | null;
  title?: string | null;
}) {
  const cachedCandidates: AddisStandardOfficialPostCandidate[] = [];

  try {
    const preparedRequestRaw = await readFile(
      NOTEBOOKLM_PREPARED_REQUEST_RECENT_PATH,
      "utf8",
    );
    const preparedSourcePacket = parsePreparedRequestSourcePacket(
      preparedRequestRaw,
      "Addis Standard",
    );

    if (preparedSourcePacket) {
      cachedCandidates.push(...parseTelegramMarkdownPosts(preparedSourcePacket));
    }
  } catch {}

  for (const sourcePacketRaw of await listRecentAddisSourcePacketContents()) {
    cachedCandidates.push(...parseTelegramMarkdownPosts(sourcePacketRaw));
  }

  const liveCandidates = await listLiveAddisStandardTelegramCandidates();
  const targetResolvedUrl = normalizeComparableUrl(args.resolvedUrl);
  const allCandidates = [...liveCandidates, ...cachedCandidates];

  let bestMatch: AddisStandardOfficialPostCandidate | null = null;
  let bestScore = 0;

  for (const candidate of allCandidates) {
    let score = scoreOfficialPostMatch({
      candidateBody: candidate.body,
      candidateTitle: candidate.title,
      publishedAt: candidate.publishedAt,
      targetPublishedAt: args.publishedAt,
      targetTitle: args.title,
    });
    const candidatePublicationUrl = normalizeComparableUrl(
      candidate.linkedPublicationUrl,
    );
    const exactPublicationUrlMatch =
      Boolean(targetResolvedUrl) &&
      Boolean(candidatePublicationUrl) &&
      targetResolvedUrl === candidatePublicationUrl;

    if (exactPublicationUrlMatch) {
      score += 4;
    }

    if (args.preferredLanguage) {
      if (candidate.language === args.preferredLanguage) {
        score += 3;
      } else if (!exactPublicationUrlMatch) {
        score -= 1;
      }
    }

    if (
      score > bestScore ||
      (score === bestScore &&
        Boolean(args.preferredLanguage) &&
        candidate.language === args.preferredLanguage &&
        bestMatch?.language !== args.preferredLanguage)
    ) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  if (bestScore < ADDIS_STANDARD_OFFICIAL_POST_MATCH_THRESHOLD) {
    return null;
  }

  return bestMatch;
}

function normalizeTelegramParagraphs(paragraphs: string[]) {
  const normalized = paragraphs
    .map((paragraph) =>
      paragraph
        .replace(/\s+/g, " ")
        .replace(/(^|[\s(])#([A-Za-z0-9_]+)/g, "$1$2")
        .replace(/\s+([,.!?;:])/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .filter((paragraph) => !/^Read more:/i.test(paragraph));

  const trimmed = [...normalized];

  while (
    trimmed.length > 1 &&
    !/[.!?"”']$/.test(trimmed.at(-1) ?? "") &&
    (trimmed.at(-1)?.split(/\s+/).length ?? 0) <= 30
  ) {
    trimmed.pop();
  }

  return trimmed;
}

function cleanOfficialPostTitle(value: string) {
  return value
    .replace(/^News:\s*/i, "")
    .replace(/#([A-Za-z0-9_]+)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTelegramTextBlocks(messageHtml: string) {
  return messageHtml
    .split(/(?:<br\s*\/?>\s*){2,}|<\/p>\s*<p[^>]*>/i)
    .map((block) => stripHtml(block))
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function recoverAddisStandardOfficialPost(telegramUrl: string) {
  try {
    const response = await fetch(`${telegramUrl}?embed=1&mode=tme`, {
      headers: buildGoogleNewsFetchHeaders(),
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = load(html);
    const message = $(".tgme_widget_message_text").first();
    const messageHtml = message.html();
    const previewTitle = $(".link_preview_title").first().text().trim();
    const previewDescription = $(".link_preview_description").first().text().trim();

    if (!messageHtml) {
      return null;
    }

    const [rawTitle, ...messageParagraphs] = normalizeTelegramParagraphs(
      extractTelegramTextBlocks(messageHtml),
    );
    const previewParagraphs = normalizeTelegramParagraphs(
      previewDescription ? [previewDescription] : [],
    );
    const bodyParagraphs: string[] = [];
    const seenParagraphs = new Set<string>();

    for (const paragraph of [...messageParagraphs, ...previewParagraphs]) {
      const key = paragraph.toLowerCase();

      if (seenParagraphs.has(key)) {
        continue;
      }

      seenParagraphs.add(key);
      bodyParagraphs.push(paragraph);
    }

    if ((!rawTitle && !previewTitle) || bodyParagraphs.length === 0) {
      return null;
    }

    const readMoreUrl =
      message
        .find('a[href*="addisstandard.com"]')
        .toArray()
        .map((link) => $(link).attr("href")?.trim() || "")
        .concat(
          $(".link_preview a[href*=\"addisstandard.com\"]")
            .toArray()
            .map((link) => $(link).attr("href")?.trim() || ""),
        )
        .find(Boolean) || null;
    const photoStyle = $(".tgme_widget_message_photo_wrap")
      .first()
      .attr("style");
    const imageUrl =
      photoStyle?.match(/background-image:url\('([^']+)'\)/)?.[1] ?? null;

    return {
      title: cleanOfficialPostTitle(rawTitle || previewTitle),
      bodyParagraphs,
      readMoreUrl,
      imageUrl,
      publishedAt: $("time.datetime").first().attr("datetime")?.trim() || null,
    } satisfies AddisStandardOfficialPostRecovery;
  } catch {
    return null;
  }
}

function isTelegramPreviewOnly(args: {
  bodyParagraphs: string[];
  readMoreUrl: string | null;
}) {
  if (!args.readMoreUrl || args.bodyParagraphs.length === 0) {
    return false;
  }

  const lastParagraph = args.bodyParagraphs.at(-1)?.trim() ?? "";
  const bodyLength = args.bodyParagraphs.join("\n\n").length;

  if (bodyLength >= 3_500 || args.bodyParagraphs.length >= 7) {
    return false;
  }

  return (
    !lastParagraph ||
    bodyLength < 1_600 ||
    /(?:\.\.\.|…)$/.test(lastParagraph) ||
    !/[.!?"”']$/.test(lastParagraph)
  );
}

async function resolveGoogleNewsPublisherUrl(url: string) {
  const normalizedUrl = unwrapGoogleContinueUrl(url) ?? url;

  if (!/news\.google\.com/i.test(normalizedUrl)) {
    return normalizedUrl;
  }

  if (isGoogleVerificationUrl(normalizedUrl)) {
    return normalizedUrl;
  }

  try {
    const decodedUrl = await decodeGoogleNewsArticleUrl(
      normalizedUrl,
      fetch,
      buildGoogleNewsFetchHeaders(),
    );

    if (decodedUrl && !isGoogleVerificationUrl(decodedUrl)) {
      return decodedUrl;
    }
  } catch {}

  if (!existsSync(GOOGLE_NEWS_RESOLVER_SCRIPT)) {
    return normalizedUrl;
  }

  return new Promise<string>((resolve) => {
    const child = spawn(process.execPath, [GOOGLE_NEWS_RESOLVER_SCRIPT], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.on("error", () => resolve(url));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(url);
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as Array<{
          resolvedUrl: string;
          sourceUrl: string;
        }>;
        const resolvedUrl = parsed[0]?.resolvedUrl || normalizedUrl;
        resolve(isGoogleVerificationUrl(resolvedUrl) ? normalizedUrl : resolvedUrl);
      } catch {
        resolve(normalizedUrl);
      }
    });

    child.stdin.write(JSON.stringify({ urls: [normalizedUrl] }));
    child.stdin.end();
  });
}

function splitParagraphsForTranslation(paragraphs: string[]) {
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const paragraph of paragraphs) {
    const normalizedParagraph = paragraph.trim();

    if (!normalizedParagraph) {
      continue;
    }

    const nextLength = currentLength + normalizedParagraph.length;
    const shouldStartNewChunk =
      currentChunk.length >= STORY_READER_TRANSLATION_CHUNK_MAX_PARAGRAPHS ||
      (currentChunk.length > 0 &&
        nextLength > STORY_READER_TRANSLATION_CHUNK_MAX_CHARACTERS);

    if (shouldStartNewChunk) {
      chunks.push(currentChunk.join("\n\n"));
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(normalizedParagraph);
    currentLength += normalizedParagraph.length;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n\n"));
  }

  return chunks;
}

async function translateStoryBodyInChunks(args: {
  bodyParagraphs: string[];
  originalLanguage: VariantLanguage;
  publishedAt: string | null;
  source: SourceName;
  title: string;
  url: string;
}) {
  const translationChunks = splitParagraphsForTranslation(args.bodyParagraphs);

  if (translationChunks.length === 0) {
    return null;
  }

  let translatedTitle = args.title;
  const translatedBodyChunks: string[] = [];

  for (const [index, chunk] of translationChunks.entries()) {
    const translatedChunk = await translateNewsItemToEnglish({
      source: args.source,
      title: args.title,
      body: chunk,
      publishedAt: args.publishedAt ?? new Date().toISOString(),
      url: args.url,
      force: true,
      languageHint: args.originalLanguage,
      maxOutputTokens: 3_000,
    });

    if (!translatedChunk?.body?.trim()) {
      return null;
    }

    if (index === 0 && translatedChunk.title.trim()) {
      translatedTitle = stripHtml(translatedChunk.title);
    }

    translatedBodyChunks.push(translatedChunk.body.trim());
  }

  return {
    title: translatedTitle,
    body: translatedBodyChunks.join("\n\n"),
  };
}

async function buildAddisStandardOfficialPostArticle(args: {
  knownOriginalLanguage: VariantLanguage | null;
  match: AddisStandardOfficialPostCandidate;
  publishedAt: string | null | undefined;
  requestedUrl: string;
  resolvedUrl: string;
  source: SourceName;
  storyTitle: string | null | undefined;
}) {
  const officialPost = await recoverAddisStandardOfficialPost(args.match.telegramUrl);

  if (!officialPost) {
    return null;
  }

  const officialPostLooksEnglish = isItemProbablyEnglish({
    source: args.source,
    title: officialPost.title,
    snippet: truncate(officialPost.bodyParagraphs.join("\n\n"), 1_200),
    language: "English",
  });
  const originalLanguage =
    officialPostLooksEnglish ? "english" : args.match.language;
  const previewOnly = isTelegramPreviewOnly({
    bodyParagraphs: officialPost.bodyParagraphs,
    readMoreUrl: officialPost.readMoreUrl,
  });
  const openOriginalUrl =
    args.match.linkedPublicationUrl ??
    officialPost.readMoreUrl ??
    args.resolvedUrl;
  let displayTitle = stripHtml(args.storyTitle ?? officialPost.title);
  let summary = truncate(
    officialPost.bodyParagraphs[0] || displayTitle || officialPost.title,
    220,
  );
  let bodyParagraphs = officialPost.bodyParagraphs;
  let translatedOnDemand = false;
  let translationFailed = false;

  if (originalLanguage !== "english" && !officialPostLooksEnglish) {
    const translated = await translateStoryBodyInChunks({
      source: args.source,
      title: officialPost.title,
      bodyParagraphs: officialPost.bodyParagraphs,
      publishedAt:
        args.publishedAt ??
        officialPost.publishedAt ??
        args.match.publishedAt ??
        null,
      url: officialPost.readMoreUrl ?? args.resolvedUrl,
      originalLanguage,
    });

    if (translated?.body?.trim()) {
      bodyParagraphs = normalizeBodyParagraphs(translated.body);
      displayTitle = stripHtml(translated.title || displayTitle);
      summary = truncate(bodyParagraphs[0] || displayTitle, 220);
      translatedOnDemand = true;
    } else {
      translationFailed = true;
    }
  }

  return {
    source: args.source,
    requestedUrl: args.requestedUrl,
    resolvedUrl: officialPost.readMoreUrl ?? args.resolvedUrl,
    openOriginalUrl,
    originalTitle: args.storyTitle ?? officialPost.title,
    displayTitle,
    summary,
    bodyParagraphs,
    imageUrl: officialPost.imageUrl,
    publishedAt:
      args.publishedAt ??
      officialPost.publishedAt ??
      args.match.publishedAt,
    originalLanguage,
    translatedOnDemand,
    translationFailed,
    excerptFallback: false,
    previewOnly,
    recoverySource: "official-post",
  } satisfies StoryReaderArticle;
}

async function buildExcerptFallbackArticle(args: {
  publishedAt?: string | null;
  resolvedUrl: string;
  snippet?: string | null;
  source: SourceName;
  title?: string | null;
  url: string;
  knownOriginalLanguage?: VariantLanguage | null;
}): Promise<StoryReaderArticle | null> {
  const fallbackTitle = stripHtml(args.title || "Addis Standard article");
  const fallbackSnippet = stripHtml(args.snippet || "").trim();
  const originalLanguage =
    args.knownOriginalLanguage ??
    inferVariantLanguage({
      source: args.source,
      title: fallbackTitle,
      snippet: fallbackSnippet,
      language: "English",
    });
  const excerptSeed = fallbackSnippet || fallbackTitle;
  const excerptLooksEnglish = isItemProbablyEnglish({
    source: args.source,
    title: fallbackTitle,
    snippet: excerptSeed,
    language: "English",
  });

  if (!fallbackTitle && !fallbackSnippet) {
    return null;
  }

  let displayTitle = fallbackTitle;
  let summary = fallbackSnippet || fallbackTitle;
  let bodyParagraphs = fallbackSnippet ? [fallbackSnippet] : [fallbackTitle];
  let translatedOnDemand = false;
  let translationFailed = false;

  if (
    originalLanguage !== "english" &&
    !excerptLooksEnglish &&
    (fallbackTitle || fallbackSnippet)
  ) {
    const translatedSnippet = await translateNewsItemToEnglish({
      source: args.source,
      title: fallbackTitle,
      body: fallbackSnippet || fallbackTitle,
      publishedAt: args.publishedAt ?? new Date().toISOString(),
      url: args.resolvedUrl,
      force: true,
      languageHint: originalLanguage,
      maxOutputTokens: 1_600,
    });

    if (translatedSnippet?.body?.trim()) {
      displayTitle = stripHtml(translatedSnippet.title || fallbackTitle);
      summary = firstSentence(translatedSnippet.body);
      bodyParagraphs = normalizeBodyParagraphs(translatedSnippet.body);
      translatedOnDemand = true;
    } else {
      translationFailed = true;
    }
  }

  return {
    source: args.source,
    requestedUrl: args.url,
    resolvedUrl: args.resolvedUrl,
    openOriginalUrl: args.resolvedUrl,
    originalTitle: fallbackTitle,
    displayTitle,
    summary,
    bodyParagraphs,
    imageUrl: null,
    publishedAt: args.publishedAt ?? null,
    originalLanguage,
    translatedOnDemand,
    translationFailed,
    excerptFallback: true,
    previewOnly: false,
    recoverySource: "excerpt",
  } satisfies StoryReaderArticle;
}

async function extractAddisStandardArticleWithBrowser(url: string) {
  if (!existsSync(ADDIS_STANDARD_BROWSER_EXTRACTOR_SCRIPT)) {
    return null;
  }

  return new Promise<AddisStandardBrowserArticle | null>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [ADDIS_STANDARD_BROWSER_EXTRACTOR_SCRIPT, url],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ADDIS_STANDARD_BROWSER_PROFILE_DIRECTORY,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const timeoutId = setTimeout(() => {
      try {
        child.kill();
      } catch {}

      reject(
        new Error(
          `Addis Standard browser extractor timed out after ${Math.round(
            STORY_READER_BROWSER_EXTRACT_TIMEOUT_MS / 1_000,
          )} seconds.`,
        ),
      );
    }, STORY_READER_BROWSER_EXTRACT_TIMEOUT_MS);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeoutId);

      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              `Addis Standard browser extractor exited with code ${code}.`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(trimmed) as AddisStandardBrowserArticle);
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Failed to parse Addis Standard browser extractor output."),
        );
      }
    });
  });
}

async function loadStoryReaderArticle(args: {
  knownOriginalLanguage?: VariantLanguage | null;
  publishedAt?: string | null;
  snippet?: string | null;
  source: SourceName;
  title?: string | null;
  url: string;
}): Promise<StoryReaderArticle | null> {
  if (args.source !== "Addis Standard" || !args.url) {
    return null;
  }

  const hintedOriginalLanguage = normalizeOriginalLanguageHint(
    args.knownOriginalLanguage,
  );

  const cachedRequestedArticle = await loadCachedStoryReaderArticle({
    source: args.source,
    url: args.url,
  });

  if (cachedRequestedArticle) {
    return {
      ...cachedRequestedArticle,
      requestedUrl: args.url,
    } satisfies StoryReaderArticle;
  }

  const resolvedUrl = await resolveGoogleNewsPublisherUrl(args.url);
  const cachedResolvedArticle = await loadCachedStoryReaderArticle({
    source: args.source,
    url: resolvedUrl,
  });

  if (cachedResolvedArticle) {
    const hydratedArticle = {
      ...cachedResolvedArticle,
      requestedUrl: args.url,
      resolvedUrl,
    } satisfies StoryReaderArticle;

    if (resolvedUrl !== args.url) {
      await saveCachedStoryReaderArticle(hydratedArticle, [args.url, resolvedUrl]);
    }

    return hydratedArticle;
  }

  let extracted: AddisStandardBrowserArticle | null = null;

  try {
    extracted = await extractAddisStandardArticleWithBrowser(resolvedUrl);
  } catch {
    extracted = null;
  }

  if (!extracted || extracted.body.trim().length < 180) {
    const officialPostMatch = await findMatchingAddisStandardOfficialPost({
      preferredLanguage: hintedOriginalLanguage,
      resolvedUrl,
      title: args.title,
      publishedAt: args.publishedAt,
    });

    if (officialPostMatch) {
      const article = await buildAddisStandardOfficialPostArticle({
        source: args.source,
        match: officialPostMatch,
        requestedUrl: args.url,
        resolvedUrl,
        storyTitle: args.title,
        publishedAt: args.publishedAt,
        knownOriginalLanguage: hintedOriginalLanguage,
      });

      if (article) {
        await saveCachedStoryReaderArticle(article, [
          args.url,
          resolvedUrl,
          article.resolvedUrl,
          officialPostMatch.telegramUrl,
        ]);

        return article;
      }
    }

    return buildExcerptFallbackArticle({
      source: args.source,
      title: args.title,
      snippet: args.snippet,
      publishedAt: args.publishedAt ?? null,
      url: args.url,
      resolvedUrl,
      knownOriginalLanguage: hintedOriginalLanguage,
    });
  }

  const originalTitle = stripHtml(extracted.title || args.title || resolvedUrl);
  const originalBodyParagraphs = normalizeBodyParagraphs(extracted.body);
  const originalBody = originalBodyParagraphs.join("\n\n");
  const originalLanguage =
    hintedOriginalLanguage ??
    inferVariantLanguage({
      source: args.source,
      title: originalTitle,
      snippet: truncate(originalBody, 1_200),
      language: "English",
    });
  const publishedAt = extracted.publishedAt ?? args.publishedAt ?? null;
  const originalProbablyEnglish =
    originalLanguage === "english" ||
    (!hintedOriginalLanguage &&
      isItemProbablyEnglish({
        source: args.source,
        title: originalTitle,
        snippet: truncate(originalBody, 1_200),
        language: "English",
      }));

  if (originalProbablyEnglish) {
    const article = {
      source: args.source,
      requestedUrl: args.url,
      resolvedUrl: extracted.finalUrl || resolvedUrl,
      openOriginalUrl: extracted.finalUrl || resolvedUrl,
      originalTitle,
      displayTitle: originalTitle,
      summary: firstSentence(extracted.description || originalBody || originalTitle),
      bodyParagraphs: originalBodyParagraphs,
      imageUrl: extracted.imageUrl,
      publishedAt,
      originalLanguage,
      translatedOnDemand: false,
      translationFailed: false,
      excerptFallback: false,
      previewOnly: false,
      recoverySource: "article",
    } satisfies StoryReaderArticle;

    await saveCachedStoryReaderArticle(article, [
      args.url,
      resolvedUrl,
      extracted.finalUrl || resolvedUrl,
    ]);

    return article;
  }

  const translated = await translateStoryBodyInChunks({
    source: args.source,
    title: originalTitle,
    bodyParagraphs: originalBodyParagraphs,
      publishedAt,
      url: extracted.finalUrl || resolvedUrl,
      originalLanguage,
    });

  if (
    translated &&
    isItemProbablyEnglish({
      source: args.source,
      title: translated.title,
      snippet: truncate(translated.body, 1_200),
      language: "English",
    })
  ) {
    const translatedParagraphs = normalizeBodyParagraphs(translated.body);

    const article = {
      source: args.source,
      requestedUrl: args.url,
      resolvedUrl: extracted.finalUrl || resolvedUrl,
      openOriginalUrl: extracted.finalUrl || resolvedUrl,
      originalTitle,
      displayTitle: stripHtml(translated.title),
      summary: firstSentence(
        translatedParagraphs.join("\n\n") || translated.title || originalTitle,
      ),
      bodyParagraphs: translatedParagraphs,
      imageUrl: extracted.imageUrl,
      publishedAt,
      originalLanguage,
      translatedOnDemand: true,
      translationFailed: false,
      excerptFallback: false,
      previewOnly: false,
      recoverySource: "article",
    } satisfies StoryReaderArticle;

    await saveCachedStoryReaderArticle(article, [
      args.url,
      resolvedUrl,
      extracted.finalUrl || resolvedUrl,
    ]);

    return article;
  }

  const officialPostMatch = await findMatchingAddisStandardOfficialPost({
    preferredLanguage: hintedOriginalLanguage ?? originalLanguage,
    resolvedUrl: extracted.finalUrl || resolvedUrl,
    title: args.title ?? originalTitle,
    publishedAt,
  });

  if (officialPostMatch) {
    const article = await buildAddisStandardOfficialPostArticle({
      source: args.source,
      match: officialPostMatch,
      requestedUrl: args.url,
      resolvedUrl: extracted.finalUrl || resolvedUrl,
      storyTitle: args.title ?? originalTitle,
      publishedAt,
      knownOriginalLanguage: hintedOriginalLanguage ?? originalLanguage,
    });

    if (article) {
      article.imageUrl = article.imageUrl ?? extracted.imageUrl;
      await saveCachedStoryReaderArticle(article, [
        args.url,
        resolvedUrl,
        extracted.finalUrl || resolvedUrl,
        article.resolvedUrl,
        officialPostMatch.telegramUrl,
      ]);

      return article;
    }
  }

  const fallbackArticle = await buildExcerptFallbackArticle({
    source: args.source,
    title: args.title ?? originalTitle,
    snippet: args.snippet ?? extracted.description ?? firstSentence(originalBody),
    publishedAt,
    url: args.url,
    resolvedUrl: extracted.finalUrl || resolvedUrl,
    knownOriginalLanguage: hintedOriginalLanguage ?? originalLanguage,
  });

  if (fallbackArticle) {
    return {
      ...fallbackArticle,
      resolvedUrl: extracted.finalUrl || resolvedUrl,
      openOriginalUrl: extracted.finalUrl || resolvedUrl,
      imageUrl: extracted.imageUrl,
      publishedAt,
      originalTitle,
      originalLanguage,
      translatedOnDemand: true,
    } satisfies StoryReaderArticle;
  }

  return {
    source: args.source,
    requestedUrl: args.url,
    resolvedUrl: extracted.finalUrl || resolvedUrl,
    openOriginalUrl: extracted.finalUrl || resolvedUrl,
    originalTitle,
    displayTitle: originalTitle,
    summary: firstSentence(extracted.description || originalBody || originalTitle),
    bodyParagraphs: [],
    imageUrl: extracted.imageUrl,
    publishedAt,
    originalLanguage,
    translatedOnDemand: true,
    translationFailed: true,
    excerptFallback: false,
    previewOnly: false,
    recoverySource: "article",
  };
}

export async function getStoryReaderArticle(args: {
  knownOriginalLanguage?: VariantLanguage | null;
  publishedAt?: string | null;
  snippet?: string | null;
  source: SourceName;
  title?: string | null;
  url: string;
}): Promise<StoryReaderArticle | null> {
  const requestKey = `${args.source}::${args.url}`;
  const pendingRequest = pendingStoryReaderRequests.get(requestKey);

  if (pendingRequest) {
    return pendingRequest;
  }

  const nextRequest = loadStoryReaderArticle(args).finally(() => {
    pendingStoryReaderRequests.delete(requestKey);
  });

  pendingStoryReaderRequests.set(requestKey, nextRequest);
  return nextRequest;
}
