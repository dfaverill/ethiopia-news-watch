import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { load } from "cheerio";
import OpenAI from "openai";

import { stripHtml, toAbsoluteUrl } from "@/lib/news/text";

const DEFAULT_CACHE_DIRECTORY = path.join(process.cwd(), ".cache");
const CACHE_DIRECTORY = process.env.NEWS_WATCH_CACHE_DIR
  ? path.resolve(process.env.NEWS_WATCH_CACHE_DIR)
  : DEFAULT_CACHE_DIRECTORY;
const VOA_CACHE_DIRECTORY = path.join(
  CACHE_DIRECTORY,
  "notebooklm",
  "voa-transcripts",
);
const MAX_AUDIO_UPLOAD_BYTES = 24 * 1024 * 1024;
const DEFAULT_TRANSLATION_MODEL =
  process.env.OPENAI_AUDIO_TRANSLATION_MODEL || "whisper-1";
const VOA_TRANSLATION_PROMPT = [
  "Translate this VOA Amharic news audio faithfully into English.",
  "Do not summarize and do not add commentary.",
  "Preserve names of people, places, institutions, and programs.",
  "Keep Ethiopia-related spellings clear, including Ethiopia, Addis Ababa, Tigray, Amhara, Oromia, Sudan, Eritrea, Prosperity Party, NEBE, ENA, African Union, and VOA.",
  "Return only the English transcript text.",
].join(" ");

let client: OpenAI | null = null;

export interface VoaSectionCandidate {
  title: string;
  url: string;
}

export interface VoaAudioSource {
  label: string;
  kind: "download" | "stream";
  url: string;
}

export interface VoaEpisodeDetail {
  audioSources: VoaAudioSource[];
  description: string;
  publishedAt: string | null;
}

interface VoaTranscriptCacheRecord {
  captureNote: string;
  createdAt: string;
  episodeUrl: string;
  mediaUrl: string;
  model: string;
  publishedAt: string | null;
  text: string;
  title: string;
}

export interface VoaTranslatedTranscript {
  captureNote: string;
  mediaUrl: string;
  model: string;
  publishedAt: string | null;
  text: string;
}

