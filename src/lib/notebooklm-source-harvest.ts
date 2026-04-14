import { gunzipSync } from "node:zlib";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import { load } from "cheerio";

import {
  looksLikeAmharicText,
  translateAmharicNewsItemToEnglish,
} from "@/lib/amharic-text-translation";
import {
  SOURCE_NAMES,
  type LanguageLabel,
  type SourceName,
  type WeeklyBrief,
} from "@/lib/dashboard";
import {
  harvestOfficialSocialSupplements,
  sanitizeOfficialSocialItem,
} from "@/lib/notebooklm-social-harvest";
import {
  extractVoaEpisodeDetail,
  selectPreferredVoaAudioSource,
  translateVoaAudioSourceToEnglish,
  translateVoaEpisodeToEnglish,
} from "@/lib/voa-audio-translation";
import { fetchText } from "@/lib/news/http";
import { parseRssFeed } from "@/lib/news/sources/helpers";
import type { SourceFetchResult } from "@/lib/news/types";
import {
  extractEnglishDate,
  extractLeadingDayMonthDate,
  removeTrackingParams,
  stripHtml,
  toAbsoluteUrl,
  truncate,
} from "@/lib/news/text";

const REPORTER_FEED_URL =
  "https://www.thereporterethiopia.com/latest-news-in-ethiopia/feed/";
const ETHIOPIA_INSIGHT_FEED_URL = "https://www.ethiopia-insight.com/feed/";
const ETHIOPIA_INSIGHT_HOME_URL = "https://www.ethiopia-insight.com/";
const ETHIOPIA_INSIGHT_POST_SITEMAP_URL =
  "https://www.ethiopia-insight.com/post-sitemap.xml";
const VOA_SCHEDULE_BASE_URL = "https://amharic.voanews.com/radio/schedule/68";
const VOA_ONE_HOUR_ARCHIVE_URL = "https://amharic.voanews.com/one-hour-radio-show";
const VOA_PODCAST_FEED_URL = "https://amharic.voanews.com/podcast/?zoneId=3303";
const VOA_VIDEO_SITEMAP_URL = "https://amharic.voanews.com/sitemap_404_videos.xml.gz";
const ENA_HOME_URL = "https://www.ena.et/web/eng";
const NEBE_ARCHIVE_URL = "https://nebe.org.et/en/news-archive";
const ADDIS_STANDARD_QUERY = "site:addisstandard.com Ethiopia";
const ADDIS_STANDARD_BROWSER_EXTRACTOR_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "extract-addis-standard-article.mjs",
);
const FACEBOOK_POST_EXTRACTOR_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "extract-facebook-post.mjs",
);
const ADDIS_STANDARD_BROWSER_PROFILE_DIRECTORY =
  process.env.ADDIS_STANDARD_BROWSER_PROFILE_DIRECTORY ||
  path.join(process.cwd(), ".cache", "addis-standard-profile");
const ENA_OFFICIAL_URL_PATTERN =
  /^https:\/\/www\.ena\.et\/web\/(?:eng|amh)\/w\/[a-z]+_[0-9]+/i;
const NEBE_OFFICIAL_URL_PATTERN = /^https:\/\/nebe\.org\.et\/en\/node\/\d+/i;

const MAX_PUBLICATION_BODY_LENGTH = 8_000;
const MAX_TRANSCRIPT_BODY_LENGTH = 12_000;
const MAX_SOURCE_ITEMS = 40;
const GOOGLE_NEWS_RESOLUTION_LIMIT = 40;
const ADDIS_STANDARD_MIRROR_LOOKUP_LIMIT = 8;

const SOURCE_SPECIFIC_BOILERPLATE: Partial<Record<SourceName, RegExp[]>> = {
  "The Reporter Ethiopia": [
    /^receive in-depth analysis/i,
    /^you'?re almost there!/i,
    /^most read$/i,
    /^subscribe/i,
  ],
  "Ethiopia Insight": [
    /^support ethiopia insight$/i,
    /^donate/i,
    /^share this/i,
    /^related posts$/i,
  ],
  ENA: [
    /^share$/i,
    /^follow us/i,
  ],
  NEBE: [
    /^office:/i,
    /^telephone:/i,
    /^fax/i,
    /^email:/i,
    /^copy right/i,
  ],
  "VOA Amharic": [
    /^share$/i,
    /^no media source currently available$/i,
  ],
};

export type NotebookLmCaptureKind =
  | "full-article"
  | "rss-excerpt"
  | "mirror-excerpt"
  | "translated-transcript"
  | "social-post"
  | "dashboard-snippet"
  | "headline-record";

export interface NotebookLmPacketItem {
  title: string;
  url: string | null;
  publishedAt: string;
  language: LanguageLabel;
  section: string;
  body: string;
  captureKind: NotebookLmCaptureKind;
  captureNote: string | null;
  recencyNote?: string | null;
}

export interface NotebookLmPacketDraft {
  source: SourceName;
  items: NotebookLmPacketItem[];
  diagnostics: string[];
  coverageExhausted?: boolean;
  checkedSurfaces?: string[];
  weeklySourceCheck?: NotebookLmWeeklySourceCheck | null;
  weeklyUploadCheck?: NotebookLmWeeklyUploadCheck | null;
}

interface HtmlPublicationCandidate {
  title: string;
  url: string;
  publishedAt: string;
  language: LanguageLabel;
  section: string;
  fallbackBody: string;
}

interface NotebookLmRecencyVerification {
  accepted: boolean;
  note: string | null;
  reason: string | null;
}

interface AddisStandardBrowserExtraction {
  body: string;
  finalUrl: string;
  publishedAt: string | null;
  title: string;
}

interface FacebookPostExtraction {
  body: string;
  externalUrls: string[];
  finalUrl: string;
  publishedAt: string | null;
  title: string;
}

export interface NotebookLmWeeklyUploadCheck {
  checkedWindowEnd: string;
  checkedWindowStart: string;
  exactUploadCount: number;
  exactUploadDates: string[];
  latestArchiveListingDate: string | null;
  latestExactUploadAt: string | null;
  method: string;
  missingUploadDates: string[];
  scheduledDateCount: number;
  scheduledDates: string[];
  summary: string;
}

export interface NotebookLmWeeklySourceCheck {
  checkedSurfaceCount: number;
  checkedWindowEnd: string;
  checkedWindowStart: string;
  coverageExhausted: boolean;
  latestVerifiedItemAt: string | null;
  method: string;
  status: "verified-items-found" | "no-current-items-found" | "incomplete";
  summary: string;
  verifiedItemCount: number;
  verifiedItemDates: string[];
}

export interface VoaPodcastFeedEpisode {
  enclosureUrl: string;
  publishedAt: string;
  summary: string;
  title: string;
  url: string;
}

export interface VoaVideoSitemapEntry {
  publishedAt: string;
  title: string;
  url: string;
}

export interface VoaScheduleDayEntry {
  itemId: string | null;
  publishedAt: string;
  scheduleUrl: string;
  summary: string;
  title: string;
}

function isWithinWindow(value: string, brief: WeeklyBrief) {
  const publishedAt = new Date(value).getTime();
  const windowStart = new Date(brief.windowStart).getTime();
  const windowEnd = new Date(brief.windowEnd).getTime();

  return (
    Number.isFinite(publishedAt) &&
    Number.isFinite(windowStart) &&
    Number.isFinite(windowEnd) &&
    publishedAt >= windowStart &&
    publishedAt <= windowEnd
  );
}

function formatRecencyTimestamp(value: string) {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(timestamp);
}

function dedupeIsoDates(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const dates: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
      continue;
    }

    const isoDate = timestamp.toISOString();
    if (seen.has(isoDate)) {
      continue;
    }

    seen.add(isoDate);
    dates.push(isoDate);
  }

  return dates;
}

function dedupeStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function extractHtmlPublishedAtCandidates(html: string) {
  const $ = load(html);
  const attributeCandidates = [
    $('meta[property="article:published_time"]').attr("content"),
    $('meta[property="og:updated_time"]').attr("content"),
    $('meta[name="pubdate"]').attr("content"),
    $('meta[name="publish-date"]').attr("content"),
    $('meta[name="parsely-pub-date"]').attr("content"),
    $('meta[name="article:published_time"]').attr("content"),
    $("time").first().attr("datetime"),
  ];
  const regexCandidates = [
    ...[...html.matchAll(/pub_datetime:"([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/"datePublished":"([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/"dateModified":"([^"]+)"/g)].map((match) => match[1]),
  ];

  return dedupeIsoDates([...attributeCandidates, ...regexCandidates]);
}

function buildRecencyNote(evidence: string[]) {
  return evidence.length > 0
    ? `Verified current-window source using ${evidence.join("; ")}.`
    : null;
}

function formatShortUtcDate(value: string) {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(timestamp);
}

function describeWeeklySourceCheckMethod(source: SourceName) {
  switch (source) {
    case "Addis Standard":
      return "Resolved exact publisher URLs from weekly indexing surfaces, checked official Addis Standard social surfaces, and accepted only source-authored items whose recovered timestamps stayed inside the active 7-day window.";
    case "The Reporter Ethiopia":
      return "Checked the official feed, fetched article pages, and accepted only items whose recovered timestamps and page evidence stayed inside the active 7-day window.";
    case "Ethiopia Insight":
      return "Checked the official feed, homepage, and post sitemap, then accepted only items whose recovered timestamps or URL/page evidence stayed inside the active 7-day window.";
    case "ENA":
      return "Checked official homepage story links, recovered publication dates from the source pages, and accepted only items whose date evidence stayed inside the active 7-day window.";
    case "NEBE":
      return "Checked the official archive pages, recovered publication dates from the source pages, and accepted only items whose date evidence stayed inside the active 7-day window.";
    case "VOA Amharic":
      return "Checked VOA's official schedule/archive surfaces and accepted only exact archived audio items whose official publication evidence stayed inside the active 7-day window.";
    default:
      return "Checked the configured official surfaces and accepted only items whose recovered evidence stayed inside the active 7-day window.";
  }
}

function isGenericVoaWrapper(args: {
  title: string;
  body: string;
  html?: string;
  url?: string | null;
}) {
  const normalizedTitle = normalizeParagraph(args.title).toLowerCase();
  const normalizedBody = normalizeBodyText(args.body).toLowerCase();
  const normalizedHtml = normalizeBodyText(args.html ?? "").toLowerCase();
  const normalizedUrl = (args.url ?? "").toLowerCase();

  return (
    normalizedTitle.includes("voa amharic audio tube") ||
    normalizedBody.includes("voa amharic audio tube") ||
    normalizedHtml.includes("voa amharic audio tube") ||
    normalizedHtml.includes("(mc-45)") ||
    /\/t\/68\.html/.test(normalizedUrl) ||
    /\/t\/68\.html/.test(normalizedHtml)
  );
}

export function verifyNotebookLmItemRecency(args: {
  source: SourceName;
  brief: WeeklyBrief;
  title: string;
  body: string;
  publishedAt: string;
  url: string | null;
  html?: string;
  mediaUrl?: string | null;
}) {
  const evidence: string[] = [];
  const publishedAt = args.publishedAt;

  if (!publishedAt || !isWithinWindow(publishedAt, args.brief)) {
    return {
      accepted: false,
      note: null,
      reason: "The recovered item timestamp is outside the active 7-day window.",
    } satisfies NotebookLmRecencyVerification;
  }

  if (
    args.source === "VOA Amharic" &&
    isGenericVoaWrapper({
      title: args.title,
      body: args.body,
      html: args.html,
      url: args.url,
    })
  ) {
    return {
      accepted: false,
      note: null,
      reason:
        "The recovered VOA page is a generic audio/live wrapper rather than a date-specific publication.",
    } satisfies NotebookLmRecencyVerification;
  }

  evidence.push(`published timestamp ${formatRecencyTimestamp(publishedAt)}`);

  const htmlDates = args.html ? extractHtmlPublishedAtCandidates(args.html) : [];
  const urlDate = args.url ? deriveIsoDateFromUrl(args.url) : null;
  const mediaDate = args.mediaUrl ? deriveIsoDateFromUrl(args.mediaUrl) : null;
  const titleDate = extractEnglishDate(args.title);

  const conflictingSignals = dedupeIsoDates([
    ...htmlDates.filter((value) => !isWithinWindow(value, args.brief)),
    urlDate && !isWithinWindow(urlDate, args.brief) ? urlDate : null,
    mediaDate && !isWithinWindow(mediaDate, args.brief) ? mediaDate : null,
    titleDate && !isWithinWindow(titleDate, args.brief) ? titleDate : null,
  ]);

  if (conflictingSignals.length > 0) {
    return {
      accepted: false,
      note: null,
      reason: `The source itself exposed an older date (${conflictingSignals
        .map((value) => formatRecencyTimestamp(value))
        .join(", ")}) outside the active 7-day window.`,
    } satisfies NotebookLmRecencyVerification;
  }

  const inWindowHtmlDates = htmlDates.filter((value) =>
    isWithinWindow(value, args.brief),
  );

  if (inWindowHtmlDates[0]) {
    evidence.push(`page metadata ${formatRecencyTimestamp(inWindowHtmlDates[0])}`);
  }

  if (urlDate && isWithinWindow(urlDate, args.brief)) {
    evidence.push(`URL date ${formatRecencyTimestamp(urlDate)}`);
  }

  if (mediaDate && isWithinWindow(mediaDate, args.brief)) {
    evidence.push(`media asset date ${formatRecencyTimestamp(mediaDate)}`);
  }

  if (titleDate && isWithinWindow(titleDate, args.brief)) {
    evidence.push(`title date ${formatRecencyTimestamp(titleDate)}`);
  }

  return {
    accepted: true,
    note: buildRecencyNote(evidence),
    reason: null,
  } satisfies NotebookLmRecencyVerification;
}

function normalizeParagraph(text: string) {
  return stripHtml(text)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBodyText(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => normalizeParagraph(paragraph))
    .filter(Boolean)
    .join("\n\n");
}

function extractSlashSeparatedPublicationDate(text: string) {
  const cleaned = stripHtml(text);
  const match = cleaned.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\/(\d{4})\b/i,
  );

  if (!match) {
    return null;
  }

  const [, monthName, dayValue, yearValue] = match;
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

function limitBodyLength(text: string) {
  if (text.length <= MAX_PUBLICATION_BODY_LENGTH) {
    return text;
  }

  const paragraphs = text.split(/\n{2,}/);
  const kept: string[] = [];
  let total = 0;

  for (const paragraph of paragraphs) {
    const nextLength = total + paragraph.length + (kept.length > 0 ? 2 : 0);
    if (nextLength > MAX_PUBLICATION_BODY_LENGTH) {
      break;
    }

    kept.push(paragraph);
    total = nextLength;
  }

  if (kept.length === 0) {
    return truncate(text, MAX_PUBLICATION_BODY_LENGTH);
  }

  return kept.join("\n\n");
}

function limitTranscriptBodyLength(text: string) {
  if (text.length <= MAX_TRANSCRIPT_BODY_LENGTH) {
    return text;
  }

  const paragraphs = text.split(/\n{2,}/);
  const kept: string[] = [];
  let total = 0;

  for (const paragraph of paragraphs) {
    const nextLength = total + paragraph.length + (kept.length > 0 ? 2 : 0);
    if (nextLength > MAX_TRANSCRIPT_BODY_LENGTH) {
      break;
    }

    kept.push(paragraph);
    total = nextLength;
  }

  if (kept.length === 0) {
    return truncate(text, MAX_TRANSCRIPT_BODY_LENGTH);
  }

  return kept.join("\n\n");
}

function dedupeParagraphs(paragraphs: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const paragraph of paragraphs) {
    const normalized = normalizeParagraph(paragraph);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

export function filterBoilerplateParagraphs(
  source: SourceName,
  paragraphs: string[],
) {
  const sourcePatterns = SOURCE_SPECIFIC_BOILERPLATE[source] ?? [];

  return dedupeParagraphs(paragraphs).filter((paragraph) => {
    if (paragraph.length < 20) {
      return false;
    }

    if (/^[A-Z\s:.-]{10,}$/.test(paragraph) && paragraph.length < 80) {
      return false;
    }

    if (sourcePatterns.some((pattern) => pattern.test(paragraph))) {
      return false;
    }

    return true;
  });
}

function buildPublicationBody(
  source: SourceName,
  paragraphs: string[],
  fallbackBody: string,
) {
  const filteredParagraphs = filterBoilerplateParagraphs(source, paragraphs);
  const paragraphBody = filteredParagraphs.join("\n\n");
  const normalizedFallback = normalizeBodyText(fallbackBody);

  if (paragraphBody.length > 0) {
    return limitBodyLength(paragraphBody);
  }

  if (normalizedFallback.length > 0) {
    return limitBodyLength(normalizedFallback);
  }

  return "";
}

function extractUrlsFromText(text: string) {
  return dedupeStrings(
    [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((match) =>
      normalizeCandidateUrl(match[0].replace(/[.…]+$/, "")),
    ),
  );
}

function findOfficialPublicationUrlInItem(
  source: SourceName,
  item: NotebookLmPacketItem,
) {
  const urls = extractUrlsFromText(
    [item.title, item.body, item.captureNote ?? ""].join("\n"),
  );

  if (source === "ENA") {
    return urls.find((url) => ENA_OFFICIAL_URL_PATTERN.test(url)) ?? null;
  }

  if (source === "NEBE") {
    return urls.find((url) => NEBE_OFFICIAL_URL_PATTERN.test(url)) ?? null;
  }

  if (source === "Addis Standard") {
    return (
      urls.find((url) => /^https:\/\/addisstandard\.com\/?/i.test(url)) ?? null
    );
  }

  return null;
}

function findLinkedFacebookUrlInItem(item: NotebookLmPacketItem) {
  const urls = extractUrlsFromText(
    [item.url ?? "", item.title, item.body, item.captureNote ?? ""].join("\n"),
  );

  return (
    urls.find((url) =>
      /^https:\/\/(?:www\.)?facebook\.com\/(?:share\/|[^/]+\/posts\/|[^/]+\/permalink\.php|\S+)/i.test(
        url,
      ),
    ) ?? null
  );
}

function deriveRecoveredPublicationSection(
  source: SourceName,
  linkedUrl: string,
  fallbackSection: string,
) {
  if (source === "Addis Standard" && /^https:\/\/addisstandard\.com\/?/i.test(linkedUrl)) {
    return "Official website publications";
  }

  if (source === "ENA" && ENA_OFFICIAL_URL_PATTERN.test(linkedUrl)) {
    return "Official website publications";
  }

  if (source === "NEBE" && NEBE_OFFICIAL_URL_PATTERN.test(linkedUrl)) {
    return "Official website publications";
  }

  return fallbackSection;
}

async function extractAddisStandardArticleWithBrowser(url: string) {
  if (!existsSync(ADDIS_STANDARD_BROWSER_EXTRACTOR_SCRIPT)) {
    return null;
  }

  return new Promise<AddisStandardBrowserExtraction | null>((resolve, reject) => {
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
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
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
        const parsed = JSON.parse(trimmed) as AddisStandardBrowserExtraction;
        resolve(parsed);
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

const facebookPostExtractionCache = new Map<
  string,
  Promise<FacebookPostExtraction | null>
>();

async function extractFacebookPostWithBrowser(url: string) {
  const cacheKey = normalizeCandidateUrl(url);
  const cached = facebookPostExtractionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const extractionPromise = (async () => {
    if (!existsSync(FACEBOOK_POST_EXTRACTOR_SCRIPT)) {
      return null;
    }

    return new Promise<FacebookPostExtraction | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [FACEBOOK_POST_EXTRACTOR_SCRIPT, cacheKey],
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
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              stderr.trim() ||
                `Facebook post extractor exited with code ${code}.`,
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
          resolve(JSON.parse(trimmed) as FacebookPostExtraction);
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Failed to parse Facebook post extractor output."),
          );
        }
      });
    });
  })();

  facebookPostExtractionCache.set(cacheKey, extractionPromise);

  try {
    return await extractionPromise;
  } catch (error) {
    facebookPostExtractionCache.delete(cacheKey);
    throw error;
  }
}

async function translatePacketItemIfNeeded(
  source: SourceName,
  item: NotebookLmPacketItem,
) {
  if (
    item.language === "English" &&
    !looksLikeAmharicText([item.title, item.body].join("\n"))
  ) {
    return item;
  }

  const translated = await translateAmharicNewsItemToEnglish({
    source,
    title: item.title,
    body: item.body,
    publishedAt: item.publishedAt,
    url: item.url,
  });

  if (!translated) {
    return item;
  }

  return {
    ...item,
    title: translated.title,
    body:
      item.captureKind === "translated-transcript"
        ? limitTranscriptBodyLength(translated.body)
        : limitBodyLength(translated.body),
    language: "English" as const,
    captureNote: item.captureNote
      ? `${item.captureNote} ${translated.captureNote}`
      : translated.captureNote,
  } satisfies NotebookLmPacketItem;
}

async function recoverOfficialPublicationFromSocialItem(args: {
  brief: WeeklyBrief;
  item: NotebookLmPacketItem;
  source: SourceName;
}) {
  if (args.item.captureKind !== "social-post") {
    return null;
  }

  const linkedUrl = findOfficialPublicationUrlInItem(args.source, args.item);

  const buildRecoveredItem = async (recovered: {
    body: string;
    html?: string;
    publishedAt: string;
    title: string;
    url: string;
  }) => {
    const recoveredItem = await translatePacketItemIfNeeded(args.source, {
      title: stripHtml(recovered.title),
      url: recovered.url,
      publishedAt: recovered.publishedAt,
      language:
        /\/amh\//i.test(recovered.url) || looksLikeAmharicText(recovered.body)
          ? ("Amharic" as const)
          : ("English" as const),
      section: deriveRecoveredPublicationSection(
        args.source,
        recovered.url,
        args.item.section,
      ),
      body: recovered.body,
      captureKind: "full-article" as const,
      captureNote:
        "Recovered the linked official publication text from the source-owned URL shared in the official social post.",
      recencyNote: args.item.recencyNote ?? null,
    });

    const recency = verifyNotebookLmItemRecency({
      source: args.source,
      brief: args.brief,
      title: recoveredItem.title,
      body: recoveredItem.body,
      publishedAt: recoveredItem.publishedAt,
      url: recoveredItem.url,
      html: recovered.html,
    });

    if (!recency.accepted) {
      return null;
    }

    return {
      ...recoveredItem,
      recencyNote: recency.note,
    } satisfies NotebookLmPacketItem;
  };

  if (linkedUrl) {
    try {
      const html = await fetchText(linkedUrl, {
        retries: 0,
        timeoutMs: 15_000,
      });
      const paragraphs =
        args.source === "ENA"
          ? extractEnaArticle(html)
          : args.source === "NEBE"
            ? extractNebeArticle(html)
            : args.source === "Addis Standard"
              ? extractParagraphs(html, [
                  "article .entry-content p",
                  "article p",
                  ".entry-content p",
                ])
              : [];
      const extractedBody = buildPublicationBody(args.source, paragraphs, "");

      if (extractedBody.length >= 180) {
        const $ = load(html);
        const htmlPublishedAt = extractHtmlPublishedAtCandidates(html).find((value) =>
          isWithinWindow(value, args.brief),
        );
        const resolvedTitle =
          $('meta[property="og:title"]').attr("content") ||
          $("h1").first().text().trim() ||
          $("title").text().trim() ||
          args.item.title;

        return buildRecoveredItem({
          body: extractedBody,
          html,
          publishedAt: htmlPublishedAt ?? args.item.publishedAt,
          title: resolvedTitle,
          url: linkedUrl,
        });
      }
    } catch {
      // Fall through to the browser recovery path for sources that block raw fetches.
    }

    if (
      args.source === "Addis Standard" &&
      /^https:\/\/addisstandard\.com\/?/i.test(linkedUrl)
    ) {
      try {
        const browserExtraction = await extractAddisStandardArticleWithBrowser(linkedUrl);
        if (!browserExtraction || browserExtraction.body.trim().length < 180) {
          return null;
        }

        return buildRecoveredItem({
          body: browserExtraction.body,
          publishedAt: browserExtraction.publishedAt ?? args.item.publishedAt,
          title: browserExtraction.title || args.item.title,
          url: browserExtraction.finalUrl || linkedUrl,
        });
      } catch {
        return null;
      }
    }
  }

  if (args.source === "Addis Standard") {
    const linkedFacebookUrl = findLinkedFacebookUrlInItem(args.item);

    if (linkedFacebookUrl) {
      try {
        const facebookExtraction = await extractFacebookPostWithBrowser(
          linkedFacebookUrl,
        );
        if (facebookExtraction && facebookExtraction.body.trim().length >= 120) {
          const linkedOfficialUrl =
            facebookExtraction.externalUrls.find((url) =>
              /^https:\/\/addisstandard\.com\/?/i.test(url),
            ) ?? null;

          if (linkedOfficialUrl) {
            return recoverOfficialPublicationFromSocialItem({
              ...args,
              item: {
                ...args.item,
                url: facebookExtraction.finalUrl || linkedFacebookUrl,
                title: facebookExtraction.title || args.item.title,
                body: facebookExtraction.body,
                captureNote: [
                  "Recovered the linked official Facebook post shared by Addis Standard.",
                  linkedOfficialUrl,
                ]
                  .filter(Boolean)
                  .join(" "),
              },
            });
          }

          const translatedFacebook = await translatePacketItemIfNeeded(
            args.source,
            {
              ...args.item,
              title: facebookExtraction.title || args.item.title,
              url: facebookExtraction.finalUrl || linkedFacebookUrl,
              publishedAt:
                facebookExtraction.publishedAt ?? args.item.publishedAt,
              body: facebookExtraction.body,
              captureKind: "social-post",
              captureNote:
                "Recovered the linked official Facebook post shared by Addis Standard.",
            },
          );

          if (translatedFacebook.body.trim().length > 0) {
            return translatedFacebook;
          }
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

async function refinePacketItemsForNotebookLm(
  brief: WeeklyBrief,
  source: SourceName,
  items: NotebookLmPacketItem[],
) {
  const refined: NotebookLmPacketItem[] = [];

  for (const item of sortItemsNewestFirst(items)) {
    if (item.captureKind === "social-post") {
      const sanitized = sanitizeOfficialSocialItem({
        source,
        title: item.title,
        body: item.body,
      });

      if (!sanitized) {
        continue;
      }

      const sanitizedItem = {
        ...item,
        title: sanitized.title,
        body: sanitized.body,
      } satisfies NotebookLmPacketItem;
      const recoveredPublication = await recoverOfficialPublicationFromSocialItem({
        brief,
        item: sanitizedItem,
        source,
      });

      if (recoveredPublication) {
        refined.push(recoveredPublication);
        continue;
      }

      const translatedSocial = await translatePacketItemIfNeeded(source, sanitizedItem);
      const resanitizedSocial = sanitizeOfficialSocialItem({
        source,
        title: translatedSocial.title,
        body: translatedSocial.body,
      });

      if (!resanitizedSocial) {
        continue;
      }

      const cleanedTranslatedSocial = {
        ...translatedSocial,
        title: resanitizedSocial.title,
        body: resanitizedSocial.body,
      } satisfies NotebookLmPacketItem;
      if (cleanedTranslatedSocial.body.trim().length === 0) {
        continue;
      }

      refined.push(cleanedTranslatedSocial);
      continue;
    }

    const translatedItem = await translatePacketItemIfNeeded(source, item);
    if (translatedItem.body.trim().length === 0) {
      continue;
    }

    refined.push(translatedItem);
  }

  return dedupePacketItems(refined);
}

function extractParagraphs(
  html: string,
  selectors: string[],
) {
  const $ = load(html);
  const paragraphs: string[] = [];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const text = $(element).text();
      if (text) {
        paragraphs.push(text);
      }
    });

    if (paragraphs.length > 0) {
      break;
    }
  }

  return paragraphs;
}

function normalizeCandidateUrl(url: string) {
  return removeTrackingParams(url).replace(/\/$/, "");
}

function dedupePacketItems(items: NotebookLmPacketItem[]) {
  const seen = new Set<string>();
  const deduped: NotebookLmPacketItem[] = [];

  for (const item of sortItemsNewestFirst(items)) {
    const key = [
      item.url ? normalizeCandidateUrl(item.url) : "",
      item.title.trim().toLowerCase(),
      item.publishedAt,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function deriveIsoDateFromUrl(url: string) {
  const match = url.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);

  if (!match) {
    return null;
  }

  const [, yearValue, monthValue, dayValue] = match;
  return new Date(
    Date.UTC(Number(yearValue), Number(monthValue) - 1, Number(dayValue)),
  ).toISOString();
}

function mergePublicationCandidates(
  candidates: HtmlPublicationCandidate[],
  options?: {
    requirePublishedAt?: boolean;
  },
) {
  const byUrl = new Map<string, HtmlPublicationCandidate>();
  const requirePublishedAt = options?.requirePublishedAt ?? true;

  for (const candidate of candidates) {
    if (!candidate.url || (requirePublishedAt && !candidate.publishedAt)) {
      continue;
    }

    const key = normalizeCandidateUrl(candidate.url);
    const existing = byUrl.get(key);

    if (!existing) {
      byUrl.set(key, {
        ...candidate,
        url: key,
      });
      continue;
    }

    byUrl.set(key, {
      ...existing,
      title:
        candidate.title.length > existing.title.length
          ? candidate.title
          : existing.title,
      publishedAt: existing.publishedAt || candidate.publishedAt,
      section:
        existing.section === "News" && candidate.section !== "News"
          ? candidate.section
          : existing.section,
      fallbackBody:
        candidate.fallbackBody.length > existing.fallbackBody.length
          ? candidate.fallbackBody
          : existing.fallbackBody,
      language: existing.language,
      url: key,
    });
  }

  return [...byUrl.values()];
}

function buildWindowCandidateMap(candidates: HtmlPublicationCandidate[]) {
  return mergePublicationCandidates(candidates, {
    requirePublishedAt: true,
  });
}

function extractEthiopiaInsightHomepageCandidates(html: string) {
  const $ = load(html);
  const seen = new Map<string, HtmlPublicationCandidate>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const title = $(element).text().replace(/\s+/g, " ").trim();
    const url = toAbsoluteUrl(ETHIOPIA_INSIGHT_HOME_URL, href);
    const publishedAt = deriveIsoDateFromUrl(url);

    if (
      !publishedAt ||
      title.length < 16 ||
      !url.includes("/20") ||
      /\/big-slider\/?$/i.test(url)
    ) {
      return;
    }

    seen.set(normalizeCandidateUrl(url), {
      title,
      url,
      publishedAt,
      language: "English",
      section: "Analysis",
      fallbackBody: title,
    });
  });

  return [...seen.values()];
}

function extractSitemapEntries(xml: string) {
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
    .map((match) => ({
      url: stripHtml(match[1]),
      publishedAt: new Date(match[2]).toISOString(),
    }))
    .filter(
      (entry) =>
        entry.url &&
        entry.publishedAt &&
        /\/20\d{2}\/\d{2}\/\d{2}\//.test(entry.url) &&
        !/\/big-slider\/?$/i.test(entry.url),
    );
}

function toUtcDateKey(value: string) {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toISOString().slice(0, 10);
}

function buildWindowCalendarDates(brief: WeeklyBrief) {
  const start = new Date(brief.windowStart);
  const end = new Date(brief.windowEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }

  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  const dates: Date[] = [];
  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  ) {
    dates.push(new Date(cursor));
  }

  return dates;
}

function buildVoaScheduleDayUrl(date: Date) {
  return `${VOA_SCHEDULE_BASE_URL}/${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function buildVoaCanonicalAudioUrl(date: Date) {
  const year = date.getUTCFullYear().toString();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const stamp = `${year}${month}${day}-180000`;

  return `https://voa-audio-ns.akamaized.net/vam/${year}/${month}/${day}/${stamp}-vam068-program_hq.mp3`;
}

function extractVoaArchiveLatestListingDate(html: string) {
  const $ = load(html);
  const rawDate = $(".date.date--mb.date--size-3").first().text().trim();

  return rawDate || null;
}

async function fetchPossiblyGzippedText(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentEncoding = response.headers.get("content-encoding")?.toLowerCase() ?? "";
  const isGzipped =
    contentEncoding.includes("gzip") || url.toLowerCase().endsWith(".gz");

  if (!isGzipped) {
    return buffer.toString("utf8");
  }

  return gunzipSync(buffer).toString("utf8");
}

export async function extractVoaPodcastFeedEpisodes(xml: string) {
  const feed = await parseRssFeed(xml);

  return sortItemsNewestFirst(
    (feed.items ?? [])
      .map((item) => {
        const enclosureUrl =
          typeof item.enclosure?.url === "string" ? item.enclosure.url : "";
        const publishedAt =
          item.isoDate ??
          (item.pubDate ? new Date(item.pubDate).toISOString() : "");
        const summary =
          typeof (item as { itunes?: { summary?: string } }).itunes?.summary ===
          "string"
            ? (item as { itunes?: { summary?: string } }).itunes?.summary ?? ""
            : item.content ?? item.contentSnippet ?? item.title ?? "";

        return {
          enclosureUrl: removeTrackingParams(enclosureUrl) ?? enclosureUrl,
          publishedAt,
          summary: normalizeBodyText(summary),
          title: stripHtml(item.title ?? ""),
          url: item.link ?? item.guid ?? "",
        } satisfies VoaPodcastFeedEpisode;
      })
      .filter(
        (item) =>
          item.title &&
          item.url &&
          item.publishedAt &&
          item.enclosureUrl &&
          /\.mp3(\?|$)/i.test(item.enclosureUrl),
      ),
  );
}

export function extractVoaVideoSitemapEntries(xml: string) {
  return sortItemsNewestFirst(
    [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)]
      .map((match) => {
        const block = match[1];
        const url = stripHtml(block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "");
        const publishedAt = new Date(
          block.match(/<video:publication_date>([^<]+)<\/video:publication_date>/)?.[1] ??
            "",
        ).toISOString();
        const title = stripHtml(
          block.match(/<video:title>([^<]+)<\/video:title>/)?.[1] ?? "",
        );

        return {
          url,
          publishedAt,
          title,
        };
      })
      .filter((entry) => entry.url && entry.title && entry.publishedAt),
  ) satisfies VoaVideoSitemapEntry[];
}

export function extractVoaScheduleDayEntry(
  html: string,
  scheduleUrl: string,
): VoaScheduleDayEntry | null {
  const $ = load(html);
  const firstItem = $(".schedule__item").first();
  const title = normalizeParagraph(firstItem.find(".schedule__item-title").first().text());
  const summary = normalizeParagraph(
    firstItem.find(".schedule__item-intro").first().text(),
  );
  const itemIdMatch =
    firstItem.attr("data-switch-target")?.match(/more-less-(\d+)/)?.[1] ??
    html.match(/data-switch-target="more-less-(\d+)"/)?.[1] ??
    null;
  const pageTitleDate =
    extractEnglishDate($("title").first().text()) ??
    extractEnglishDate(html) ??
    deriveIsoDateFromUrl(scheduleUrl);

  if (!title || !pageTitleDate) {
    return null;
  }

  return {
    itemId: itemIdMatch,
    publishedAt: pageTitleDate,
    scheduleUrl,
    summary,
    title,
  } satisfies VoaScheduleDayEntry;
}

async function probeVoaAudioUrl(url: string) {
  const requestHeaders = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
  };

  const attempts: Array<{
    headers?: Record<string, string>;
    method?: "GET" | "HEAD";
  }> = [
    { method: "HEAD" },
    {
      method: "GET",
      headers: {
        Range: "bytes=0-0",
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch(url, {
        method: attempt.method,
        headers: {
          ...requestHeaders,
          ...attempt.headers,
        },
        redirect: "follow",
        cache: "no-store",
      });

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const contentLength = Number(response.headers.get("content-length") ?? "0");

      if (
        /audio\//i.test(contentType) ||
        /\.mp3(\?|$)/i.test(response.url) ||
        contentLength > 0
      ) {
        return {
          contentLength,
          contentType,
          url: response.url,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function buildFallbackItems(
  sourceResults: SourceFetchResult[],
  brief: WeeklyBrief,
) {
  const itemsBySource = new Map<SourceName, NotebookLmPacketItem[]>();

  sourceResults.forEach((result) => {
    result.items
      .filter((item) => isWithinWindow(item.publishedAt, brief))
      .forEach((item) => {
        const current = itemsBySource.get(item.source) ?? [];
        current.push({
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          language: item.language,
          section: item.section,
          body: normalizeBodyText(item.snippet || item.title) || item.title,
          captureKind: "dashboard-snippet",
          captureNote:
            "Using dashboard snippet fallback because fuller publication text could not be recovered automatically for this source item.",
        });
        itemsBySource.set(item.source, current);
      });
  });

  return itemsBySource;
}

function sortItemsNewestFirst<T extends { publishedAt: string }>(items: T[]) {
  return items.slice().sort((left, right) => {
    return (
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
    );
  });
}

function applyStrictRecencyVerification(
  brief: WeeklyBrief,
  packet: NotebookLmPacketDraft,
) {
  const diagnostics = [...packet.diagnostics];
  let blockedCount = 0;

  const items = packet.items.flatMap((item) => {
    const recency = verifyNotebookLmItemRecency({
      source: packet.source,
      brief,
      title: item.title,
      body: item.body,
      publishedAt: item.publishedAt,
      url: item.url,
    });

    if (!recency.accepted) {
      blockedCount += 1;
      diagnostics.push(`Blocked stale source item "${item.title}": ${recency.reason}`);
      return [];
    }

    return [
      {
        ...item,
        recencyNote: item.recencyNote ?? recency.note,
      } satisfies NotebookLmPacketItem,
    ];
  });

  if (blockedCount > 0) {
    diagnostics.push(
      `Strict recency verification removed ${blockedCount} item${blockedCount === 1 ? "" : "s"} outside the current 7-day window or lacking reliable current-window evidence.`,
    );
  }

  return {
    ...packet,
    items: dedupePacketItems(items),
    diagnostics,
    weeklySourceCheck: packet.weeklySourceCheck ?? null,
    weeklyUploadCheck: packet.weeklyUploadCheck ?? null,
  } satisfies NotebookLmPacketDraft;
}

async function enrichHtmlCandidates(
  source: SourceName,
  brief: WeeklyBrief,
  candidates: HtmlPublicationCandidate[],
  articleExtractor: (html: string) => string[],
) {
  const results = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const html = await fetchText(candidate.url);
      const extractedBody = buildPublicationBody(source, articleExtractor(html), "");
      const fallbackBody = normalizeBodyText(candidate.fallbackBody) || candidate.title;
      const $ = load(html);
      const resolvedTitle =
        candidate.title ||
        $('meta[property="og:title"]').attr("content") ||
        $("h1").first().text().trim() ||
        $("title").text().trim() ||
        candidate.url;
      const hasSubstantialArticleBody = extractedBody.length >= 180;
      const body = hasSubstantialArticleBody ? extractedBody : fallbackBody;
      const recency = verifyNotebookLmItemRecency({
        source,
        brief,
        title: stripHtml(resolvedTitle),
        body,
        publishedAt: candidate.publishedAt,
        url: candidate.url,
        html,
      });

      if (!recency.accepted) {
        return null;
      }

      return {
        title: stripHtml(resolvedTitle),
        url: candidate.url,
        publishedAt: candidate.publishedAt,
        language: candidate.language,
        section: candidate.section,
        body,
        captureKind: hasSubstantialArticleBody ? "full-article" : "rss-excerpt",
        captureNote:
          hasSubstantialArticleBody
            ? null
            : "The page loaded, but only the feed excerpt could be recovered cleanly.",
        recencyNote: recency.note,
      } satisfies NotebookLmPacketItem;
    }),
  );

  return sortItemsNewestFirst(
    results.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    ),
  );
}

async function enrichExactVoaAudioEpisodes(
  episodes: VoaPodcastFeedEpisode[],
  brief: WeeklyBrief,
) {
  const items: NotebookLmPacketItem[] = [];

  for (const episode of episodes) {
    const translated = await translateVoaAudioSourceToEnglish({
      audioSource: {
        kind: "download",
        label: "podcast MP3",
        url: episode.enclosureUrl,
      },
      episodeUrl: episode.url,
      publishedAt: episode.publishedAt,
      title: episode.title,
    });

    const body = translated?.text
      ? limitTranscriptBodyLength(translated.text)
      : limitBodyLength(episode.summary || episode.title);
    const recency = verifyNotebookLmItemRecency({
      source: "VOA Amharic",
      brief,
      title: stripHtml(episode.title),
      body,
      publishedAt: translated?.publishedAt ?? episode.publishedAt,
      url: episode.url,
      mediaUrl: translated?.mediaUrl ?? episode.enclosureUrl,
    });

    if (!recency.accepted) {
      continue;
    }

    items.push({
      title: stripHtml(episode.title),
      url: episode.url,
      publishedAt: translated?.publishedAt ?? episode.publishedAt,
      language: translated?.text ? ("English" as const) : ("Amharic" as const),
      section: "Program",
      body,
      captureKind: translated?.text
        ? ("translated-transcript" as const)
        : ("rss-excerpt" as const),
      captureNote:
        translated?.captureNote ??
        "Recovered from VOA Amharic's official podcast enclosure, but an English transcript could not be generated in this run.",
      recencyNote: recency.note,
    } satisfies NotebookLmPacketItem);
  }

  const sortedItems = sortItemsNewestFirst(items);

  return {
    items: sortedItems,
    translatedCount: sortedItems.filter(
      (item) => item.captureKind === "translated-transcript",
    ).length,
  };
}

async function enrichVoaVideoSitemapEntries(
  entries: VoaVideoSitemapEntry[],
  brief: WeeklyBrief,
) {
  const items: NotebookLmPacketItem[] = [];

  for (const entry of entries) {
    const detailHtml = await fetchText(entry.url, {
      retries: 0,
      timeoutMs: 15_000,
    });
    const detail = extractVoaEpisodeDetail(detailHtml, entry.url);
    const translated = await translateVoaEpisodeToEnglish({
      detailHtml,
      episodeUrl: entry.url,
      publishedAt: detail.publishedAt ?? entry.publishedAt,
      title: entry.title,
    });
    const preferredSource = selectPreferredVoaAudioSource(detail.audioSources);
    const body = translated?.text
      ? limitTranscriptBodyLength(translated.text)
      : limitBodyLength(detail.description || entry.title);
    const publishedAt = translated?.publishedAt ?? detail.publishedAt ?? entry.publishedAt;
    const recency = verifyNotebookLmItemRecency({
      source: "VOA Amharic",
      brief,
      title: stripHtml(entry.title),
      body,
      publishedAt,
      url: entry.url,
      html: detailHtml,
      mediaUrl: translated?.mediaUrl ?? preferredSource?.url ?? null,
    });

    if (!recency.accepted) {
      continue;
    }

    items.push({
      title: stripHtml(entry.title),
      url: entry.url,
      publishedAt,
      language: translated?.text ? ("English" as const) : ("Amharic" as const),
      section: "Program",
      body,
      captureKind: translated?.text
        ? ("translated-transcript" as const)
        : ("rss-excerpt" as const),
      captureNote:
        translated?.captureNote ??
        "Recovered from VOA Amharic's official video sitemap entry, but an English transcript could not be generated in this run.",
      recencyNote: recency.note,
    } satisfies NotebookLmPacketItem);
  }

  const sortedItems = sortItemsNewestFirst(items);

  return {
    items: sortedItems,
    translatedCount: sortedItems.filter(
      (item) => item.captureKind === "translated-transcript",
    ).length,
  };
}

export function buildWeeklyUploadCheck(args: {
  brief: WeeklyBrief;
  exactEpisodes: VoaPodcastFeedEpisode[];
  latestArchiveListingDate: string | null;
  scheduleEntries: VoaScheduleDayEntry[];
}) {
  const exactUploadDates = sortItemsNewestFirst(args.exactEpisodes)
    .map((episode) => episode.publishedAt)
    .filter((value, index, values) => values.indexOf(value) === index);
  const scheduledDates = sortItemsNewestFirst(args.scheduleEntries)
    .map((entry) => entry.publishedAt)
    .filter((value, index, values) => values.indexOf(value) === index);
  const exactDateKeys = new Set(
    exactUploadDates
      .map((value) => toUtcDateKey(value))
      .filter((value): value is string => Boolean(value)),
  );
  const missingUploadDates = scheduledDates.filter((value) => {
    const key = toUtcDateKey(value);
    return key ? !exactDateKeys.has(key) : true;
  });

  return {
    checkedWindowEnd: args.brief.windowEnd,
    checkedWindowStart: args.brief.windowStart,
    exactUploadCount: exactUploadDates.length,
    exactUploadDates,
    latestArchiveListingDate: args.latestArchiveListingDate,
    latestExactUploadAt: exactUploadDates[0] ?? null,
    method:
      "Checked the official VOA Amharic podcast feed for exact MP3 uploads and compared it against the official daily schedule pages for the same 7-day window.",
    missingUploadDates,
    scheduledDateCount: scheduledDates.length,
    scheduledDates,
    summary:
      exactUploadDates.length > 0
        ? `VOA uploaded ${exactUploadDates.length} exact archived audio item${exactUploadDates.length === 1 ? "" : "s"} for this coverage week (${exactUploadDates
            .map((value) => formatShortUtcDate(value))
            .join(", ")}).`
        : `VOA showed scheduled daily broadcasts for this coverage week, but no exact archived audio uploads were available in the official podcast feed for those dates.`,
  } satisfies NotebookLmWeeklyUploadCheck;
}

export function buildWeeklySourceCheck(args: {
  source: SourceName;
  brief: WeeklyBrief;
  items: NotebookLmPacketItem[];
  checkedSurfaces?: string[];
  coverageExhausted?: boolean;
}) {
  const verifiedItemDates = sortItemsNewestFirst(args.items)
    .map((item) => item.publishedAt)
    .filter((value, index, values) => values.indexOf(value) === index);
  const checkedSurfaceCount = args.checkedSurfaces?.length ?? 0;
  const coverageExhausted = args.coverageExhausted === true;
  const status =
    verifiedItemDates.length > 0
      ? "verified-items-found"
      : coverageExhausted
        ? "no-current-items-found"
        : "incomplete";

  const summary =
    status === "verified-items-found"
      ? `Verified ${verifiedItemDates.length} current-window item${verifiedItemDates.length === 1 ? "" : "s"} for ${args.source} (${verifiedItemDates
          .map((value) => formatShortUtcDate(value))
          .join(", ")}) after checking ${checkedSurfaceCount} official surface${checkedSurfaceCount === 1 ? "" : "s"}.`
      : status === "no-current-items-found"
        ? `Checked ${checkedSurfaceCount} official surface${checkedSurfaceCount === 1 ? "" : "s"} for ${args.source} and found no verified current-window items in this 7-day window.`
        : `The ${args.source} harvester did not complete an exhaustive weekly verification pass, so fallback or partial data may be present.`;

  return {
    checkedSurfaceCount,
    checkedWindowEnd: args.brief.windowEnd,
    checkedWindowStart: args.brief.windowStart,
    coverageExhausted,
    latestVerifiedItemAt: verifiedItemDates[0] ?? null,
    method: describeWeeklySourceCheckMethod(args.source),
    status,
    summary,
    verifiedItemCount: verifiedItemDates.length,
    verifiedItemDates,
  } satisfies NotebookLmWeeklySourceCheck;
}

function extractReporterArticle(html: string) {
  return extractParagraphs(html, [
    ".tdb_single_content p",
    ".td-post-content p",
    "article p",
  ]);
}

function extractEthiopiaInsightArticle(html: string) {
  return extractParagraphs(html, [".entry-content p", "article p"]);
}

function extractEnaArticle(html: string) {
  return extractParagraphs(html, [".component-html p", "main p", "p"]);
}

function extractNebeArticle(html: string) {
  return extractParagraphs(html, ["article p", ".region-content p", "p"]);
}

async function harvestReporter(brief: WeeklyBrief): Promise<NotebookLmPacketDraft> {
  const xml = await fetchText(`${REPORTER_FEED_URL}?nocache=${Date.now()}`);
  const feed = await parseRssFeed(xml);
  const candidates = (feed.items ?? [])
    .map((item) => ({
      title: stripHtml(item.title ?? ""),
      url: item.link ?? "",
      publishedAt: item.pubDate
        ? new Date(item.pubDate).toISOString()
        : "",
      language: "English" as const,
      section: item.categories?.[0] ?? "News",
      fallbackBody: item.content ?? item.contentSnippet ?? item.title ?? "",
    }))
    .filter((item) => item.title && item.url && isWithinWindow(item.publishedAt, brief))
    .slice(0, MAX_SOURCE_ITEMS);

  return {
    source: "The Reporter Ethiopia",
    items: await enrichHtmlCandidates(
      "The Reporter Ethiopia",
      brief,
      candidates,
      extractReporterArticle,
    ),
    diagnostics: [
      `Recovered ${candidates.length} Reporter publications in the 7-day window.`,
    ],
    coverageExhausted: true,
    checkedSurfaces: [REPORTER_FEED_URL],
  };
}

async function harvestEthiopiaInsight(
  brief: WeeklyBrief,
): Promise<NotebookLmPacketDraft> {
  const [feedXml, homepageHtml, sitemapXml] = await Promise.all([
    fetchText(ETHIOPIA_INSIGHT_FEED_URL),
    fetchText(ETHIOPIA_INSIGHT_HOME_URL),
    fetchText(ETHIOPIA_INSIGHT_POST_SITEMAP_URL),
  ]);
  const feed = await parseRssFeed(feedXml);
  const feedCandidates = (feed.items ?? []).map((item) => ({
    title: stripHtml(item.title ?? ""),
    url: item.link ?? "",
    publishedAt: item.pubDate
      ? new Date(item.pubDate).toISOString()
      : "",
    language: "English" as const,
    section: item.categories?.[0] ?? "Analysis",
    fallbackBody: item.content ?? item.contentSnippet ?? item.title ?? "",
  }));
  const homepageCandidates = extractEthiopiaInsightHomepageCandidates(homepageHtml);
  const sitemapCandidates = extractSitemapEntries(sitemapXml).map((entry) => ({
    title: "",
    url: entry.url,
    publishedAt: entry.publishedAt,
    language: "English" as const,
    section: "Analysis",
    fallbackBody: "",
  }));
  const candidates = buildWindowCandidateMap([
    ...feedCandidates,
    ...homepageCandidates,
    ...sitemapCandidates,
  ])
    .filter((item) => item.url && isWithinWindow(item.publishedAt, brief))
    .slice(0, MAX_SOURCE_ITEMS);

  return {
    source: "Ethiopia Insight",
    items: await enrichHtmlCandidates(
      "Ethiopia Insight",
      brief,
      candidates,
      extractEthiopiaInsightArticle,
    ),
    diagnostics: [
      `Recovered ${candidates.length} Ethiopia Insight publications in the 7-day window after checking the official feed, homepage, and post sitemap.`,
    ],
    coverageExhausted: true,
    checkedSurfaces: [
      ETHIOPIA_INSIGHT_FEED_URL,
      ETHIOPIA_INSIGHT_HOME_URL,
      ETHIOPIA_INSIGHT_POST_SITEMAP_URL,
    ],
  };
}

interface EnaCandidate {
  url: string;
  title: string;
}

function extractEnaCandidates(html: string) {
  const $ = load(html);
  const seen = new Map<string, string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = $(element).text().replace(/\s+/g, " ").trim();

    if (!href.includes("/web/eng/w/eng_") || text.length < 16) {
      return;
    }

    const absoluteUrl = toAbsoluteUrl(ENA_HOME_URL, href);
    const existing = seen.get(absoluteUrl);

    if (!existing || text.length < existing.length) {
      seen.set(absoluteUrl, text);
    }
  });

  return [...seen.entries()]
    .slice(0, MAX_SOURCE_ITEMS)
    .map(([url, title]) => ({ url, title } satisfies EnaCandidate));
}

