import { spawn } from "node:child_process";
import path from "node:path";

import { load } from "cheerio";

import type { LanguageLabel, SourceName, WeeklyBrief } from "@/lib/dashboard";
import {
  ADDIS_STANDARD_OFFICIAL_FACEBOOK_PAGES,
  ADDIS_STANDARD_OFFICIAL_TELEGRAM_CHANNELS,
} from "@/lib/addis-standard-official-platforms";
import { fetchText } from "@/lib/news/http";
import { parseRssFeed } from "@/lib/news/sources/helpers";
import { stripHtml, truncate } from "@/lib/news/text";

export interface NotebookLmSocialItem {
  title: string;
  url: string;
  publishedAt: string;
  language: LanguageLabel;
  section: string;
  body: string;
  captureNote: string;
}

export interface NotebookLmSocialDraft {
  source: SourceName;
  items: NotebookLmSocialItem[];
  diagnostics: string[];
  checkedSurfaces: string[];
}

interface TelegramProfileConfig {
  previewUrl: string;
  label: string;
  language: LanguageLabel;
}

interface FacebookProfileConfig {
  profileUrl: string;
  label: string;
  language: LanguageLabel;
}

interface XProfileConfig {
  profileUrl: string;
  label: string;
  language: LanguageLabel;
}

interface YouTubeProfileConfig {
  feedUrl: string;
  channelUrl: string;
  label: string;
  language: LanguageLabel;
}

interface InstagramProfileConfig {
  profileUrl: string;
  username: string;
  label: string;
  language: LanguageLabel;
}

interface YouTubeChannelCandidate {
  description: string;
  title: string;
  upcomingAt: string | null;
  url: string;
  videoId: string;
}

interface InstagramTimelineResponseItem {
  accessibility_caption?: string | null;
  caption?: {
    text?: string | null;
  } | null;
  code?: string | null;
  taken_at?: number | null;
}

const OFFICIAL_TELEGRAM_PROFILES: Partial<Record<SourceName, TelegramProfileConfig>> = {
  "The Reporter Ethiopia": {
    previewUrl: "https://t.me/s/TheReporterET",
    label: "Official Telegram channel",
    language: "English",
  },
  "Ethiopia Insight": {
    previewUrl: "https://t.me/s/ethiopiainsight",
    label: "Official Telegram channel",
    language: "English",
  },
  ENA: {
    previewUrl: "https://t.me/s/EthiopianNewsA",
    label: "Official Telegram channel",
    language: "Amharic",
  },
  NEBE: {
    previewUrl: "https://t.me/s/NationalElectionBoardNEBE",
    label: "Official Telegram channel",
    language: "Amharic",
  },
};

const OFFICIAL_X_PROFILES: Partial<Record<SourceName, XProfileConfig>> = {
  "Addis Standard": {
    profileUrl: "https://x.com/addisstandard",
    label: "Official X account",
    language: "English",
  },
  "The Reporter Ethiopia": {
    profileUrl: "https://x.com/TheReporterET",
    label: "Official X account",
    language: "English",
  },
  "Ethiopia Insight": {
    profileUrl: "https://x.com/EthiopiaInsight",
    label: "Official X account",
    language: "English",
  },
  ENA: {
    profileUrl: "https://x.com/EthiopianNewsA",
    label: "Official X account",
    language: "English",
  },
  NEBE: {
    profileUrl: "https://x.com/NEBEthiopia",
    label: "Official X account",
    language: "English",
  },
};

const OFFICIAL_YOUTUBE_PROFILES: Partial<
  Record<SourceName, YouTubeProfileConfig>
> = {
  "Ethiopia Insight": {
    feedUrl:
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCCScI0j_tKTcZ4fMmmOUmNw",
    channelUrl: "https://www.youtube.com/channel/UCCScI0j_tKTcZ4fMmmOUmNw",
    label: "Official YouTube channel",
    language: "English",
  },
  "VOA Amharic": {
    feedUrl:
      "https://www.youtube.com/feeds/videos.xml?channel_id=UC5OePohJjdkd0Uwm3r1cThA",
    channelUrl: "https://www.youtube.com/@voaamharic",
    label: "Official YouTube channel",
    language: "Amharic",
  },
};

const OFFICIAL_INSTAGRAM_PROFILES: Partial<
  Record<SourceName, InstagramProfileConfig>
> = {
  "VOA Amharic": {
    profileUrl: "https://www.instagram.com/voaamharic/",
    username: "voaamharic",
    label: "Official Instagram account",
    language: "Amharic",
  },
};