async function translateResolvedVoaAudioSource(args: {
  audioSource: VoaAudioSource;
  episodeUrl: string;
  publishedAt: string | null;
  title: string;
}) {
  const title = normalizeWhitespace(args.title) || "VOA Amharic episode";
  const cacheKey = buildCacheKey(
    args.episodeUrl,
    args.audioSource.url,
    title,
    args.publishedAt,
  );
  const cachePath = path.join(VOA_CACHE_DIRECTORY, `${cacheKey}.json`);
  const cached = await loadCachedTranscript(cachePath);

  if (cached) {
    return {
      captureNote: cached.captureNote,
      mediaUrl: cached.mediaUrl,
      model: cached.model,
      publishedAt: cached.publishedAt,
      text: cached.text,
    } satisfies VoaTranslatedTranscript;
  }

  const workDirectory = path.join(VOA_CACHE_DIRECTORY, "tmp", cacheKey);
  await rm(workDirectory, { recursive: true, force: true });

  try {
    const audioPath = await materializeAudioInput(
      args.audioSource,
      workDirectory,
      "episode",
    );
    const segmentPaths = await splitAudioIfNeeded(audioPath, workDirectory);
    const translatedText = await translateAudioSegments(
      segmentPaths,
      title,
      args.publishedAt,
    );

    if (!translatedText) {
      return null;
    }

    const captureNote =
      args.audioSource.kind === "download"
        ? `Translated from VOA Amharic's official ${args.audioSource.label} audio into English using ${DEFAULT_TRANSLATION_MODEL}.`
        : `Translated from VOA Amharic's official embedded audio stream into English using ${DEFAULT_TRANSLATION_MODEL}.`;

    const record = {
      captureNote,
      createdAt: new Date().toISOString(),
      episodeUrl: args.episodeUrl,
      mediaUrl: args.audioSource.url,
      model: DEFAULT_TRANSLATION_MODEL,
      publishedAt: args.publishedAt,
      text: translatedText,
      title,
    } satisfies VoaTranscriptCacheRecord;

    await saveCachedTranscript(cachePath, record);

    return {
      captureNote: record.captureNote,
      mediaUrl: record.mediaUrl,
      model: record.model,
      publishedAt: record.publishedAt,
      text: record.text,
    } satisfies VoaTranslatedTranscript;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return client;
}

function normalizeWhitespace(value: string) {
  return stripHtml(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTranscriptText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean)
    .join("\n\n");
}

function dedupeAudioSources(sources: VoaAudioSource[]) {
  const seen = new Set<string>();
  const deduped: VoaAudioSource[] = [];

  for (const source of sources) {
    const key = `${source.kind}|${source.url}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function scoreAudioSource(source: VoaAudioSource) {
  const label = source.label.toLowerCase();

  if (source.kind === "download" && /32\s*kbps/.test(label)) {
    return 0;
  }

  if (source.kind === "download" && /64\s*kbps/.test(label)) {
    return 1;
  }

  if (source.kind === "download" && /128\s*kbps|hq/.test(label)) {
    return 2;
  }

  if (source.kind === "download") {
    return 3;
  }

  return 4;
}

export function selectPreferredVoaAudioSource(sources: VoaAudioSource[]) {
  return dedupeAudioSources(sources)
    .slice()
    .sort((left, right) => {
      const scoreDifference = scoreAudioSource(left) - scoreAudioSource(right);
      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return left.url.localeCompare(right.url);
    })[0] ?? null;
}

export function extractVoaSectionCandidates(
  html: string,
  baseUrl = "https://amharic.voanews.com/",
) {
  const $ = load(html);
  const candidates = new Map<string, VoaSectionCandidate>();

  $(".media-block").each((_, element) => {
    const block = $(element);
    const mediaType = block.find(".ico-audio, .ico-video").first();
    const href =
      block.find('a[href^="/a/"]').first().attr("href") ??
      block.find('a[href*="/a/"]').first().attr("href") ??
      "";

    if (!href || mediaType.length === 0) {
      return;
    }

    const absoluteUrl = toAbsoluteUrl(baseUrl, href);
    const title =
      normalizeWhitespace(block.find("h4").first().text()) ||
      normalizeWhitespace(block.find("a[title]").first().attr("title") ?? "");

    if (!absoluteUrl || !title) {
      return;
    }

    candidates.set(absoluteUrl, {
      title,
      url: absoluteUrl,
    });
  });

  return [...candidates.values()];
}

function extractPublishedAt(html: string) {
  const analyticsMatch = html.match(/pub_datetime:"([^"]+)"/);
  if (analyticsMatch?.[1]) {
    const timestamp = new Date(analyticsMatch[1]).toISOString();
    if (!Number.isNaN(new Date(timestamp).getTime())) {
      return timestamp;
    }
  }

  const ldJsonMatch = html.match(/"datePublished":"([^"]+)"/);
  if (ldJsonMatch?.[1]) {
    const timestamp = new Date(ldJsonMatch[1]).toISOString();
    if (!Number.isNaN(new Date(timestamp).getTime())) {
      return timestamp;
    }
  }

  return null;
}

export function extractVoaEpisodeDetail(
  html: string,
  episodeUrl: string,
): VoaEpisodeDetail {
  const $ = load(html);
  const audioSources: VoaAudioSource[] = [];

  $(".media-download a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const label =
      normalizeWhitespace($(element).attr("title") ?? "") ||
      normalizeWhitespace($(element).text()) ||
      "Direct audio download";

    if (!href) {
      return;
    }

    audioSources.push({
      label,
      kind: "download",
      url: toAbsoluteUrl(episodeUrl, href),
    });
  });

  const streamUrl =
    $('meta[name="twitter:player:stream"]').attr("content") ??
    $('meta[property="og:audio"]').attr("content") ??
    "";

  if (streamUrl) {
    audioSources.push({
      label: "Embedded player stream",
      kind: "stream",
      url: toAbsoluteUrl(episodeUrl, streamUrl),
    });
  }

  const description = normalizeWhitespace(
    $(".intro p")
      .toArray()
      .map((element) => $(element).text())
      .join("\n\n"),
  );

  return {
    audioSources: dedupeAudioSources(audioSources),
    description,
    publishedAt: extractPublishedAt(html),
  };
}

function buildCacheKey(
  episodeUrl: string,
  mediaUrl: string,
  title: string,
  publishedAt: string | null,
) {
  const hash = createHash("sha256");
  hash.update(episodeUrl);
  hash.update(mediaUrl);
  hash.update(title);
  hash.update(publishedAt ?? "");
  hash.update(DEFAULT_TRANSLATION_MODEL);
  return hash.digest("hex");
}

async function loadCachedTranscript(cachePath: string) {
  try {
    const raw = await readFile(cachePath, "utf8");
    return JSON.parse(raw) as VoaTranscriptCacheRecord;
  } catch {
    return null;
  }
}

async function saveCachedTranscript(
  cachePath: string,
  record: VoaTranscriptCacheRecord,
) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(record, null, 2), "utf8");
}

async function downloadAudioFile(url: string, filePath: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading ${url}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
}

function runProcess(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}.`));
    });
  });
}