async function harvestEna(brief: WeeklyBrief): Promise<NotebookLmPacketDraft> {
  const html = await fetchText(ENA_HOME_URL);
  const candidates = extractEnaCandidates(html);

  const detailResults = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const detailHtml = await fetchText(candidate.url);
      const paragraphs = extractEnaArticle(detailHtml);
      const fallbackBody = extractParagraphs(detailHtml, ["p"]).join("\n\n");
      const publishedAt =
        extractEnglishDate(fallbackBody) ??
        extractSlashSeparatedPublicationDate(fallbackBody) ??
        extractEnglishDate(detailHtml) ??
        extractSlashSeparatedPublicationDate(detailHtml);
      const title =
        load(detailHtml)('meta[property="og:title"]')
          .attr("content")
          ?.replace(/\s+-\s+ENA.*$/i, "") ?? candidate.title;

      if (!publishedAt) {
        return null;
      }

      const body =
        buildPublicationBody("ENA", paragraphs, fallbackBody) || candidate.title;
      const recency = verifyNotebookLmItemRecency({
        source: "ENA",
        brief,
        title: stripHtml(title),
        body,
        publishedAt,
        url: candidate.url,
        html: detailHtml,
      });

      if (!recency.accepted) {
        return null;
      }

      return {
        title: stripHtml(title),
        url: candidate.url,
        publishedAt,
        language: "English" as const,
        section: "News",
        body,
        captureKind: "full-article" as const,
        captureNote: null,
        recencyNote: recency.note,
      };
    }),
  );

  const items = sortItemsNewestFirst(
    detailResults
      .flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      )
      .filter((item) => isWithinWindow(item.publishedAt, brief)),
  );

  return {
    source: "ENA",
    items,
    diagnostics: [`Recovered ${items.length} ENA publications in the 7-day window.`],
    coverageExhausted: true,
    checkedSurfaces: [ENA_HOME_URL],
  };
}