const MAX_SOCIAL_POSTS_PER_SOURCE = 12;
const MAX_SOCIAL_POST_BODY_LENGTH = 2_800;
const MAX_YOUTUBE_WATCH_PAGE_CHECKS = 12;
const INSTAGRAM_TIMELINE_COUNT = 24;
const SOCIAL_PROMO_URL_PATTERN =
  /https?:\/\/(?:play\.google\.com|apps\.apple\.com|(?:www\.)?mirchaye\.portal\.nebe\.org\.et|(?:www\.)?url-shortener\.me)\/\S*/gi;
const SOCIAL_URL_PATTERN = /https?:\/\/\S+/gi;
const SOURCE_SPECIFIC_SOCIAL_PROMO_PATTERNS: Partial<
  Record<SourceName, RegExp[]>
> = {
  "Addis Standard": [/\bsponsored[_ -]?post\b/i, /\badvertorial\b/i],
  ENA: [
    /\bethiopiadelivers\b/i,
    /\bpmoethiopia\b/i,
    /new horizon of hope/i,
    /transformed by the change/i,
    /gifts of megabit/i,
  ],
  NEBE: [
    /\bmirchaye\b/i,
    /\bplay store\b/i,
    /\bapp store\b/i,
    /register yourself as a voter/i,
    /my election for (?:android|app store|website)/i,
    /my vote for (?:android|the app store|the website)/i,
  ],
};

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