async function materializeAudioInput(
  source: VoaAudioSource,
  workDirectory: string,
  fileStem: string,
) {
  await mkdir(workDirectory, { recursive: true });
  const outputPath = path.join(workDirectory, `${fileStem}.mp3`);

  if (/\.mp3(\?|$)/i.test(source.url)) {
    await downloadAudioFile(source.url, outputPath);
    return outputPath;
  }

  await runProcess(
    "ffmpeg",
    [
      "-y",
      "-i",
      source.url,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "24k",
      outputPath,
    ],
    workDirectory,
  );

  return outputPath;
}

async function splitAudioIfNeeded(audioPath: string, workDirectory: string) {
  const fileStats = await stat(audioPath);
  if (fileStats.size <= MAX_AUDIO_UPLOAD_BYTES) {
    return [audioPath];
  }

  const segmentPattern = path.join(workDirectory, "segment-%03d.mp3");
  await runProcess(
    "ffmpeg",
    [
      "-y",
      "-i",
      audioPath,
      "-f",
      "segment",
      "-segment_time",
      "1200",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "24k",
      segmentPattern,
    ],
    workDirectory,
  );

  const segmentPaths: string[] = [];
  for (let index = 0; index < 24; index += 1) {
    const segmentPath = path.join(
      workDirectory,
      `segment-${index.toString().padStart(3, "0")}.mp3`,
    );

    try {
      await stat(segmentPath);
      segmentPaths.push(segmentPath);
    } catch {
      break;
    }
  }

  return segmentPaths.length > 0 ? segmentPaths : [audioPath];
}

async function translateAudioSegments(
  segmentPaths: string[],
  title: string,
  publishedAt: string | null,
) {
  const openai = getClient();
  if (!openai) {
    return null;
  }

  const translatedSegments: string[] = [];

  for (const segmentPath of segmentPaths) {
    const response = await openai.audio.translations.create({
      file: createReadStream(segmentPath),
      model: DEFAULT_TRANSLATION_MODEL,
      prompt: `${VOA_TRANSLATION_PROMPT} Episode title: ${title}. Published at: ${publishedAt ?? "unknown"}.`,
      response_format: "json",
      temperature: 0,
    });

    const translatedText = normalizeTranscriptText(response.text ?? "");
    if (translatedText) {
      translatedSegments.push(translatedText);
    }
  }

  return translatedSegments.join("\n\n");
}

export async function translateVoaAudioSourceToEnglish(args: {
  audioSource: VoaAudioSource;
  episodeUrl: string;
  publishedAt: string;
  title: string;
}) {
  return translateResolvedVoaAudioSource({
    audioSource: args.audioSource,
    episodeUrl: args.episodeUrl,
    publishedAt: args.publishedAt,
    title: args.title,
  });
}

export async function translateVoaEpisodeToEnglish(args: {
  detailHtml: string;
  episodeUrl: string;
  publishedAt: string;
  title: string;
}) {
  const detail = extractVoaEpisodeDetail(args.detailHtml, args.episodeUrl);
  const preferredSource = selectPreferredVoaAudioSource(detail.audioSources);

  if (!preferredSource) {
    return null;
  }

  const publishedAt = detail.publishedAt ?? args.publishedAt;
  return translateResolvedVoaAudioSource({
    audioSource: preferredSource,
    episodeUrl: args.episodeUrl,
    publishedAt,
    title: args.title,
  });
}