function extractNebeLinks(html: string) {
  const $ = load(html);
  const links: string[] = [];
  const seen = new Set<string>();

  $('a[href*="/en/node/"], a[href*="/index.php/en/node/"]').each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const absoluteUrl = toAbsoluteUrl(NEBE_ARCHIVE_URL, href);
    if (!seen.has(absoluteUrl)) {
      seen.add(absoluteUrl);
      links.push(absoluteUrl);
    }
  });

  return links.slice(0, MAX_SOURCE_ITEMS);
}

async function harvestNebe(brief: WeeklyBrief): Promise<NotebookLmPacketDraft> {
  const archiveHtml = await fetchText(NEBE_ARCHIVE_URL);
  const links = extractNebeLinks(archiveHtml);
  const detailResults = await Promise.allSettled(
    links.map(async (url) => {
      const detailHtml = await fetchText(url);
      const $ = load(detailHtml);
      const title = $("h1").first().text().trim() || $("title").text().trim();
      const fullArticleText = $("article").text().replace(/\s+/g, " ").trim();
      const fallbackBody = $("article p")
        .toArray()
        .map((element) => $(element).text())
        .join("\n\n");
      const publishedAt =
        extractLeadingDayMonthDate(fullArticleText, brief.windowEnd) ??
        extractEnglishDate(fullArticleText) ??
        extractEnglishDate(detailHtml);

      if (!publishedAt) {
        return null;
      }

      const body =
        buildPublicationBody("NEBE", extractNebeArticle(detailHtml), fallbackBody) ||
        stripHtml(title);
      const recency = verifyNotebookLmItemRecency({
        source: "NEBE",
        brief,
        title: stripHtml(title),
        body,
        publishedAt,
        url,
        html: detailHtml,
      });

      if (!recency.accepted) {
        return null;
      }

      return {
        title: stripHtml(title),
        url,
        publishedAt,
        language: "English" as const,
        section: "Election",
        body,
        captureKind: "full-article" as const,
        captureNote: null,
        recencyNote: recency.note,
      };
    }),
  );

  const items = sortItemsNewestFirst(
    detailResults
      .flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      )
      .filter((item) => isWithinWindow(item.publishedAt, brief)),
  );

  return {
    source: "NEBE",
    items,
    diagnostics: [`Recovered ${items.length} NEBE publications in the 7-day window.`],
    coverageExhausted: true,
    checkedSurfaces: [NEBE_ARCHIVE_URL],
  };
}