function normalizeSocialText(text: string) {
  return stripHtml(String(text ?? "").normalize("NFKC"))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeSocialHashtag(token: string) {
  return token
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceSocialHashtagsWithWords(text: string) {
  return text.replace(
    /(^|\s)#([\p{L}\p{N}_-]+)/gu,
    (_match, prefix: string, token: string) =>
      `${prefix}${humanizeSocialHashtag(token)}`,
  );
}

function formatSocialReadableText(text: string, options?: { stripUrls?: boolean }) {
  const normalized = normalizeSocialText(text);
  const withoutUrls = options?.stripUrls
    ? normalized.replace(SOCIAL_URL_PATTERN, " ")
    : normalized;

  return stripSocialReadMoreTail(
    replaceSocialHashtagsWithWords(
      withoutUrls
        .replace(/(?<=[\p{L}\p{N}])#(?=[\p{L}\p{N}_-])/gu, " #")
        .replace(/(?<=[\p{Ll}])(?=[A-Z][a-z]{2,})/gu, " ")
        .replace(/(?<=[\p{Ll}])(?=#)/gu, " ")
        .replace(/(?<=[\p{L}\p{N}])(?=#)/gu, " ")
        .replace(/[â€¢â—]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );
}

function stripSocialReadMoreTail(text: string) {
  return text
    .replace(/\bRead more:\s*https?:\/\/\S+/gi, " ")
    .replace(/\bRead more:\s*$/gi, " ")
    .replace(/\bRead [^.:\n]{0,80}coverage:\s*https?:\/\/\S+/gi, " ")
    .replace(/\bRead full coverage:\s*https?:\/\/\S+/gi, " ")
    .replace(/\bRead the full story:\s*https?:\/\/\S+/gi, " ")
    .replace(/\bRead the full report:\s*https?:\/\/\S+/gi, " ")
    .replace(/\s*https?:\/\/\S+\s*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limitSocialBody(text: string) {
  const normalized = normalizeSocialText(text);

  if (normalized.length <= MAX_SOCIAL_POST_BODY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SOCIAL_POST_BODY_LENGTH - 3).trimEnd()}...`;
}

function stripTrailingPromoSegment(source: SourceName, text: string) {
  if (source !== "NEBE") {
    return text;
  }

  const markerMatch = text.match(
    /(play\.google\.com|apps\.apple\.com|mirchaye|url-shortener\.me|app store|play store|register yourself as a voter|my election for android|my vote for android)/i,
  );

  if (!markerMatch?.index || markerMatch.index <= 0) {
    return text;
  }

  return text.slice(0, markerMatch.index).trim();
}

export function sanitizeOfficialSocialItem(args: {
  source: SourceName;
  title: string;
  body: string;
}) {
  const normalizedTitle = formatSocialReadableText(args.title, {
    stripUrls: true,
  });
  const originalBody = normalizeSocialText(args.body);
  const rawCombined = `${normalizedTitle} ${originalBody}`.trim();
  const sourcePromoPatterns =
    SOURCE_SPECIFIC_SOCIAL_PROMO_PATTERNS[args.source] ?? [];
  const bodyWithoutPromoUrls = originalBody.replace(SOCIAL_PROMO_URL_PATTERN, " ");
  const cleanedBody = limitSocialBody(
    formatSocialReadableText(
      stripTrailingPromoSegment(args.source, bodyWithoutPromoUrls),
      {
        stripUrls: true,
      },
    ),
  );
  const combined = `${normalizedTitle} ${cleanedBody}`.trim();

  if (
    !combined ||
    /\bsponsored[_ -]?post\b/i.test(rawCombined) ||
    /\badvertorial\b/i.test(rawCombined) ||
    /\bsponsored[_ -]?post\b/i.test(combined) ||
    /\badvertorial\b/i.test(combined) ||
    sourcePromoPatterns.some((pattern) => pattern.test(combined))
  ) {
    return null;
  }

  if (
    cleanedBody.length < 120 &&
    cleanedBody.toLowerCase() === normalizedTitle.toLowerCase()
  ) {
    return null;
  }

  if (cleanedBody.length < 48) {
    return null;
  }

  return {
    title: truncate(normalizedTitle || cleanedBody || "Official social update", 180),
    body: cleanedBody,
  };
}

function buildTelegramBody(
  messageText: string,
  previewTitle: string,
  previewDescription: string,
) {
  const parts = [messageText, previewTitle, previewDescription]
    .map((part) => formatSocialReadableText(part, { stripUrls: true }))
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(part);
  }

  return limitSocialBody(unique.join("\n\n"));
}

function buildTelegramTitle(messageText: string, previewTitle: string) {
  const cleanedPreviewTitle = formatSocialReadableText(previewTitle, {
    stripUrls: true,
  });
  const cleanedMessageText = formatSocialReadableText(messageText, {
    stripUrls: true,
  });

  if (cleanedPreviewTitle.length > 0) {
    return truncate(cleanedPreviewTitle, 180);
  }

  return truncate(cleanedMessageText || "Official social update", 180);
}

function dedupeCheckedSurfaces(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function sortSocialItemsNewestFirst(items: NotebookLmSocialItem[]) {
  return items.slice().sort((left, right) => {
    return (
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
    );
  });
}

function dedupeSocialItems(items: NotebookLmSocialItem[]) {
  const seen = new Set<string>();
  const deduped: NotebookLmSocialItem[] = [];

  for (const item of sortSocialItemsNewestFirst(items)) {
    const key = `${item.url}|${item.publishedAt}|${item.title.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function buildSocialFailureDraft(
  source: SourceName,
  label: string,
  surfaces: string[],
  reason: unknown,
) {
  return {
    source,
    items: [],
    diagnostics: [
      `${label}: social supplement could not be recovered automatically.`,
      reason instanceof Error ? reason.message : "Unknown social harvest failure.",
    ],
    checkedSurfaces: dedupeCheckedSurfaces(surfaces),
  } satisfies NotebookLmSocialDraft;
}

function mergeSocialDrafts(current: NotebookLmSocialDraft | undefined, next: NotebookLmSocialDraft) {
  if (!current) {
    return {
      ...next,
      items: dedupeSocialItems(next.items),
      checkedSurfaces: dedupeCheckedSurfaces(next.checkedSurfaces),
    } satisfies NotebookLmSocialDraft;
  }

  return {
    source: next.source,
    items: dedupeSocialItems([...current.items, ...next.items]),
    diagnostics: [...current.diagnostics, ...next.diagnostics],
    checkedSurfaces: dedupeCheckedSurfaces([
      ...current.checkedSurfaces,
      ...next.checkedSurfaces,
    ]),
  } satisfies NotebookLmSocialDraft;
}

function normalizeIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const timestamp = new Date(normalized);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toISOString();
}

function formatUtcDate(value: string) {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(timestamp);
}

function describeLatestVisibleTimestamp(value: string | null) {
  return value ? formatUtcDate(value) : "no exact dated public post";
}

function extractYouTubeInitialData(html: string) {
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = '];

  for (const marker of markers) {
    const startIndex = html.indexOf(marker);
    if (startIndex < 0) {
      continue;
    }

    const jsonStart = startIndex + marker.length;
    const jsonEnd = html.indexOf(";</script>", jsonStart);
    if (jsonEnd < 0) {
      continue;
    }

    try {
      return JSON.parse(html.slice(jsonStart, jsonEnd)) as unknown;
    } catch {
      continue;
    }
  }

  return null;
}

function readYouTubeText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const simpleText =
    typeof record.simpleText === "string" ? record.simpleText : "";
  if (simpleText) {
    return simpleText;
  }

  if (!Array.isArray(record.runs)) {
    return "";
  }

  return record.runs
    .map((run) =>
      run && typeof run === "object" && typeof (run as { text?: unknown }).text === "string"
        ? (run as { text: string }).text
        : "",
    )
    .join("")
    .trim();
}

function collectYouTubeVideoRenderers(value: unknown, renderers: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectYouTubeVideoRenderers(item, renderers));
    return renderers;
  }

  if (!value || typeof value !== "object") {
    return renderers;
  }

  const record = value as Record<string, unknown>;
  const renderer = record.videoRenderer;
  if (renderer && typeof renderer === "object") {
    renderers.push(renderer as Record<string, unknown>);
  }

  Object.values(record).forEach((item) => collectYouTubeVideoRenderers(item, renderers));
  return renderers;
}

function extractYouTubeChannelCandidates(html: string) {
  const initialData = extractYouTubeInitialData(html);
  const renderers = collectYouTubeVideoRenderers(initialData);
  const candidates = new Map<string, YouTubeChannelCandidate>();

  for (const renderer of renderers) {
    const videoId =
      typeof renderer.videoId === "string" ? renderer.videoId : "";
    if (!videoId) {
      continue;
    }

    const title = normalizeSocialText(readYouTubeText(renderer.title));
    if (!title) {
      continue;
    }

    const description = normalizeSocialText(
      readYouTubeText(renderer.descriptionSnippet),
    );
    const upcomingRaw =
      renderer.upcomingEventData &&
      typeof renderer.upcomingEventData === "object" &&
      typeof (renderer.upcomingEventData as { startTime?: unknown }).startTime ===
        "string"
        ? (renderer.upcomingEventData as { startTime: string }).startTime
        : "";
    const upcomingAt = upcomingRaw
      ? new Date(Number(upcomingRaw) * 1000).toISOString()
      : null;
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    candidates.set(url, {
      description,
      title,
      upcomingAt,
      url,
      videoId,
    });
  }

  return [...candidates.values()];
}

function extractExactYouTubeWatchPublishedAt(html: string) {
  const candidates = [
    html.match(/"publishDate":"([^"]+)"/)?.[1] ?? null,
    html.match(/"uploadDate":"([^"]+)"/)?.[1] ?? null,
    html.match(/"startTimestamp":"([^"]+)"/)?.[1] ?? null,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeIsoTimestamp(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractYouTubeWatchDescription(html: string) {
  const shortDescription = html.match(/"shortDescription":"((?:\\.|[^"])*)"/)?.[1];
  if (!shortDescription) {
    return "";
  }

  return normalizeSocialText(
    shortDescription
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\"),
  );
}

function extractInstagramConfig(html: string) {
  const appId =
    html.match(/"X-IG-App-ID":"(\d+)"/)?.[1] ??
    html.match(/"appId":(\d+)/)?.[1] ??
    "";
  const csrfToken = html.match(/"csrf_token":"([^"]+)"/)?.[1] ?? "";

  return {
    appId,
    csrfToken,
  };
}

export function extractInstagramTimelineItems(json: string, profileUrl: string) {
  const parsed = JSON.parse(json) as {
    items?: InstagramTimelineResponseItem[];
  };

  return (parsed.items ?? [])
    .map((item) => {
      const publishedAt =
        typeof item.taken_at === "number"
          ? new Date(item.taken_at * 1000).toISOString()
          : "";
      const body = limitSocialBody(item.caption?.text ?? "");
      const title = truncate(
        normalizeSocialText(
          item.accessibility_caption ??
            item.caption?.text?.split("\n")[0] ??
            "Official Instagram update",
        ),
        180,
      );

      return {
        body,
        publishedAt,
        title,
        url: item.code ? `https://www.instagram.com/p/${item.code}/` : profileUrl,
      };
    })
    .filter((item) => item.publishedAt && item.title);
}

async function collectOfficialTelegramSupplements(
  brief: WeeklyBrief,
  profiles: Array<[SourceName, TelegramProfileConfig]>,
) {
  const results = await Promise.allSettled(
    profiles.map(async ([source, profile]) => {
      const html = await fetchText(profile.previewUrl, {
        retries: 0,
        timeoutMs: 12_000,
      });
      const $ = load(html);
      const items: NotebookLmSocialItem[] = [];

      $(".tgme_widget_message_wrap").each((_, element) => {
        const timeValue = $(element).find("time").attr("datetime");
        if (!timeValue || !isWithinWindow(timeValue, brief)) {
          return;
        }

        const messageText = $(element).find(".tgme_widget_message_text").text();
        const previewTitle = $(element).find(".link_preview_title").text();
        const previewDescription = $(element)
          .find(".link_preview_description")
          .text();
        const body = buildTelegramBody(
          messageText,
          previewTitle,
          previewDescription,
        );
        const linkedPublicationUrl =
          $(element)
            .find('.tgme_widget_message_text a[href^="http"], .link_preview a[href^="http"]')
            .toArray()
            .map((link) => $(link).attr("href") ?? "")
            .find((href) => /^https?:\/\//i.test(href) && !/https?:\/\/t\.me\//i.test(href)) ??
          null;
        const sanitized = sanitizeOfficialSocialItem({
          source,
          title: buildTelegramTitle(messageText, previewTitle),
          body,
        });

        if (!sanitized) {
          return;
        }

        const postUrl =
          $(element).find(".tgme_widget_message_date").attr("href") ??
          profile.previewUrl;

        items.push({
          title: sanitized.title,
          url: postUrl,
          publishedAt: new Date(timeValue).toISOString(),
          language: profile.language,
          section: "Official social",
          body: sanitized.body,
          captureNote: linkedPublicationUrl
            ? `${profile.label} post linking to the outlet publication at ${linkedPublicationUrl}.`
            : `${profile.label} post.`,
        });
      });

      const newestFirst = sortSocialItemsNewestFirst(items).slice(
        0,
        MAX_SOCIAL_POSTS_PER_SOURCE,
      );

      return {
        source,
        items: newestFirst,
        diagnostics: [
          `${profile.label}: recovered ${newestFirst.length} posts from ${profile.previewUrl}.`,
        ],
        checkedSurfaces: [profile.previewUrl],
      } satisfies NotebookLmSocialDraft;
    }),
  );

  return results.map((result, index) => {
    const [source, profile] = profiles[index];

    if (result.status === "fulfilled") {
      return result.value;
    }

    return buildSocialFailureDraft(
      source,
      profile.label,
      [profile.previewUrl],
      result.reason,
    );
  });
}

async function collectOfficialYouTubeSupplements(
  brief: WeeklyBrief,
  profiles: Array<[SourceName, YouTubeProfileConfig]>,
) {
  const results = await Promise.allSettled(
    profiles.map(async ([source, profile]) => {
      const checkedSurfaces = [profile.feedUrl];
      const xml = await fetchText(profile.feedUrl, {
        retries: 0,
        timeoutMs: 12_000,
      });
      const feed = await parseRssFeed(xml);
      const feedItems = dedupeSocialItems(
        (feed.items ?? [])
          .map((item) => {
            const sanitized = sanitizeOfficialSocialItem({
              source,
              title: normalizeSocialText(item.title ?? "Official video"),
              body: item.contentSnippet ?? item.content ?? item.title ?? "",
            });

            if (!sanitized) {
              return null;
            }

            return {
              title: sanitized.title,
              url: item.link ?? profile.feedUrl,
              publishedAt: item.pubDate
                ? new Date(item.pubDate).toISOString()
                : "",
              language: profile.language,
              section: "Official social",
              body: sanitized.body,
              captureNote: `${profile.label} post.`,
            } satisfies NotebookLmSocialItem;
          })
          .filter((item): item is NotebookLmSocialItem => Boolean(item))
          .filter(
            (item) =>
              item.url &&
              item.publishedAt &&
              item.body.length > 0 &&
              isWithinWindow(item.publishedAt, brief),
          ),
      );
      const diagnostics = [
        `${profile.label}: recovered ${feedItems.length} posts from ${profile.feedUrl}.`,
      ];

      if (feedItems.length > 0) {
        return {
          source,
          items: feedItems,
          diagnostics,
          checkedSurfaces,
        } satisfies NotebookLmSocialDraft;
      }

      const fallback = await collectOfficialYouTubeChannelFallback(brief, profile);
      return {
        source,
        items: fallback.items,
        diagnostics: [...diagnostics, ...fallback.diagnostics],
        checkedSurfaces: dedupeCheckedSurfaces([
          ...checkedSurfaces,
          ...fallback.checkedSurfaces,
        ]),
      } satisfies NotebookLmSocialDraft;
    }),
  );

  return results.map((result, index) => {
    const [source, profile] = profiles[index];

    if (result.status === "fulfilled") {
      return result.value;
    }

    return buildSocialFailureDraft(
      source,
      profile.label,
      [profile.feedUrl, `${profile.channelUrl}/videos`, `${profile.channelUrl}/streams`],
      result.reason,
    );
  });
}

async function collectOfficialYouTubeChannelFallback(
  brief: WeeklyBrief,
  profile: YouTubeProfileConfig,
) {
  const videosUrl = `${profile.channelUrl}/videos`;
  const streamsUrl = `${profile.channelUrl}/streams`;
  const checkedSurfaces = [videosUrl, streamsUrl];
  const [videosHtml, streamsHtml] = await Promise.all([
    fetchText(videosUrl, {
      retries: 0,
      timeoutMs: 15_000,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      },
    }),
    fetchText(streamsUrl, {
      retries: 0,
      timeoutMs: 15_000,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      },
    }),
  ]);
  const candidates = dedupeCheckedSurfaces([
    ...extractYouTubeChannelCandidates(videosHtml).map((item) => JSON.stringify(item)),
    ...extractYouTubeChannelCandidates(streamsHtml).map((item) => JSON.stringify(item)),
  ]).map((item) => JSON.parse(item) as YouTubeChannelCandidate);
  const items: NotebookLmSocialItem[] = [];
  const upcomingDates: string[] = [];
  let latestVisiblePublishedAt: string | null = null;

  for (const candidate of candidates.slice(0, MAX_YOUTUBE_WATCH_PAGE_CHECKS)) {
    const watchHtml = await fetchText(candidate.url, {
      retries: 0,
      timeoutMs: 15_000,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      },
    });
    checkedSurfaces.push(candidate.url);

    const exactPublishedAt =
      extractExactYouTubeWatchPublishedAt(watchHtml) ?? candidate.upcomingAt;
    if (!exactPublishedAt) {
      continue;
    }

    if (
      !latestVisiblePublishedAt ||
      new Date(exactPublishedAt).getTime() > new Date(latestVisiblePublishedAt).getTime()
    ) {
      latestVisiblePublishedAt = exactPublishedAt;
    }

    const body =
      limitSocialBody(extractYouTubeWatchDescription(watchHtml)) ||
      limitSocialBody(candidate.description) ||
      candidate.title;

    if (candidate.upcomingAt && candidate.upcomingAt === exactPublishedAt) {
      if (isWithinWindow(exactPublishedAt, brief)) {
        upcomingDates.push(formatUtcDate(exactPublishedAt));
      }
      continue;
    }

    if (!isWithinWindow(exactPublishedAt, brief)) {
      continue;
    }

    const sanitized = sanitizeOfficialSocialItem({
      source: "VOA Amharic",
      title: candidate.title,
      body,
    });

    if (!sanitized) {
      continue;
    }

    items.push({
      title: sanitized.title,
      url: candidate.url,
      publishedAt: exactPublishedAt,
      language: profile.language,
      section: "Official social",
      body: sanitized.body,
      captureNote: `${profile.label} post.`,
    });
  }

  const diagnostics = [
    items.length > 0
      ? `${profile.label}: recovered ${items.length} exact dated posts from the public channel pages.`
      : `${profile.label}: the RSS feed had no in-window posts, and the public channel pages did not expose an exact dated in-window archived post. Latest visible exact date was ${describeLatestVisibleTimestamp(latestVisiblePublishedAt)}.`,
  ];

  if (upcomingDates.length > 0) {
    diagnostics.push(
      `${profile.label}: public channel pages did show upcoming scheduled stream posts for ${upcomingDates.join(", ")}.`,
    );
  }

  return {
    items: dedupeSocialItems(items),
    diagnostics,
    checkedSurfaces: dedupeCheckedSurfaces(checkedSurfaces),
  };
}

async function collectOfficialInstagramSupplements(
  brief: WeeklyBrief,
  profiles: Array<[SourceName, InstagramProfileConfig]>,
) {
  const results = await Promise.allSettled(
    profiles.map(async ([source, profile]) => {
      const profileHtml = await fetchText(profile.profileUrl, {
        retries: 0,
        timeoutMs: 15_000,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        },
      });
      const instagram = extractInstagramConfig(profileHtml);
      const apiUrl = `https://www.instagram.com/api/v1/feed/user/${profile.username}/username/?count=${INSTAGRAM_TIMELINE_COUNT}`;
      const json = await fetchText(apiUrl, {
        retries: 0,
        timeoutMs: 15_000,
        headers: {
          accept: "*/*",
          referer: profile.profileUrl,
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          "x-csrftoken": instagram.csrfToken,
          "x-ig-app-id": instagram.appId,
          "x-requested-with": "XMLHttpRequest",
        },
      });
      const timelineItems = extractInstagramTimelineItems(json, profile.profileUrl);
      const items = timelineItems
        .map((item) => {
          const sanitized = sanitizeOfficialSocialItem({
            source,
            title: item.title,
            body: item.body || item.title,
          });

          if (!sanitized) {
            return null;
          }

          return {
            title: sanitized.title,
            url: item.url,
            publishedAt: item.publishedAt,
            language: profile.language,
            section: "Official social",
            body: sanitized.body,
            captureNote: `${profile.label} post.`,
          } satisfies NotebookLmSocialItem;
        })
        .filter((item): item is NotebookLmSocialItem => Boolean(item))
        .filter((item) => isWithinWindow(item.publishedAt, brief))
        .slice(0, MAX_SOCIAL_POSTS_PER_SOURCE);
      const latestVisiblePublishedAt = timelineItems[0]?.publishedAt ?? null;

      return {
        source,
        items,
        diagnostics: [
          items.length > 0
            ? `${profile.label}: recovered ${items.length} exact dated posts from the public profile timeline.`
            : `${profile.label}: the public profile timeline exposed no in-window posts. Latest visible exact date was ${describeLatestVisibleTimestamp(latestVisiblePublishedAt)}.`,
        ],
        checkedSurfaces: [profile.profileUrl, apiUrl],
      } satisfies NotebookLmSocialDraft;
    }),
  );

  return results.map((result, index) => {
    const [source, profile] = profiles[index];

    if (result.status === "fulfilled") {
      return result.value;
    }

    return buildSocialFailureDraft(
      source,
      profile.label,
      [profile.profileUrl],
      result.reason,
    );
  });
}