async function harvestVoaAmharic(
  brief: WeeklyBrief,
): Promise<NotebookLmPacketDraft> {
  const surfaces = await Promise.allSettled([
    fetchText(VOA_PODCAST_FEED_URL),
    fetchText(VOA_ONE_HOUR_ARCHIVE_URL),
    fetchPossiblyGzippedText(VOA_VIDEO_SITEMAP_URL),
  ]);
  const windowDates = buildWindowCalendarDates(brief);
  const scheduleUrls = windowDates.map(buildVoaScheduleDayUrl);
  const schedulePages = await Promise.allSettled(
    scheduleUrls.map((url) => fetchText(url)),
  );
  const checkedSurfaces = [
    VOA_PODCAST_FEED_URL,
    VOA_ONE_HOUR_ARCHIVE_URL,
    VOA_VIDEO_SITEMAP_URL,
    ...scheduleUrls,
  ];
  const diagnostics: string[] = [];
  const exactEpisodes = new Map<string, VoaPodcastFeedEpisode>();
  let currentVideoSitemapEntries: VoaVideoSitemapEntry[] = [];

  const podcastFeedResult = surfaces[0];
  if (podcastFeedResult.status === "fulfilled") {
    const podcastEpisodes = await extractVoaPodcastFeedEpisodes(
      podcastFeedResult.value,
    );

    for (const episode of podcastEpisodes) {
      const dateKey = toUtcDateKey(episode.publishedAt);
      if (!dateKey || !isWithinWindow(episode.publishedAt, brief)) {
        continue;
      }

      exactEpisodes.set(dateKey, episode);
    }

    const latestEpisode = podcastEpisodes[0];
    if (latestEpisode && !isWithinWindow(latestEpisode.publishedAt, brief)) {
      diagnostics.push(
        `VOA Amharic's official podcast feed rebuilt recently, but its latest exact archived episode is still ${formatRecencyTimestamp(latestEpisode.publishedAt)}, outside the active 7-day window.`,
      );
    }
  } else {
    diagnostics.push("VOA Amharic's official podcast feed could not be loaded.");
  }

  const archiveResult = surfaces[1];
  let latestArchiveListingDate: string | null = null;
  if (archiveResult.status === "fulfilled") {
    latestArchiveListingDate = extractVoaArchiveLatestListingDate(
      archiveResult.value,
    );

    if (latestArchiveListingDate) {
      diagnostics.push(
        `VOA Amharic's visible archive listing currently tops out at ${latestArchiveListingDate}.`,
      );
    }
  } else {
    diagnostics.push("VOA Amharic's visible archive listing could not be loaded.");
  }

  const videoSitemapResult = surfaces[2];
  if (videoSitemapResult.status === "fulfilled") {
    const sitemapEntries = extractVoaVideoSitemapEntries(videoSitemapResult.value);
    const latestVideoEntry = sitemapEntries[0] ?? null;
    currentVideoSitemapEntries = sitemapEntries.filter((entry) =>
      isWithinWindow(entry.publishedAt, brief),
    );

    if (latestVideoEntry && !isWithinWindow(latestVideoEntry.publishedAt, brief)) {
      diagnostics.push(
        `VOA Amharic's official video sitemap currently tops out at ${formatRecencyTimestamp(latestVideoEntry.publishedAt)}, outside the active 7-day window.`,
      );
    }
  } else {
    diagnostics.push("VOA Amharic's official video sitemap could not be loaded.");
  }

  const scheduleEntries = schedulePages.flatMap((result, index) => {
    if (result.status !== "fulfilled") {
      diagnostics.push(`VOA schedule page could not be loaded: ${scheduleUrls[index]}`);
      return [];
    }

    const entry = extractVoaScheduleDayEntry(result.value, scheduleUrls[index]);
    return entry ? [entry] : [];
  });

  const missingArchiveDates: string[] = [];
  for (const entry of scheduleEntries) {
    const dateKey = toUtcDateKey(entry.publishedAt);
    if (!dateKey || exactEpisodes.has(dateKey)) {
      continue;
    }

    const probeDate = new Date(entry.publishedAt);
    const probeUrl = buildVoaCanonicalAudioUrl(probeDate);
    const probe = await probeVoaAudioUrl(probeUrl);

    if (probe) {
      exactEpisodes.set(dateKey, {
        enclosureUrl: probe.url,
        publishedAt: entry.publishedAt,
        summary: normalizeBodyText(entry.summary),
        title: `${entry.title} - ${new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        }).format(probeDate)}`,
        url: entry.scheduleUrl,
      });
      continue;
    }

    missingArchiveDates.push(
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(probeDate),
    );
  }

  if (missingArchiveDates.length > 0) {
    diagnostics.push(
      `VOA schedule pages verified broadcasts for ${missingArchiveDates.join(", ")}, but VOA did not expose a matching exact archived MP3 in its official podcast feed or podcast CDN path for those dates.`,
    );
  }

  const weeklyUploadCheck = buildWeeklyUploadCheck({
    brief,
    exactEpisodes: [...exactEpisodes.values()],
    latestArchiveListingDate,
    scheduleEntries,
  });

  diagnostics.push(`Weekly upload check: ${weeklyUploadCheck.summary}`);

  const exactAudio = await enrichExactVoaAudioEpisodes(
    sortItemsNewestFirst([...exactEpisodes.values()]).slice(0, MAX_SOURCE_ITEMS),
    brief,
  );
  const exactVideo = await enrichVoaVideoSitemapEntries(
    currentVideoSitemapEntries.slice(0, MAX_SOURCE_ITEMS),
    brief,
  );
  const items = dedupePacketItems([
    ...exactAudio.items,
    ...exactVideo.items,
  ]);
  const translatedCount = exactAudio.translatedCount + exactVideo.translatedCount;

  return {
    source: "VOA Amharic",
    items,
    diagnostics: [
      ...diagnostics,
      `Recovered ${items.length} exact VOA Amharic publication${items.length === 1 ? "" : "s"} in the 7-day window after checking the official podcast feed, the visible archive listing, exact date schedule pages, and the official video sitemap.`,
      translatedCount > 0
        ? `Translated ${translatedCount} official VOA Amharic audio episodes into English transcripts for the NotebookLM packet.`
        : "No exact VOA Amharic transcript could be generated during this run.",
    ],
    coverageExhausted: true,
    checkedSurfaces: dedupeStrings(checkedSurfaces),
    weeklyUploadCheck,
  };
}

function cleanGoogleNewsTitle(rawTitle: string, source: SourceName) {
  return stripHtml(rawTitle)
    .replace(/^News:\s*/i, "")
    .replace(new RegExp(`\\s+-\\s+${source}$`, "i"), "")
    .replace(/\s+-\s+[a-z0-9.-]+\.[a-z]{2,}$/i, "")
    .trim();
}

async function resolveGoogleNewsPublisherUrls(urls: string[]) {
  if (urls.length === 0) {
    return new Map<string, string>();
  }

  const resolverPath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "scripts",
    "resolve-google-news-urls.mjs",
  );

  return new Promise<Map<string, string>>((resolve) => {
    const child = spawn(process.execPath, [resolverPath], {
      cwd: /* turbopackIgnore: true */ process.cwd(),
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

    child.on("error", () => {
      resolve(new Map(urls.map((url) => [url, url])));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(new Map(urls.map((url) => [url, url])));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as Array<{
          sourceUrl: string;
          resolvedUrl: string;
        }>;

        resolve(
          new Map(
            parsed.map((entry) => [entry.sourceUrl, entry.resolvedUrl || entry.sourceUrl]),
          ),
        );
      } catch {
        resolve(new Map(urls.map((url) => [url, url])));
      }
    });

    child.stdin.write(
      JSON.stringify({
        urls: urls.slice(0, GOOGLE_NEWS_RESOLUTION_LIMIT),
      }),
    );
    child.stdin.end();
  });
}