async function collectOfficialFacebookSupplements(
  brief: WeeklyBrief,
  profiles: Array<[SourceName, FacebookProfileConfig]>,
) {
  if (profiles.length === 0) {
    return [] as NotebookLmSocialDraft[];
  }

  const collectorPath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "scripts",
    "collect-facebook-posts.mjs",
  );

  return new Promise<NotebookLmSocialDraft[]>((resolve) => {
    const child = spawn(process.execPath, [collectorPath], {
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
      resolve(
        profiles.map(([source, profile]) =>
          buildSocialFailureDraft(source, profile.label, [profile.profileUrl], null),
        ),
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(
          profiles.map(([source, profile]) =>
            buildSocialFailureDraft(source, profile.label, [profile.profileUrl], null),
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as Array<{
          source: SourceName;
          posts: Array<{
            body: string;
            externalUrls?: string[];
            publishedAt: string;
            url: string;
          }>;
        }>;

        resolve(
          profiles.map(([source, profile]) => {
            const entry = parsed.find((item) => item.source === source);
            const items = dedupeSocialItems(
              (entry?.posts ?? [])
                .filter((post) => normalizeSocialText(post.body).length > 0)
                .map((post) => {
                  const sanitized = sanitizeOfficialSocialItem({
                    source,
                    title: normalizeSocialText(post.body),
                    body: post.body,
                  });

                  if (!sanitized) {
                    return null;
                  }

                  const linkedPublicationUrl =
                    (post.externalUrls ?? []).find((url) =>
                      /^https:\/\/addisstandard\.com\/?/i.test(url),
                    ) ?? null;

                  return {
                    title: sanitized.title,
                    url: post.url,
                    publishedAt: new Date(post.publishedAt).toISOString(),
                    language: profile.language,
                    section: "Official social",
                    body: sanitized.body,
                    captureNote: linkedPublicationUrl
                      ? `${profile.label} post linking to the outlet publication at ${linkedPublicationUrl}.`
                      : `${profile.label} post.`,
                  } satisfies NotebookLmSocialItem;
                })
                .filter((item): item is NotebookLmSocialItem => Boolean(item)),
            );

            return {
              source,
              items,
              diagnostics: [
                `${profile.label}: recovered ${items.length} posts from ${profile.profileUrl}.`,
              ],
              checkedSurfaces: [profile.profileUrl],
            } satisfies NotebookLmSocialDraft;
          }),
        );
      } catch (error) {
        resolve(
          profiles.map(([source, profile]) =>
            buildSocialFailureDraft(source, profile.label, [profile.profileUrl], error),
          ),
        );
      }
    });

    child.stdin.write(
      JSON.stringify({
        windowStart: brief.windowStart,
        windowEnd: brief.windowEnd,
        accounts: profiles.map(([source, profile]) => ({
          source,
          profileUrl: profile.profileUrl,
        })),
      }),
    );
    child.stdin.end();
  });
}

async function collectOfficialXSupplements(
  brief: WeeklyBrief,
  profiles: Array<[SourceName, XProfileConfig]>,
) {
  if (profiles.length === 0) {
    return [] as NotebookLmSocialDraft[];
  }

  const collectorPath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "scripts",
    "collect-x-posts.mjs",
  );

  return new Promise<NotebookLmSocialDraft[]>((resolve) => {
    const child = spawn(process.execPath, [collectorPath], {
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
      resolve(
        profiles.map(([source, profile]) =>
          buildSocialFailureDraft(source, profile.label, [profile.profileUrl], null),
        ),
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve(
          profiles.map(([source, profile]) =>
            buildSocialFailureDraft(source, profile.label, [profile.profileUrl], null),
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as Array<{
          source: SourceName;
          posts: Array<{
            publishedAt: string;
            url: string;
            body: string;
          }>;
        }>;

        resolve(
          profiles.map(([source, profile]) => {
            const entry = parsed.find((item) => item.source === source);
            const items = dedupeSocialItems(
              (entry?.posts ?? [])
                .filter((post) => normalizeSocialText(post.body).length > 0)
                .map((post) => {
                  const sanitized = sanitizeOfficialSocialItem({
                    source,
                    title: normalizeSocialText(post.body),
                    body: post.body,
                  });

                  if (!sanitized) {
                    return null;
                  }

                  return {
                    title: sanitized.title,
                    url: post.url,
                    publishedAt: new Date(post.publishedAt).toISOString(),
                    language: profile.language,
                    section: "Official social",
                    body: sanitized.body,
                    captureNote: `${profile.label} post.`,
                  } satisfies NotebookLmSocialItem;
                })
                .filter((item): item is NotebookLmSocialItem => Boolean(item)),
            );

            return {
              source,
              items,
              diagnostics: [
                `${profile.label}: recovered ${items.length} posts from ${profile.profileUrl}.`,
              ],
              checkedSurfaces: [profile.profileUrl],
            } satisfies NotebookLmSocialDraft;
          }),
        );
      } catch (error) {
        resolve(
          profiles.map(([source, profile]) =>
            buildSocialFailureDraft(source, profile.label, [profile.profileUrl], error),
          ),
        );
      }
    });

    child.stdin.write(
      JSON.stringify({
        windowStart: brief.windowStart,
        windowEnd: brief.windowEnd,
        accounts: profiles.map(([source, profile]) => ({
          source,
          profileUrl: profile.profileUrl,
        })),
      }),
    );
    child.stdin.end();
  });
}

export async function harvestOfficialSocialSupplements(
  brief: WeeklyBrief,
): Promise<NotebookLmSocialDraft[]> {
  const facebookProfiles = [
    ...ADDIS_STANDARD_OFFICIAL_FACEBOOK_PAGES.map(
      (page) =>
        [
          "Addis Standard" as const,
          {
            profileUrl: page.profileUrl,
            label: page.label,
            language: page.languageLabel,
          } satisfies FacebookProfileConfig,
        ] satisfies [SourceName, FacebookProfileConfig],
    ),
  ];
  const telegramProfiles = [
    ...ADDIS_STANDARD_OFFICIAL_TELEGRAM_CHANNELS.map(
      (channel) =>
        [
          "Addis Standard" as const,
          {
            previewUrl: channel.previewUrl,
            label: channel.label,
            language: channel.languageLabel,
          } satisfies TelegramProfileConfig,
        ] satisfies [SourceName, TelegramProfileConfig],
    ),
    ...(Object.entries(OFFICIAL_TELEGRAM_PROFILES) as Array<
      [SourceName, TelegramProfileConfig]
    >),
  ];
  const xProfiles = Object.entries(OFFICIAL_X_PROFILES) as Array<
    [SourceName, XProfileConfig]
  >;
  const youtubeProfiles = Object.entries(OFFICIAL_YOUTUBE_PROFILES) as Array<
    [SourceName, YouTubeProfileConfig]
  >;
  const instagramProfiles = Object.entries(OFFICIAL_INSTAGRAM_PROFILES) as Array<
    [SourceName, InstagramProfileConfig]
  >;

  const [facebookDrafts, telegramDrafts, xDrafts, youtubeDrafts, instagramDrafts] =
    await Promise.all([
      collectOfficialFacebookSupplements(brief, facebookProfiles),
      collectOfficialTelegramSupplements(brief, telegramProfiles),
      collectOfficialXSupplements(brief, xProfiles),
      collectOfficialYouTubeSupplements(brief, youtubeProfiles),
      collectOfficialInstagramSupplements(brief, instagramProfiles),
    ]);
  const merged = new Map<SourceName, NotebookLmSocialDraft>();

  for (const draft of [
    ...facebookDrafts,
    ...telegramDrafts,
    ...xDrafts,
    ...youtubeDrafts,
    ...instagramDrafts,
  ]) {
    merged.set(draft.source, mergeSocialDrafts(merged.get(draft.source), draft));
  }

  return [...merged.values()];
}