async function findIndexedMirrorExcerpt(
  title: string,
  source: SourceName,
) {
  const query = `"${title}" "${source}"`;

  try {
    const xml = await fetchText(
      `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
      {
        retries: 0,
        timeoutMs: 12_000,
      },
    );
    const feed = await parseRssFeed(xml);
    const normalizedTitle = title.toLowerCase();

    for (const item of feed.items ?? []) {
      const candidateTitle = stripHtml(item.title ?? "");
      const candidateSnippet = normalizeBodyText(
        item.contentSnippet ?? item.content ?? "",
      );
      const combined = `${candidateTitle} ${candidateSnippet}`.toLowerCase();
      const href = item.link ?? "";

      if (!combined.includes(normalizedTitle.slice(0, Math.min(normalizedTitle.length, 48)))) {
        continue;
      }

      if (!/addisstandard|twitter\.com|x\.com|facebook\.com/i.test(href)) {
        continue;
      }

      return {
        body: limitBodyLength(candidateSnippet || candidateTitle),
        href,
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function harvestAddisStandard(
  brief: WeeklyBrief,
): Promise<NotebookLmPacketDraft> {
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
    ADDIS_STANDARD_QUERY,
  )}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchText(feedUrl);
  const feed = await parseRssFeed(xml);
  const weeklyItems = (feed.items ?? [])
    .map((item) => ({
      title: cleanGoogleNewsTitle(item.title ?? "", "Addis Standard"),
      url: item.link ?? "",
      publishedAt: item.pubDate
        ? new Date(item.pubDate).toISOString()
        : "",
      language: "English" as const,
      section: "News",
      body: "",
      captureKind: "headline-record" as const,
      captureNote: null as string | null,
    }))
    .filter((item) => {
      if (!item.title || !item.url || !isWithinWindow(item.publishedAt, brief)) {
        return false;
      }

      return !/archives$/i.test(item.title);
    })
    .slice(0, MAX_SOURCE_ITEMS);

  const resolvedUrls = await resolveGoogleNewsPublisherUrls(
    weeklyItems.map((item) => item.url ?? "").filter(Boolean),
  );

  const items = await Promise.all(
    weeklyItems.map(async (item, index) => {
      const resolvedUrl = item.url ? resolvedUrls.get(item.url) ?? item.url : item.url;
      const indexedMirror =
        index < ADDIS_STANDARD_MIRROR_LOOKUP_LIMIT
          ? await findIndexedMirrorExcerpt(item.title, "Addis Standard")
          : null;
      const isStructuralUrl =
        resolvedUrl !== null &&
        /\/(tag|category|author)\//i.test(resolvedUrl);

      if (isStructuralUrl) {
        return null;
      }

      return {
        ...item,
        url: resolvedUrl,
        body:
          indexedMirror?.body ||
          `${item.title}\n\nExact publisher post identified, but the publisher currently blocks automated article-body retrieval.`,
        captureKind: indexedMirror ? "mirror-excerpt" : "headline-record",
        captureNote: indexedMirror
          ? `Recovered an indexed excerpt that matches the exact Addis Standard post after resolving the publisher URL (${indexedMirror.href}).`
          : "Exact Addis Standard post URL was resolved from Google News, but the publisher blocks automated full-text access. The headline record is still included so NotebookLM sees the publication in the weekly timeline.",
      } satisfies NotebookLmPacketItem;
    }),
  );

  const filteredItems = items.flatMap((item) => (item ? [item] : []));

  return {
    source: "Addis Standard",
    items: sortItemsNewestFirst(filteredItems),
    diagnostics: [
      `Recovered ${filteredItems.length} Addis Standard publications from Google News indexing in the 7-day window.`,
      "Each item is resolved back to the publisher URL before packet upload.",
    ],
    coverageExhausted: true,
    checkedSurfaces: [feedUrl, "https://www.bing.com/search?format=rss"],
  };
}

function createEmptyPacket(source: SourceName, diagnostics: string[]) {
  return {
    source,
    items: [],
    diagnostics,
    coverageExhausted: false,
    checkedSurfaces: [],
    weeklySourceCheck: null,
    weeklyUploadCheck: null,
  } satisfies NotebookLmPacketDraft;
}

async function harvestSourceWindow(
  source: SourceName,
  brief: WeeklyBrief,
): Promise<NotebookLmPacketDraft> {
  switch (source) {
    case "Addis Standard":
      return harvestAddisStandard(brief);
    case "The Reporter Ethiopia":
      return harvestReporter(brief);
    case "Ethiopia Insight":
      return harvestEthiopiaInsight(brief);
    case "ENA":
      return harvestEna(brief);
    case "NEBE":
      return harvestNebe(brief);
    case "VOA Amharic":
      return harvestVoaAmharic(brief);
    default:
      return createEmptyPacket(source, [`No NotebookLM harvester is configured for ${source}.`]);
  }
}

export async function buildNotebookLmSourcePackets(
  brief: WeeklyBrief,
  sourceResults: SourceFetchResult[],
) {
  const fallbackItems = buildFallbackItems(sourceResults, brief);
  const [harvests, socialDrafts] = await Promise.all([
    Promise.allSettled(SOURCE_NAMES.map((source) => harvestSourceWindow(source, brief))),
    harvestOfficialSocialSupplements(brief),
  ]);
  const socialBySource = new Map(
    socialDrafts.map((draft) => [
      draft.source,
      {
        items: draft.items.map((item) => ({
          ...item,
          captureKind: "social-post" as const,
          captureNote: item.captureNote,
        })),
        diagnostics: draft.diagnostics,
        checkedSurfaces: draft.checkedSurfaces,
      },
    ]),
  );

  return Promise.all(SOURCE_NAMES.map(async (source, index) => {
    const result = harvests[index];
    const fallback = sortItemsNewestFirst(fallbackItems.get(source) ?? []);
    const social = socialBySource.get(source);
    const combinedCheckedSurfaces = dedupeStrings([
      ...(result.status === "fulfilled" ? (result.value.checkedSurfaces ?? []) : []),
      ...(social?.checkedSurfaces ?? []),
    ]);

    if (result.status === "fulfilled" && result.value.items.length > 0) {
      const mergedItems = await refinePacketItemsForNotebookLm(
        brief,
        source,
        dedupePacketItems([
          ...result.value.items,
          ...(social?.items ?? []),
        ]),
      );

      return applyStrictRecencyVerification(brief, {
        source,
        items: mergedItems,
        diagnostics: [...result.value.diagnostics, ...(social?.diagnostics ?? [])],
        coverageExhausted: result.value.coverageExhausted ?? false,
        checkedSurfaces: combinedCheckedSurfaces,
        weeklySourceCheck: buildWeeklySourceCheck({
          source,
          brief,
          items: mergedItems,
          checkedSurfaces: combinedCheckedSurfaces,
          coverageExhausted: result.value.coverageExhausted ?? false,
        }),
        weeklyUploadCheck: result.value.weeklyUploadCheck ?? null,
      } satisfies NotebookLmPacketDraft);
    }

    if (result.status === "fulfilled") {
      const mergedItems = await refinePacketItemsForNotebookLm(
        brief,
        source,
        dedupePacketItems([
          ...(result.value.items ?? []),
          ...(social?.items ?? []),
          ...fallback,
        ]),
      );

      return applyStrictRecencyVerification(brief, {
        source,
        items: mergedItems,
        diagnostics: [
          ...result.value.diagnostics,
          ...(social?.diagnostics ?? []),
          fallback.length > 0
            ? "Fell back to the dashboard record because no richer 7-day source texts were recovered for this source."
            : "No source items were available in the current 7-day window.",
        ],
        coverageExhausted: result.value.coverageExhausted ?? false,
        checkedSurfaces: combinedCheckedSurfaces,
        weeklySourceCheck: buildWeeklySourceCheck({
          source,
          brief,
          items: mergedItems,
          checkedSurfaces: combinedCheckedSurfaces,
          coverageExhausted: result.value.coverageExhausted ?? false,
        }),
        weeklyUploadCheck: result.value.weeklyUploadCheck ?? null,
      } satisfies NotebookLmPacketDraft);
    }

    const mergedItems = await refinePacketItemsForNotebookLm(
      brief,
      source,
      dedupePacketItems([...(social?.items ?? []), ...fallback]),
    );

    return applyStrictRecencyVerification(brief, {
      source,
      items: mergedItems,
      diagnostics: [
        result.reason instanceof Error
          ? result.reason.message
          : "The source-specific NotebookLM harvester failed.",
        ...(social?.diagnostics ?? []),
        fallback.length > 0
          ? "Using dashboard snippet fallback for this source."
          : "No source items were available in the current 7-day window.",
      ],
      coverageExhausted: false,
      checkedSurfaces: dedupeStrings(social?.checkedSurfaces ?? []),
      weeklySourceCheck: buildWeeklySourceCheck({
        source,
        brief,
        items: mergedItems,
        checkedSurfaces: dedupeStrings(social?.checkedSurfaces ?? []),
        coverageExhausted: false,
      }),
      weeklyUploadCheck: null,
    } satisfies NotebookLmPacketDraft);
  }));
}
