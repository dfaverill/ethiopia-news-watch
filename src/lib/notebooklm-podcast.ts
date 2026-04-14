import { createHash } from "node:crypto";
import { existsSync, openSync, readFileSync, readdirSync, statSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  normalizeDashboardPayload,
  type SourceName,
  type WeeklyBrief,
} from "@/lib/dashboard";
import {
  buildNotebookLmSourcePackets,
  type NotebookLmCaptureKind,
  type NotebookLmPacketDraft,
  type NotebookLmPacketItem,
  type NotebookLmWeeklySourceCheck,
  type NotebookLmWeeklyUploadCheck,
} from "@/lib/notebooklm-source-harvest";
import { getDashboardPayload } from "@/lib/news/aggregate";
import { CACHE_TTL_MS } from "@/lib/news/constants";
import { logNewsEvent } from "@/lib/news/logger";
import { loadPersistedCoverageState } from "@/lib/news/persistence";
import { explainRelevanceDecision } from "@/lib/news/relevance";
import type { SourceFetchResult } from "@/lib/news/types";

const DEFAULT_CACHE_DIRECTORY = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  ".cache",
);
const CACHE_DIRECTORY = process.env.NEWS_WATCH_CACHE_DIR
  ? path.resolve(process.env.NEWS_WATCH_CACHE_DIR)
  : DEFAULT_CACHE_DIRECTORY;
const NOTEBOOKLM_DIRECTORY = path.join(CACHE_DIRECTORY, "notebooklm");
const NOTEBOOKLM_PROFILE_DIRECTORY = path.join(
  NOTEBOOKLM_DIRECTORY,
  "profile",
);
const NOTEBOOKLM_SOURCE_DIRECTORY = path.join(
  NOTEBOOKLM_DIRECTORY,
  "source-packets",
);
const NOTEBOOKLM_AUDIT_DIRECTORY = path.join(
  NOTEBOOKLM_DIRECTORY,
  "source-audits",
);
const NOTEBOOKLM_AUDIO_DIRECTORY = path.join(NOTEBOOKLM_DIRECTORY, "audio");
const NOTEBOOKLM_DEBUG_DIRECTORY = path.join(NOTEBOOKLM_DIRECTORY, "debug");
const NOTEBOOKLM_REUSABLE_NOTEBOOK_PATH = path.join(
  NOTEBOOKLM_DIRECTORY,
  "reusable-notebook.json",
);
const NOTEBOOKLM_STATE_SCHEMA_VERSION = 1;
const NOTEBOOKLM_PROVIDER = "google-notebooklm";
const NOTEBOOKLM_PREPARED_REQUEST_SCHEMA_VERSION = 12;
export const NOTEBOOKLM_NOTEBOOK_TITLE = "Ethiopia News";
export const NOTEBOOKLM_RECENT_NOTEBOOK_TITLE = NOTEBOOKLM_NOTEBOOK_TITLE;
const NOTEBOOKLM_LANGUAGE = process.env.NOTEBOOKLM_PODCAST_LANGUAGE || "English";
const NOTEBOOKLM_BROWSER_CHANNEL =
  process.env.NOTEBOOKLM_BROWSER_CHANNEL || "msedge";
const NOTEBOOKLM_BROWSER_PROFILE_DIRECTORY =
  process.env.NOTEBOOKLM_BROWSER_PROFILE_DIRECTORY || "";
const NOTEBOOKLM_BROWSER_HEADLESS =
  process.env.NOTEBOOKLM_BROWSER_HEADLESS === "1";
const NOTEBOOKLM_SETUP_TIMEOUT_MINUTES = 15;
const MIN_COMPREHENSIVE_NON_EMPTY_PACKETS = 4;
const MIN_COMPREHENSIVE_TOTAL_ITEMS = 25;
const MIN_COMPREHENSIVE_RICH_PACKETS = 3;
const MIN_COMPREHENSIVE_FULL_ARTICLE_PACKETS = 2;
const MIN_COMPREHENSIVE_RICH_CHARACTERS = 2_500;
const MIN_RECENT_NON_EMPTY_PACKETS = 2;
const MIN_RECENT_TOTAL_ITEMS = 6;
const MIN_RECENT_RICH_PACKETS = 1;
const MIN_RECENT_FULL_ARTICLE_PACKETS = 1;
const MIN_RECENT_RICH_CHARACTERS = 900;
type NotebookLmWorkerOperation = "generate-audio" | "sync-sources";
const MIN_ITEMS_PER_SOURCE: Partial<Record<SourceName, number>> = {
  "Addis Standard": 3,
  ENA: 3,
  "Ethiopia Insight": 2,
  NEBE: 2,
  "The Reporter Ethiopia": 3,
  "VOA Amharic": 2,
};
export type NotebookLmPodcastScope = "weekly" | "recent";
type NotebookLmPodcastMode = "deep-dive-long" | "last-two-days-brief";

interface NotebookLmScopeConfig {
  allowLegacyTitleReuse: boolean;
  blockedSummaryPrefix: string;
  confirmedSummaryPrefix: string;
  driveTitleBase: string;
  emptyMessage: string;
  label: string;
  minFullArticlePackets: number;
  minItemsPerSource: Partial<Record<SourceName, number>>;
  minNonEmptyPackets: number;
  minRichCharacters: number;
  minRichPackets: number;
  minTotalItems: number;
  mode: NotebookLmPodcastMode;
  notebookTitle: string;
  scope: NotebookLmPodcastScope;
  sourceCountUnitLabel: string;
  staleMessage: string;
}

const NOTEBOOKLM_SCOPE_CONFIG = {
  weekly: {
    allowLegacyTitleReuse: true,
    blockedSummaryPrefix:
      "Deep dive blocked until the weekly source packet is comprehensive enough.",
    confirmedSummaryPrefix:
      "Comprehensive source packet confirmed",
    driveTitleBase: NOTEBOOKLM_NOTEBOOK_TITLE,
    emptyMessage: "Refresh coverage to prepare the weekly audio episode.",
    label: "Ethiopia News Watch weekly episode",
    minFullArticlePackets: MIN_COMPREHENSIVE_FULL_ARTICLE_PACKETS,
    minItemsPerSource: MIN_ITEMS_PER_SOURCE,
    minNonEmptyPackets: MIN_COMPREHENSIVE_NON_EMPTY_PACKETS,
    minRichCharacters: MIN_COMPREHENSIVE_RICH_CHARACTERS,
    minRichPackets: MIN_COMPREHENSIVE_RICH_PACKETS,
    minTotalItems: MIN_COMPREHENSIVE_TOTAL_ITEMS,
    mode: "deep-dive-long",
    notebookTitle: NOTEBOOKLM_NOTEBOOK_TITLE,
    scope: "weekly",
    sourceCountUnitLabel: "weekly items",
    staleMessage:
      "A newer weekly coverage packet is ready. Generate a fresh weekly episode to match the latest reporting.",
  },
  recent: {
    allowLegacyTitleReuse: false,
    blockedSummaryPrefix:
      "Recent audio briefing blocked until the last-two-days source packet is comprehensive enough.",
    confirmedSummaryPrefix:
      "Recent source packet confirmed",
    driveTitleBase: NOTEBOOKLM_RECENT_NOTEBOOK_TITLE,
    emptyMessage: "Refresh coverage to prepare the last two days audio episode.",
    label: "Ethiopia News Watch last two days episode",
    minFullArticlePackets: MIN_RECENT_FULL_ARTICLE_PACKETS,
    minItemsPerSource: {},
    minNonEmptyPackets: MIN_RECENT_NON_EMPTY_PACKETS,
    minRichCharacters: MIN_RECENT_RICH_CHARACTERS,
    minRichPackets: MIN_RECENT_RICH_PACKETS,
    minTotalItems: MIN_RECENT_TOTAL_ITEMS,
    mode: "last-two-days-brief",
    notebookTitle: NOTEBOOKLM_RECENT_NOTEBOOK_TITLE,
    scope: "recent",
    sourceCountUnitLabel: "recent items",
    staleMessage:
      "A newer last-two-days coverage packet is ready. Generate a fresh recent episode to match the latest reporting.",
  },
} as const satisfies Record<NotebookLmPodcastScope, NotebookLmScopeConfig>;

function getNotebookLmScopeConfig(scope: NotebookLmPodcastScope) {
  return NOTEBOOKLM_SCOPE_CONFIG[scope];
}

function getNotebookLmScopeSuffix(scope: NotebookLmPodcastScope) {
  return scope === "weekly" ? "" : `-${scope}`;
}

function getNotebookLmPreparedRequestPath(scope: NotebookLmPodcastScope) {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `prepared-request${getNotebookLmScopeSuffix(scope)}.json`,
  );
}

function getNotebookLmPreparedRequestTempPath(scope: NotebookLmPodcastScope) {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `prepared-request${getNotebookLmScopeSuffix(scope)}.tmp.json`,
  );
}

export function getNotebookLmStatePath(scope: NotebookLmPodcastScope = "weekly") {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `podcast-state${getNotebookLmScopeSuffix(scope)}.json`,
  );
}

function getNotebookLmStateTempPath(scope: NotebookLmPodcastScope) {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `podcast-state${getNotebookLmScopeSuffix(scope)}.tmp.json`,
  );
}

export function getNotebookLmJobPath(scope: NotebookLmPodcastScope = "weekly") {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `podcast-job${getNotebookLmScopeSuffix(scope)}.json`,
  );
}

function getNotebookLmJobTempPath(scope: NotebookLmPodcastScope) {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `podcast-job${getNotebookLmScopeSuffix(scope)}.tmp.json`,
  );
}

function getNotebookLmWorkerStdoutPath(scope: NotebookLmPodcastScope) {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `worker${getNotebookLmScopeSuffix(scope)}.out.log`,
  );
}

function getNotebookLmWorkerStderrPath(scope: NotebookLmPodcastScope) {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `worker${getNotebookLmScopeSuffix(scope)}.err.log`,
  );
}

function getNotebookLmDriveSourceIndexPath(scope: NotebookLmPodcastScope) {
  return path.join(
    NOTEBOOKLM_DIRECTORY,
    `drive-source-docs${getNotebookLmScopeSuffix(scope)}.json`,
  );
}

export type NotebookLmPodcastStatus =
  | "idle"
  | "queued"
  | "auth-required"
  | "running"
  | "ready"
  | "failed"
  | "stale";

export interface NotebookLmPodcastPublicState {
  provider: typeof NOTEBOOKLM_PROVIDER;
  scope: NotebookLmPodcastScope;
  mode: NotebookLmPodcastMode;
  label: string;
  status: NotebookLmPodcastStatus;
  jobKey: string | null;
  notebookTitle: string | null;
  notebookUrl: string | null;
  prompt: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  audioUrl: string | null;
  sourceCount: number;
  sourceLabel: string;
  message: string | null;
  error: string | null;
  matchesCurrentCoverage: boolean;
  needsSignin: boolean;
  canGenerate: boolean;
}

interface NotebookLmPodcastState {
  schemaVersion: number;
  provider: typeof NOTEBOOKLM_PROVIDER;
  scope: NotebookLmPodcastScope;
  mode: NotebookLmPodcastMode;
  status: Exclude<NotebookLmPodcastStatus, "stale">;
  jobKey: string | null;
  notebookTitle: string | null;
  notebookUrl: string | null;
  prompt: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  audioPath: string | null;
  sourceCount: number;
  sourceLabel: string;
  message: string | null;
  error: string | null;
  needsSignin: boolean;
}

interface NotebookLmSourcePacket {
  source: string;
  fileName: string;
  filePath: string;
  itemCount: number;
  content: string;
  auditFileName: string;
  auditContent: string;
  driveDocTitle: string;
}

export interface NotebookLmPreparedRequest {
  brief: WeeklyBrief;
  coverageFingerprint: string;
  jobKey: string;
  notebookTitle: string;
  prompt: string;
  sourcePackets: NotebookLmSourcePacket[];
  sourceQuality: NotebookLmSourceQualityReport;
}

interface BuildPreparedRequestOptions {
  forceCoverageRefresh?: boolean;
}

interface StoredPreparedRequest {
  schemaVersion: number;
  coverageFingerprint: string;
  request: NotebookLmPreparedRequest;
  savedAt: string;
}

interface NotebookLmCoverageSummary {
  canGenerate: boolean;
  brief: WeeklyBrief | null;
  sourceCount: number;
  packetCount: number;
  sourceLabel: string;
  lastSuccessfulRefreshAt: string | null;
}

interface NotebookLmSourceQualityReport {
  isComprehensive: boolean;
  totalItems: number;
  nonEmptyPacketCount: number;
  richPacketCount: number;
  fullArticlePacketCount: number;
  issues: string[];
  verifiedSparseSources: string[];
  skippedInactiveSources: string[];
  summary: string;
}

interface NotebookLmPodcastJob {
  schemaVersion: number;
  scope: NotebookLmPodcastScope;
  operation: NotebookLmWorkerOperation;
  jobKey: string;
  createdAt: string;
  notebookTitle: string;
  allowLegacyTitleReuse: boolean;
  prompt: string;
  notebookUrl: string | null;
  profileDir: string;
  debugDir: string;
  outputAudioPath: string;
  outputAudioProofPath: string;
  statePath: string;
  sharedNotebookPath: string;
  driveSourceIndexPath: string;
  browserChannel: string;
  browserProfileDirectory: string | null;
  browserHeadless: boolean;
  sourceFiles: Array<{
    source: string;
    path: string;
    itemCount: number;
    driveDocTitle: string;
  }>;
}

interface NotebookLmReusableNotebookRecord {
  notebookTitle: string;
  notebookUrl: string;
  updatedAt: string;
}

interface NotebookLmReadyAudioArtifact {
  audioPath: string;
  generatedAt: string | null;
  jobKey: string;
}

function createEmptyState(scope: NotebookLmPodcastScope): NotebookLmPodcastState {
  const config = getNotebookLmScopeConfig(scope);

  return {
    schemaVersion: NOTEBOOKLM_STATE_SCHEMA_VERSION,
    provider: NOTEBOOKLM_PROVIDER,
    scope,
    mode: config.mode,
    status: "idle",
    jobKey: null,
    notebookTitle: null,
    notebookUrl: null,
    prompt: null,
    requestedAt: null,
    updatedAt: null,
    completedAt: null,
    audioPath: null,
    sourceCount: 0,
    sourceLabel: "No source packets prepared yet.",
    message: config.emptyMessage,
    error: null,
    needsSignin: false,
  };
}

function isStoredState(
  value: unknown,
  scope: NotebookLmPodcastScope,
): value is NotebookLmPodcastState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const config = getNotebookLmScopeConfig(scope);

  return (
    candidate.schemaVersion === NOTEBOOKLM_STATE_SCHEMA_VERSION &&
    candidate.provider === NOTEBOOKLM_PROVIDER &&
    candidate.scope === scope &&
    candidate.mode === config.mode &&
    typeof candidate.status === "string"
  );
}

export function normalizeNotebookLmStoredState(
  value: unknown,
  scope: NotebookLmPodcastScope,
): NotebookLmPodcastState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const config = getNotebookLmScopeConfig(scope);
  const matchesCurrentSchema = isStoredState(candidate, scope);
  const matchesLegacyWeeklyState =
    scope === "weekly" &&
    candidate.schemaVersion === NOTEBOOKLM_STATE_SCHEMA_VERSION &&
    candidate.provider === NOTEBOOKLM_PROVIDER &&
    candidate.scope === undefined &&
    candidate.mode === config.mode &&
    typeof candidate.status === "string";

  if (!matchesCurrentSchema && !matchesLegacyWeeklyState) {
    return null;
  }

  return {
    ...createEmptyState(scope),
    ...(candidate as Partial<NotebookLmPodcastState>),
    scope,
    mode: config.mode,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function formatNotebookDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatPacketDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function formatSourceCountLabel(sourceCount: number, packetCount: number) {
  const sourceText =
    packetCount === 1 ? "1 source packet" : `${packetCount} source packets`;
  const articleText =
    sourceCount === 1 ? "1 coverage item" : `${sourceCount} coverage items`;

  return `${sourceText} across ${articleText}`;
}

export function buildNotebookLmAudioProofPath(
  jobKey: string,
  scope: NotebookLmPodcastScope = "weekly",
) {
  return path.join(
    NOTEBOOKLM_AUDIO_DIRECTORY,
    `${scope}-${jobKey}.ready.json`,
  );
}

function getNotebookLmAudioProofPaths(
  jobKey: string,
  scope: NotebookLmPodcastScope,
) {
  const scopedProofPath = buildNotebookLmAudioProofPath(jobKey, scope);
  return scope === "weekly"
    ? [
        scopedProofPath,
        path.join(NOTEBOOKLM_AUDIO_DIRECTORY, `${jobKey}.ready.json`),
      ]
    : [scopedProofPath];
}

function hasVerifiedReadyAudioArtifact(state: NotebookLmPodcastState) {
  if (
    state.status !== "ready" ||
    !state.jobKey ||
    !state.audioPath ||
    !existsSync(state.audioPath)
  ) {
    return false;
  }

  return getNotebookLmAudioProofPaths(state.jobKey, state.scope).some((proofPath) => {
    if (!existsSync(proofPath)) {
      return false;
    }

    try {
      const parsed = JSON.parse(readFileSync(proofPath, "utf8")) as {
        jobKey?: string;
        audioPath?: string;
      };

      return parsed.jobKey === state.jobKey && parsed.audioPath === state.audioPath;
    } catch {
      return false;
    }
  });
}

function readVerifiedReadyAudioArtifact(
  proofPath: string,
): NotebookLmReadyAudioArtifact | null {
  if (!existsSync(proofPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(proofPath, "utf8")) as {
      audioPath?: string;
      generatedAt?: string;
      jobKey?: string;
    };

    if (
      typeof parsed.jobKey !== "string" ||
      parsed.jobKey.length === 0 ||
      typeof parsed.audioPath !== "string" ||
      parsed.audioPath.length === 0 ||
      !existsSync(parsed.audioPath)
    ) {
      return null;
    }

    return {
      audioPath: parsed.audioPath,
      generatedAt:
        typeof parsed.generatedAt === "string" && parsed.generatedAt.length > 0
          ? parsed.generatedAt
          : null,
      jobKey: parsed.jobKey,
    };
  } catch {
    return null;
  }
}

function getLatestVerifiedReadyAudioArtifact(
  scope: NotebookLmPodcastScope,
): NotebookLmReadyAudioArtifact | null {
  if (!existsSync(NOTEBOOKLM_AUDIO_DIRECTORY)) {
    return null;
  }

  const proofFiles = readdirSync(NOTEBOOKLM_AUDIO_DIRECTORY).filter(
    (fileName) => fileName.startsWith(`${scope}-`) && fileName.endsWith(".ready.json"),
  );

  let bestArtifact: NotebookLmReadyAudioArtifact | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const fileName of proofFiles) {
    const proofPath = path.join(NOTEBOOKLM_AUDIO_DIRECTORY, fileName);
    const artifact = readVerifiedReadyAudioArtifact(proofPath);

    if (!artifact) {
      continue;
    }

    const generatedTime = artifact.generatedAt
      ? new Date(artifact.generatedAt).getTime()
      : Number.NaN;
    const fallbackTime = Number.isFinite(generatedTime)
      ? generatedTime
      : statSync(proofPath).mtimeMs;

    if (fallbackTime > bestScore) {
      bestArtifact = artifact;
      bestScore = fallbackTime;
    }
  }

  return bestArtifact;
}

function resolveCurrentReadyAudioArtifact(
  state: NotebookLmPodcastState,
): NotebookLmReadyAudioArtifact | null {
  if (hasVerifiedReadyAudioArtifact(state) && state.jobKey && state.audioPath) {
    return {
      audioPath: state.audioPath,
      generatedAt: state.completedAt ?? state.updatedAt ?? state.requestedAt,
      jobKey: state.jobKey,
    };
  }

  return getLatestVerifiedReadyAudioArtifact(state.scope);
}

function formatCaptureKindLabel(captureKind: NotebookLmCaptureKind) {
  switch (captureKind) {
    case "full-article":
      return "Full article text";
    case "rss-excerpt":
      return "Publisher RSS text";
    case "mirror-excerpt":
      return "Indexed mirror excerpt";
    case "translated-transcript":
      return "English transcript from official audio";
    case "social-post":
      return "Official social post";
    case "dashboard-snippet":
      return "Dashboard fallback snippet";
    default:
      return "Exact publication record";
  }
}

function buildNotebookTitle(
  brief: WeeklyBrief,
  scope: NotebookLmPodcastScope = "weekly",
) {
  void brief;
  return getNotebookLmScopeConfig(scope).notebookTitle;
}

export function buildNotebookLmDriveDocTitle(
  source: string,
  scope: NotebookLmPodcastScope = "weekly",
) {
  return `${getNotebookLmScopeConfig(scope).driveTitleBase} - ${source}`;
}

export function buildNotebookLmPodcastPrompt(
  brief: WeeklyBrief,
  scope: NotebookLmPodcastScope = "weekly",
) {
  if (scope === "recent") {
    return [
      "Create a professional Ethiopia News Watch last-two-days audio overview.",
      "The hosts are professional news presenters delivering a serious, neutral, well-structured Ethiopia news briefing for the Ethiopia News Watch website.",
      "Do not start with a dramatic scene opener.",
      "Just introduce yourselves as hosts for the Ethiopia News Watch website, then introduce the exact time period this episode covers.",
      "State the dates being covered and make clear that the episode focuses on a single two-day reporting window.",
      "Do not add a disclaimer about not personally endorsing the beliefs, claims, or events being discussed.",
      "Treat the uploaded source packets as the reporting record for this recent coverage window and use only those materials.",
      "Lead with the most consequential developments from the last two days, then connect the main political, conflict, diplomatic, economic, and humanitarian threads when the sources support them.",
      "Make clear where outlets agree, where they differ in emphasis or framing, and which details come from which source when those distinctions matter.",
      "Avoid hype, avoid invented facts, avoid casual banter that undercuts credibility, and keep the tone polished, editorially restrained, and listener-friendly.",
      "Use a true long-form deep-dive treatment rather than a short recap, even though the coverage window is only two days.",
      "Target a runtime above thirty minutes and sustain the conversation for as long as NotebookLM allows while staying tightly grounded in the uploaded reporting packet.",
      `Produce the conversation in ${NOTEBOOKLM_LANGUAGE}.`,
      `Coverage window: ${formatNotebookDate(brief.windowStart)} to ${formatNotebookDate(brief.windowEnd)}.`,
    ].join(" ");
  }

  return [
    "Create a professional Ethiopia News Watch weekly audio overview.",
    "The hosts are professional news presenters delivering a serious, neutral, well-structured Ethiopia news briefing for the Ethiopia News Watch website.",
    "Do not start with a dramatic scene opener.",
    "Just introduce yourselves as hosts for the Ethiopia News Watch website, then introduce the exact time period this episode covers.",
    "State the dates being covered and make clear that the episode focuses on a single seven-day reporting window.",
    "Do not add a disclaimer about not personally endorsing the beliefs, claims, or events being discussed.",
    "Treat the uploaded source packets as the reporting record for this coverage window and use only those materials.",
    "Lead with the most consequential developments, then connect the main political, conflict, diplomatic, economic, and humanitarian threads when the sources support them.",
    "Make clear where outlets agree, where they differ in emphasis or framing, and which details come from which source when those distinctions matter.",
    "Avoid hype, avoid invented facts, avoid casual banter that undercuts credibility, and keep the tone polished, editorially restrained, and listener-friendly.",
    "Use a true long-form deep-dive treatment rather than a short recap, and make the episode as comprehensive and sustained as NotebookLM allows.",
    "Target a runtime above thirty minutes and sustain the conversation for as long as NotebookLM allows while remaining disciplined, source-grounded, and professionally paced.",
    "The finished audio should feel like a polished Ethiopia News Watch website feature, with clear signposting, strong attribution, and disciplined professional delivery.",
    `Produce the conversation in ${NOTEBOOKLM_LANGUAGE}.`,
    `Coverage window: ${formatNotebookDate(brief.windowStart)} to ${formatNotebookDate(brief.windowEnd)}.`,
  ].join(" ");
}

function isRichNotebookLmItem(item: NotebookLmPacketItem) {
  return (
    item.captureKind === "full-article" ||
    item.captureKind === "rss-excerpt" ||
    item.captureKind === "mirror-excerpt" ||
    item.captureKind === "translated-transcript"
  );
}

function isNotebookLmSourcePublicationItem(item: NotebookLmPacketItem) {
  return (
    item.captureKind === "full-article" ||
    item.captureKind === "rss-excerpt" ||
    item.captureKind === "mirror-excerpt" ||
    item.captureKind === "social-post" ||
    item.captureKind === "translated-transcript"
  );
}

function sanitizeNotebookLmPublicationBody(body: string) {
  return String(body || "")
    .replace(/\n{2,}\[(?:Transcript )?truncated for packet length\.\]\s*$/i, "")
    .trim();
}

const NOTEBOOKLM_EXPLICIT_ETHIOPIA_CONTEXT_PHRASES = [
  "ethiopia",
  "ethiopian",
  "addis ababa",
  "addis abeba",
  "tigray",
  "amhara",
  "oromia",
  "afar",
  "gambella",
  "benishangul",
  "benishangul gumuz",
  "somali region",
  "sidama",
  "dire dawa",
  "bishoftu",
  "fano",
  "mekelle",
  "abiy",
  "nebe",
  "national election board",
  "national dialogue",
  "endc",
  "ethio telecom",
  "ethiopian airlines",
  "federal democratic republic of ethiopia",
  "house of peoples representatives",
  "somaliland",
  "eritrea",
  "sudan border",
];

const NOTEBOOKLM_MIXED_ROUNDUP_PATTERNS = [
  /\btop stories\b/i,
  /\bmajor developments across global and regional affairs\b/i,
];

function hasNotebookLmExplicitEthiopiaContext(value: string) {
  const normalized = normalizeNotebookLmStoryText(value);

  return NOTEBOOKLM_EXPLICIT_ETHIOPIA_CONTEXT_PHRASES.some((phrase) =>
    normalized.includes(normalizeNotebookLmStoryText(phrase)),
  );
}

function looksLikeMixedRoundupItem(item: NotebookLmPacketItem) {
  const combined = `${item.title}\n${item.body}`;
  const titlePipeCount = (item.title.match(/\|/g) ?? []).length;

  return (
    NOTEBOOKLM_MIXED_ROUNDUP_PATTERNS.some((pattern) => pattern.test(combined)) ||
    titlePipeCount >= 2
  );
}

function shouldKeepNotebookLmPublicationItem(
  source: NotebookLmPacketDraft["source"],
  item: NotebookLmPacketItem,
) {
  const strippedBody = stripLeadingNewswireDateline(item.body);
  const relevance = explainRelevanceDecision(source, item.title, strippedBody);
  const storyText = `${item.title}\n${strippedBody}`;

  if (!relevance.passes) {
    return false;
  }

  if (!hasNotebookLmExplicitEthiopiaContext(storyText)) {
    return false;
  }

  if (looksLikeMixedRoundupItem(item)) {
    return false;
  }

  return true;
}

export function createUploadReadyPacketDraft(packet: NotebookLmPacketDraft): NotebookLmPacketDraft {
  return {
    ...packet,
    items: dedupeNotebookLmPacketStories(
      packet.items
        .filter((item) => isNotebookLmSourcePublicationItem(item))
        .map((item) => ({
          ...item,
          body: sanitizeNotebookLmPublicationBody(item.body),
        }))
        .filter((item) => item.body.length > 0)
        .filter((item) => shouldKeepNotebookLmPublicationItem(packet.source, item)),
    ),
  };
}

function hasExhaustiveSourceCoverage(packet: NotebookLmPacketDraft | undefined) {
  return packet?.coverageExhausted === true;
}

function shouldSkipSourceForWeeklyDeepDive(packet: NotebookLmPacketDraft | undefined) {
  if (!packet) {
    return false;
  }

  return (
    ((packet.source === "VOA Amharic" &&
      packet.items.length === 0 &&
      packet.coverageExhausted === true &&
      packet.weeklySourceCheck?.status === "no-current-items-found") ||
      (packet.source === "Addis Standard" &&
        packet.items.length === 0 &&
        packet.coverageExhausted === true))
  );
}

export function evaluateNotebookLmSourceComprehensiveness(
  packetDrafts: NotebookLmPacketDraft[],
  scope: NotebookLmPodcastScope = "weekly",
): NotebookLmSourceQualityReport {
  const config = getNotebookLmScopeConfig(scope);
  const skippedInactiveSources = packetDrafts
    .filter((packet) => shouldSkipSourceForWeeklyDeepDive(packet))
    .map((packet) => packet.source);
  const effectivePacketDrafts = packetDrafts.filter(
    (packet) => !shouldSkipSourceForWeeklyDeepDive(packet),
  );
  const packetBySource = new Map<SourceName, NotebookLmPacketDraft>(
    effectivePacketDrafts.map((packet) => [packet.source, packet]),
  );
  const nonEmptyPackets = effectivePacketDrafts.filter((packet) => packet.items.length > 0);
  const totalItems = nonEmptyPackets.reduce(
    (total, packet) => total + packet.items.length,
    0,
  );
  const richPackets = nonEmptyPackets.filter((packet) =>
    packet.items.some(
      (item) => isRichNotebookLmItem(item) && item.body.trim().length >= 180,
    ),
  );
  const fullArticlePackets = nonEmptyPackets.filter((packet) =>
    packet.items.some((item) => item.captureKind === "full-article"),
  );
  const densePackets = nonEmptyPackets.filter((packet) => {
    const recoveredCharacters = packet.items.reduce((total, item) => {
      if (!isRichNotebookLmItem(item)) {
        return total;
      }

      return total + item.body.trim().length;
    }, 0);

    return recoveredCharacters >= config.minRichCharacters;
  });

  const issues: string[] = [];
  const verifiedSparseSources: string[] = [];
  const missingPacketDrafts = effectivePacketDrafts.filter(
    (packet) => packet.items.length === 0,
  );

  if (totalItems < config.minTotalItems) {
    issues.push(
      `Need at least ${config.minTotalItems} ${config.sourceCountUnitLabel}; only ${totalItems} were recovered.`,
    );
  }

  if (richPackets.length < config.minRichPackets) {
    issues.push(
      `Need at least ${config.minRichPackets} sources with recovered article or official-social text; only ${richPackets.length} qualified.`,
    );
  }

  if (fullArticlePackets.length < config.minFullArticlePackets) {
    issues.push(
      `Need at least ${config.minFullArticlePackets} sources with recovered full-article text; only ${fullArticlePackets.length} qualified.`,
    );
  }

  if (densePackets.length < config.minRichPackets) {
    issues.push(
      `Need at least ${config.minRichPackets} source packets with substantial recovered text; only ${densePackets.length} qualified.`,
    );
  }

  for (const [source, minimum] of Object.entries(config.minItemsPerSource) as Array<
    [SourceName, number]
  >) {
    if (skippedInactiveSources.includes(source)) {
      continue;
    }

    const packet = packetBySource.get(source);
    const recoveredCount = packet?.items.length ?? 0;

    if (recoveredCount < minimum) {
      if (hasExhaustiveSourceCoverage(packet)) {
        verifiedSparseSources.push(
          `${source} (${recoveredCount}/${minimum} items after exhausting official surfaces)`,
        );
      } else {
        issues.push(
          `${source} needs at least ${minimum} recovered items in this coverage window; only ${recoveredCount} were recovered.`,
        );
      }
    }
  }

  const canTreatThreePacketWeekAsComprehensive =
    nonEmptyPackets.length >= 3 &&
    missingPacketDrafts.every((packet) => hasExhaustiveSourceCoverage(packet)) &&
    totalItems >= config.minTotalItems &&
    richPackets.length >= config.minRichPackets &&
    fullArticlePackets.length >= config.minFullArticlePackets &&
    densePackets.length >= config.minRichPackets;

  if (
    nonEmptyPackets.length < config.minNonEmptyPackets &&
    !canTreatThreePacketWeekAsComprehensive
  ) {
    issues.unshift(
      `Need at least ${config.minNonEmptyPackets} non-empty source packets; only ${nonEmptyPackets.length} were recovered.`,
    );
  }

  const isComprehensive = issues.length === 0;
  const skippedSourceSummary =
    skippedInactiveSources.length > 0
      ? scope === "recent"
        ? ` Temporarily skipped sources without recoverable source-authored text in this coverage window: ${skippedInactiveSources.join("; ")}.`
        : ` Temporarily skipped sources without recoverable source-authored current-week text this week: ${skippedInactiveSources.join("; ")}.`
      : "";
  const summary = isComprehensive
    ? `${config.confirmedSummaryPrefix}: ${nonEmptyPackets.length} non-empty sources and ${totalItems} ${config.sourceCountUnitLabel} passed the deep-dive preflight.${verifiedSparseSources.length > 0 ? ` Verified sparse official sources: ${verifiedSparseSources.join("; ")}.` : ""}${skippedSourceSummary}`
    : `${config.blockedSummaryPrefix} ${issues.join(" ")}${skippedSourceSummary}`;

  return {
    isComprehensive,
    totalItems,
    nonEmptyPacketCount: nonEmptyPackets.length,
    richPacketCount: richPackets.length,
    fullArticlePacketCount: fullArticlePackets.length,
    issues,
    verifiedSparseSources,
    skippedInactiveSources,
    summary,
  };
}

async function ensureNotebookLmDirectories() {
  await mkdir(NOTEBOOKLM_DIRECTORY, { recursive: true });
  await mkdir(NOTEBOOKLM_PROFILE_DIRECTORY, { recursive: true });
  await mkdir(NOTEBOOKLM_SOURCE_DIRECTORY, { recursive: true });
  await mkdir(NOTEBOOKLM_AUDIT_DIRECTORY, { recursive: true });
  await mkdir(NOTEBOOKLM_AUDIO_DIRECTORY, { recursive: true });
  await mkdir(NOTEBOOKLM_DEBUG_DIRECTORY, { recursive: true });
}

async function loadReusableNotebookRecord() {
  try {
    const raw = await readFile(NOTEBOOKLM_REUSABLE_NOTEBOOK_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<NotebookLmReusableNotebookRecord>;

    if (
      typeof parsed?.notebookTitle !== "string" ||
      typeof parsed?.notebookUrl !== "string" ||
      !parsed.notebookUrl.trim()
    ) {
      return null;
    }

    return {
      notebookTitle: parsed.notebookTitle,
      notebookUrl: parsed.notebookUrl,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    } satisfies NotebookLmReusableNotebookRecord;
  } catch {
    return null;
  }
}

function resolveReusableNotebookUrl(
  currentState: NotebookLmPodcastState,
  reusableNotebook: NotebookLmReusableNotebookRecord | null,
  requestedNotebookTitle: string,
) {
  if (reusableNotebook?.notebookUrl) {
    return reusableNotebook.notebookUrl;
  }

  if (
    currentState.notebookUrl &&
    currentState.notebookTitle === requestedNotebookTitle
  ) {
    return currentState.notebookUrl;
  }

  return null;
}

async function writeJsonAtomically(filePath: string, tempPath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify(value, null, 2);
  await writeFile(tempPath, payload, "utf8");

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;
    if (code !== "EPERM" && code !== "EBUSY") {
      throw error;
    }

    await writeFile(filePath, payload, "utf8");
    await unlink(tempPath).catch(() => undefined);
  }
}

async function loadStoredState(
  scope: NotebookLmPodcastScope,
): Promise<NotebookLmPodcastState> {
  try {
    const raw = await readFile(getNotebookLmStatePath(scope), "utf8");
    const parsed = JSON.parse(raw) as unknown;

    const normalizedState = normalizeNotebookLmStoredState(parsed, scope);
    if (!normalizedState) {
      return createEmptyState(scope);
    }

    return normalizedState;
  } catch {
    return createEmptyState(scope);
  }
}

function buildPreparedRequestCoverageFingerprint(args: {
  brief: WeeklyBrief;
  lastSuccessfulRefreshAt: string | null;
  sourceResults: SourceFetchResult[];
}) {
  const hash = createHash("sha256");
  hash.update(args.lastSuccessfulRefreshAt ?? "none");
  hash.update(args.brief.windowStart);
  hash.update(args.brief.windowEnd);
  hash.update(args.brief.generatedAt ?? "none");

  for (const sourceResult of [...args.sourceResults].sort((left, right) =>
    left.source.localeCompare(right.source),
  )) {
    hash.update(sourceResult.source);

    for (const item of sourceResult.items) {
      hash.update(item.title);
      hash.update(item.publishedAt);
      hash.update(item.url ?? "");
      hash.update(item.snippet ?? "");
    }
  }

  return hash.digest("hex").slice(0, 24);
}

async function loadPreparedRequestFromCache(
  coverageFingerprint: string,
  scope: NotebookLmPodcastScope,
): Promise<NotebookLmPreparedRequest | null> {
  try {
    const raw = await readFile(getNotebookLmPreparedRequestPath(scope), "utf8");
    const parsed = JSON.parse(raw) as StoredPreparedRequest;

    if (
      parsed?.schemaVersion !== NOTEBOOKLM_PREPARED_REQUEST_SCHEMA_VERSION ||
      parsed?.coverageFingerprint !== coverageFingerprint ||
      !parsed.request
    ) {
      return null;
    }

    return parsed.request;
  } catch {
    return null;
  }
}

async function loadPreparedRequestSnapshot(scope: NotebookLmPodcastScope) {
  try {
    const raw = await readFile(getNotebookLmPreparedRequestPath(scope), "utf8");
    const parsed = JSON.parse(raw) as StoredPreparedRequest;

    if (
      parsed?.schemaVersion !== NOTEBOOKLM_PREPARED_REQUEST_SCHEMA_VERSION ||
      !parsed.request
    ) {
      return null;
    }

    return parsed.request;
  } catch {
    return null;
  }
}

async function savePreparedRequestToCache(
  request: NotebookLmPreparedRequest,
  scope: NotebookLmPodcastScope,
) {
  const payload: StoredPreparedRequest = {
    schemaVersion: NOTEBOOKLM_PREPARED_REQUEST_SCHEMA_VERSION,
    coverageFingerprint: request.coverageFingerprint,
    request,
    savedAt: new Date().toISOString(),
  };

  await writeJsonAtomically(
    getNotebookLmPreparedRequestPath(scope),
    getNotebookLmPreparedRequestTempPath(scope),
    payload,
  );
}

async function saveStoredState(
  state: NotebookLmPodcastState,
  scope: NotebookLmPodcastScope,
) {
  await ensureNotebookLmDirectories();
  await writeJsonAtomically(
    getNotebookLmStatePath(scope),
    getNotebookLmStateTempPath(scope),
    state,
  );
}

function filterItemsForBriefWindow(
  items: Array<{
    source: string;
    title: string;
    url: string | null;
    publishedAt: string;
    snippet: string;
    topicTags: string[];
    matchedKeywords: string[];
    section: string;
    language: string;
  }>,
  brief: WeeklyBrief,
) {
  const windowStart = new Date(brief.windowStart).getTime();
  const windowEnd = new Date(brief.windowEnd).getTime();

  return items.filter((item) => {
    const publishedAt = new Date(item.publishedAt).getTime();

    if (!Number.isFinite(publishedAt)) {
      return false;
    }

    return publishedAt >= windowStart && publishedAt <= windowEnd;
  });
}

function getLatestCoveragePublicationTime(sourceResults: SourceFetchResult[]) {
  const timestamps = sourceResults.flatMap((result) =>
    result.items
      .map((item) => new Date(item.publishedAt).getTime())
      .filter((value) => Number.isFinite(value)),
  );

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

function startOfUtcDay(timestamp: number) {
  const value = new Date(timestamp);
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    0,
    0,
    0,
    0,
  );
}

function endOfUtcDay(timestamp: number) {
  const value = new Date(timestamp);
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    23,
    59,
    59,
    999,
  );
}

function buildRecentBrief(
  payload: ReturnType<typeof normalizeDashboardPayload>,
  sourceResults: SourceFetchResult[],
  generatedAt: string,
): WeeklyBrief {
  const latestPublicationTime =
    getLatestCoveragePublicationTime(sourceResults) ??
    (payload.latestPublication.publishedAt
      ? new Date(payload.latestPublication.publishedAt).getTime()
      : NaN);

  if (!Number.isFinite(latestPublicationTime)) {
    return {
      ...payload.weeklyBrief,
      status: "unavailable",
      generatedAt,
      windowStart: "",
      windowEnd: "",
      headline: "Last two days audio unavailable",
      summary:
        "Refresh coverage to prepare a NotebookLM audio briefing for the most recent two days.",
      keyPoints: [],
      sourceDifferences: [],
      watchList: [],
      note: "No recent publication timestamps were available in the current coverage snapshot.",
      model: null,
      sourceCount: 0,
      storylineCount: 0,
    };
  }

  const windowEndTimestamp = endOfUtcDay(latestPublicationTime);
  const windowStartTimestamp = startOfUtcDay(windowEndTimestamp - 24 * 60 * 60 * 1000);
  const windowStart = new Date(windowStartTimestamp).toISOString();
  const windowEnd = new Date(windowEndTimestamp).toISOString();
  const windowItems = filterItemsForBriefWindow(
    sourceResults.flatMap((result) => result.items),
    {
      ...payload.weeklyBrief,
      windowStart,
      windowEnd,
    },
  );
  const windowSources = new Set(windowItems.map((item) => item.source));

  return {
    ...payload.weeklyBrief,
    status: windowItems.length > 0 ? "ready" : "unavailable",
    generatedAt,
    windowStart,
    windowEnd,
    headline: "Last two days Ethiopia coverage",
    summary:
      "A shorter Ethiopia News Watch audio briefing focused on the most recent two calendar days inside the current weekly reporting window.",
    keyPoints: [],
    sourceDifferences: [],
    watchList: [],
    note:
      windowItems.length > 0
        ? "Built from the latest two calendar days of reporting already collected by the dashboard."
        : "No verified source items were available inside the latest two-day window.",
    model: null,
    sourceCount: windowSources.size,
    storylineCount: payload.storylines.filter((storyline) => {
      const updatedAt = new Date(storyline.updatedAt).getTime();
      return (
        Number.isFinite(updatedAt) &&
        updatedAt >= windowStartTimestamp &&
        updatedAt <= windowEndTimestamp
      );
    }).length,
  };
}

function buildPodcastBrief(
  scope: NotebookLmPodcastScope,
  payload: ReturnType<typeof normalizeDashboardPayload>,
  sourceResults: SourceFetchResult[],
  generatedAt: string,
) {
  if (scope === "recent") {
    return buildRecentBrief(payload, sourceResults, generatedAt);
  }

  return payload.weeklyBrief;
}

async function loadCoverageSummary(scope: NotebookLmPodcastScope) {
  const persistedCoverage = await loadPersistedCoverageState();

  if (!persistedCoverage) {
    return {
      canGenerate: false,
      brief: null,
      sourceCount: 0,
      packetCount: 0,
      sourceLabel: "No source packets prepared yet.",
      lastSuccessfulRefreshAt: null,
    } satisfies NotebookLmCoverageSummary;
  }

  const payload = normalizeDashboardPayload(persistedCoverage.payload);
  const brief = buildPodcastBrief(
    scope,
    payload,
    persistedCoverage.sourceResults,
    persistedCoverage.lastSuccessfulRefreshAt || payload.generatedAt || new Date().toISOString(),
  );
  const windowedItems = filterItemsForBriefWindow(
    persistedCoverage.sourceResults.flatMap((result) => result.items),
    brief,
  );
  const packetCount = new Set(windowedItems.map((item) => item.source)).size;

  return {
    canGenerate: windowedItems.length > 0,
    brief,
    sourceCount: windowedItems.length,
    packetCount,
    sourceLabel:
      windowedItems.length > 0
        ? formatSourceCountLabel(windowedItems.length, packetCount)
        : "No source packets prepared yet.",
    lastSuccessfulRefreshAt: persistedCoverage.lastSuccessfulRefreshAt,
  } satisfies NotebookLmCoverageSummary;
}

function buildCoverageSummaryFromRequest(request: NotebookLmPreparedRequest | null) {
  if (!request) {
    return {
      canGenerate: false,
      brief: null,
      sourceCount: 0,
      packetCount: 0,
      sourceLabel: "No source packets prepared yet.",
      lastSuccessfulRefreshAt: null,
    } satisfies NotebookLmCoverageSummary;
  }

  const sourceCount = request.sourcePackets.reduce(
    (total, packet) => total + packet.itemCount,
    0,
  );

  return {
    canGenerate: sourceCount > 0 && request.sourceQuality.isComprehensive,
    brief: request.brief,
    sourceCount,
    packetCount: request.sourcePackets.length,
    sourceLabel: formatSourceCountLabel(sourceCount, request.sourcePackets.length),
    lastSuccessfulRefreshAt: request.brief.generatedAt || null,
  } satisfies NotebookLmCoverageSummary;
}

function sortNotebookLmPacketItemsNewestFirst(items: NotebookLmPacketItem[]) {
  return items.slice().sort((left, right) => {
    return (
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
    );
  });
}

interface NotebookLmSourceProfile {
  profile: string;
  relevance: string;
}

interface NotebookLmPlatformSection {
  description?: string;
  key: string;
  label: string;
  order: number;
}

const NOTEBOOKLM_SOURCE_PROFILES: Partial<
  Record<SourceName, NotebookLmSourceProfile>
> = {
  "Addis Standard": {
    profile:
      "Addis Standard is an independent Ethiopian publication that publishes in English, Amharic, and Afaan Oromoo and focuses on public-interest reporting.",
    relevance:
      "It matters here as one of the better-known independent voices in Ethiopia's media space, especially for accountability, politics, conflict, and public-interest framing outside state media.",
  },
  "The Reporter Ethiopia": {
    profile:
      "The Reporter Ethiopia is a long-running private Ethiopian newspaper that publishes in English and Amharic and covers politics, business, regulation, and public affairs.",
    relevance:
      "It matters here because it contributes established newspaper reporting with strong business, policy, and regulatory coverage that often complements or counters official messaging.",
  },
  "Ethiopia Insight": {
    profile:
      "Ethiopia Insight is an independent English-language outlet centered on long-form reporting, analysis, and commentary about Ethiopian politics and the Horn of Africa.",
    relevance:
      "It matters here because it often supplies deeper analytical framing on conflict, governance, and political change than daily wire-style reporting.",
  },
  ENA: {
    profile:
      "ENA, the Ethiopian News Agency, is Ethiopia's official national wire service and a major channel for government and institutional news.",
    relevance:
      "It matters here because it captures the official state-facing narrative, public statements, and institutional updates that other outlets may frame differently.",
  },
  NEBE: {
    profile:
      "NEBE, the National Election Board of Ethiopia, is the country's election management body rather than a conventional newsroom.",
    relevance:
      "It matters here because its official releases provide the primary procedural and institutional record for Ethiopian election administration.",
  },
  "VOA Amharic": {
    profile:
      "VOA Amharic is the Amharic-language service of Voice of America for audiences in Ethiopia, Eritrea, and the diaspora.",
    relevance:
      "It matters here because it provides an external broadcaster's framing and can surface stories and broadcasts beyond the domestic Ethiopian media ecosystem.",
  },
};

const NOTEBOOKLM_LANGUAGE_PATH_SEGMENTS = new Set([
  "am",
  "amh",
  "amharic",
  "en",
  "eng",
  "english",
  "or",
  "oro",
  "oromo",
  "oromiffa",
  "afaan-oromoo",
  "afaan-oromo",
  "web",
  "w",
]);

const NOTEBOOKLM_DUPLICATE_MATCH_STOPWORDS = new Set([
  "about",
  "across",
  "after",
  "against",
  "ambassador",
  "announces",
  "board",
  "country",
  "election",
  "elections",
  "ethiopia",
  "ethiopian",
  "federal",
  "government",
  "minister",
  "ministry",
  "national",
  "news",
  "official",
  "region",
  "regional",
  "said",
  "says",
  "state",
  "update",
]);

const NOTEBOOKLM_TRANSLATION_CAPTURE_NOTE_PATTERN =
  /\btranslated (?:into english|from)\b/i;

function normalizeNotebookLmStoryText(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingNewswireDateline(value: string) {
  return value.replace(/^[A-Z][^\n]{0,140}\([A-Z]{2,12}\)\s*[—-]\s*/u, "");
}

function normalizeNotebookLmStoryUrl(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const normalizedSegments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase())
      .map((segment) =>
        segment.replace(
          /^(?:am|amh|amharic|en|eng|english|or|oro|oromo|oromiffa|afaan-oromoo|afaan-oromo)_/i,
          "",
        ),
      )
      .filter((segment) => !NOTEBOOKLM_LANGUAGE_PATH_SEGMENTS.has(segment))
      .filter(Boolean);

    return `${host}/${normalizedSegments.join("/")}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isTranslatedNotebookLmItem(item: NotebookLmPacketItem) {
  return (
    item.captureKind === "translated-transcript" ||
    NOTEBOOKLM_TRANSLATION_CAPTURE_NOTE_PATTERN.test(item.captureNote ?? "")
  );
}

function getNotebookLmStoryTokenSet(value: string) {
  return new Set(
    normalizeNotebookLmStoryText(value)
      .split(" ")
      .filter((token) => token.length >= 4)
      .filter((token) => !NOTEBOOKLM_DUPLICATE_MATCH_STOPWORDS.has(token)),
  );
}

function getNotebookLmTokenOverlapRatio(left: string, right: string) {
  const leftTokens = getNotebookLmStoryTokenSet(left);
  const rightTokens = getNotebookLmStoryTokenSet(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function shareNotebookLmCanonicalUrl(
  left: NotebookLmPacketItem,
  right: NotebookLmPacketItem,
) {
  const leftUrl = normalizeNotebookLmStoryUrl(left.url);
  const rightUrl = normalizeNotebookLmStoryUrl(right.url);

  if (!leftUrl || !rightUrl) {
    return false;
  }

  if (leftUrl === rightUrl) {
    return true;
  }

  const leftLeaf = leftUrl.split("/").pop() ?? "";
  const rightLeaf = rightUrl.split("/").pop() ?? "";
  if (!leftLeaf || !rightLeaf) {
    return false;
  }

  if (leftLeaf === rightLeaf) {
    return true;
  }

  const leftNumericId = leftLeaf.match(/(\d{5,})$/)?.[1] ?? null;
  const rightNumericId = rightLeaf.match(/(\d{5,})$/)?.[1] ?? null;
  return Boolean(leftNumericId && rightNumericId && leftNumericId === rightNumericId);
}

function getNotebookLmCapturePriority(item: NotebookLmPacketItem) {
  switch (item.captureKind) {
    case "full-article":
      return 5;
    case "translated-transcript":
      return 4;
    case "rss-excerpt":
      return 3;
    case "mirror-excerpt":
      return 2;
    case "social-post":
      return 1;
    default:
      return 0;
  }
}

function getNotebookLmPlatformPriority(item: NotebookLmPacketItem) {
  const url = item.url?.toLowerCase() ?? "";

  if (item.captureKind === "translated-transcript") {
    return 5;
  }

  if (
    item.captureKind === "full-article" ||
    (/ena\.et|thereporterethiopia\.com|ethiopia-insight\.com|nebe\.org\.et|voanews\.com|voa(news)?\.com|addisstandard\.com/i.test(
      url,
    ) &&
      !/t\.me|x\.com|twitter\.com|youtube\.com|youtu\.be|instagram\.com/i.test(url))
  ) {
    return 4;
  }

  if (item.captureKind === "rss-excerpt") {
    return 3;
  }

  if (item.captureKind === "mirror-excerpt") {
    return 2;
  }

  if (/facebook\.com/i.test(url)) {
    return 1.9;
  }

  if (/t\.me\//i.test(url)) {
    return 1.8;
  }

  return 1;
}

function getNotebookLmOriginalTextPriority(item: NotebookLmPacketItem) {
  return isTranslatedNotebookLmItem(item) ? 0 : 1;
}

function compareNotebookLmStoryQuality(
  left: NotebookLmPacketItem,
  right: NotebookLmPacketItem,
) {
  return (
    getNotebookLmCapturePriority(right) - getNotebookLmCapturePriority(left) ||
    getNotebookLmPlatformPriority(right) - getNotebookLmPlatformPriority(left) ||
    getNotebookLmOriginalTextPriority(right) -
      getNotebookLmOriginalTextPriority(left) ||
    right.body.length - left.body.length ||
    new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
  );
}

function isLikelySameNetworkStory(
  left: NotebookLmPacketItem,
  right: NotebookLmPacketItem,
) {
  if (shareNotebookLmCanonicalUrl(left, right)) {
    return true;
  }

  const leftTitle = normalizeNotebookLmStoryText(left.title);
  const rightTitle = normalizeNotebookLmStoryText(right.title);

  if (!leftTitle || !rightTitle) {
    return false;
  }

  const titleMatch =
    leftTitle === rightTitle ||
    (Math.min(leftTitle.length, rightTitle.length) >= 28 &&
      (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)));

  if (!titleMatch) {
    return false;
  }

  const leftTime = new Date(left.publishedAt).getTime();
  const rightTime = new Date(right.publishedAt).getTime();
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    Math.abs(leftTime - rightTime) > 3 * 24 * 60 * 60 * 1000
  ) {
    return false;
  }

  const leftBody = normalizeNotebookLmStoryText(left.body);
  const rightBody = normalizeNotebookLmStoryText(right.body);

  if (!leftBody || !rightBody) {
    return titleMatch;
  }

  const leftPrefix = leftBody.slice(0, 160);
  const rightPrefix = rightBody.slice(0, 160);
  if (
    leftPrefix === rightPrefix ||
    leftBody.includes(rightPrefix.slice(0, 80)) ||
    rightBody.includes(leftPrefix.slice(0, 80))
  ) {
    return true;
  }

  if (!isTranslatedNotebookLmItem(left) && !isTranslatedNotebookLmItem(right)) {
    return false;
  }

  const titleOverlap = getNotebookLmTokenOverlapRatio(left.title, right.title);
  if (titleOverlap < 0.72) {
    return false;
  }

  const bodyOverlap = getNotebookLmTokenOverlapRatio(left.body, right.body);
  return bodyOverlap >= 0.58;
}

function dedupeNotebookLmPacketStories(items: NotebookLmPacketItem[]) {
  const preferred: NotebookLmPacketItem[] = [];

  for (const item of items.slice().sort(compareNotebookLmStoryQuality)) {
    const duplicateIndex = preferred.findIndex((candidate) =>
      isLikelySameNetworkStory(candidate, item),
    );

    if (duplicateIndex === -1) {
      preferred.push(item);
      continue;
    }

    if (
      compareNotebookLmStoryQuality(preferred[duplicateIndex], item) > 0
    ) {
      preferred[duplicateIndex] = item;
    }
  }

  return sortNotebookLmPacketItemsNewestFirst(preferred);
}

function buildNotebookLmPlatformSection(
  item: NotebookLmPacketItem,
): NotebookLmPlatformSection {
  const url = item.url?.toLowerCase() ?? "";

  if (item.captureKind === "translated-transcript") {
    return {
      key: "official-audio",
      label: "Official audio transcripts",
      order: 2,
    };
  }

  if (/t\.me\//i.test(url)) {
    return {
      key: "telegram",
      label: "Official Telegram posts",
      order: 5,
    };
  }

  if (/facebook\.com/i.test(url)) {
    return {
      key: "facebook",
      label: "Official Facebook posts",
      order: 4,
    };
  }

  if (/x\.com|twitter\.com/i.test(url)) {
    return {
      key: "x",
      label: "Official X posts",
      order: 5,
    };
  }

  if (/youtube\.com|youtu\.be/i.test(url)) {
    return {
      key: "youtube",
      label: "Official YouTube posts",
      order: 6,
    };
  }

  if (/instagram\.com/i.test(url)) {
    return {
      key: "instagram",
      label: "Official Instagram posts",
      order: 7,
    };
  }

  if (item.captureKind === "rss-excerpt") {
    return {
      key: "rss",
      label: "Official feed excerpts",
      order: 3,
    };
  }

  if (item.captureKind === "mirror-excerpt") {
    return {
      key: "indexed-excerpt",
      label: "Indexed source excerpts",
      order: 8,
    };
  }

  return {
    key: "official-website",
    label: "Official website publications",
    order: 1,
  };
}

export function buildSourcePacketContent(
  source: string,
  items: NotebookLmPacketItem[],
) {
  if (items.length === 0) {
    return "";
  }

  const sourceProfile =
    NOTEBOOKLM_SOURCE_PROFILES[source as SourceName] ?? {
      profile:
        `${source} is one of the sources tracked for Ethiopia News Watch in this coverage window.`,
      relevance:
        "It matters here because it contributes a distinct source perspective to the weekly Ethiopia coverage packet.",
    };
  const groupedSections = new Map<
    string,
    {
      section: NotebookLmPlatformSection;
      items: NotebookLmPacketItem[];
    }
  >();

  for (const item of items) {
    const section = buildNotebookLmPlatformSection(item);
    const current = groupedSections.get(section.key);

    if (current) {
      current.items.push(item);
      continue;
    }

    groupedSections.set(section.key, {
      section,
      items: [item],
    });
  }

  const lines = [
    `# ${source}`,
    "",
    `Outlet profile: ${sourceProfile.profile}`,
    `Why this outlet matters in Ethiopian media: ${sourceProfile.relevance}`,
    "",
  ];

  const sections = [...groupedSections.values()].sort(
    (left, right) => left.section.order - right.section.order,
  );

  for (const { section, items: sectionItems } of sections) {
    lines.push(`## ${section.label}`);
    if (section.description) {
      lines.push(section.description);
      lines.push("");
    }

    sectionItems.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${item.title}`);
      lines.push(`Platform: ${section.label}`);
      lines.push(`Language: ${item.language}`);
      lines.push(`Published: ${formatPacketDateTime(item.publishedAt)}`);
      if (item.url) {
        lines.push(`URL: ${item.url}`);
      }
      lines.push("");
      lines.push(item.body);
      lines.push("");
    });
  }

  return lines.join("\n").trim();
}

function buildSourceAuditContent(
  source: string,
  brief: WeeklyBrief,
  items: NotebookLmPacketItem[],
  diagnostics: string[],
  checkedSurfaces: string[] = [],
  weeklySourceCheck: NotebookLmWeeklySourceCheck | null = null,
  weeklyUploadCheck: NotebookLmWeeklyUploadCheck | null = null,
) {
  const lines = [
    `# Ethiopia News Watch source audit`,
    "",
    `Source: ${source}`,
    `Coverage window: ${formatNotebookDate(brief.windowStart)} to ${formatNotebookDate(brief.windowEnd)}`,
    `Uploadable source-authored items: ${items.length}`,
    "",
  ];

  if (diagnostics.length > 0) {
    lines.push("Extraction notes:");
    diagnostics.forEach((diagnostic) => {
      lines.push(`- ${diagnostic}`);
    });
    lines.push("");
  }

  if (checkedSurfaces.length > 0) {
    lines.push("Official surfaces checked:");
    checkedSurfaces.forEach((surface) => {
      lines.push(`- ${surface}`);
    });
    lines.push("");
  }

  if (weeklySourceCheck) {
    lines.push("Weekly source check:");
    lines.push(`- Summary: ${weeklySourceCheck.summary}`);
    lines.push(`- Method: ${weeklySourceCheck.method}`);
    lines.push(`- Status: ${weeklySourceCheck.status}`);
    lines.push("");
  }

  if (weeklyUploadCheck) {
    lines.push("Weekly upload check:");
    lines.push(`- Summary: ${weeklyUploadCheck.summary}`);
    lines.push(`- Method: ${weeklyUploadCheck.method}`);
    lines.push("");
  }

  items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.title}`);
    lines.push(`Published: ${formatPacketDateTime(item.publishedAt)}`);
    lines.push(`Capture: ${formatCaptureKindLabel(item.captureKind)}`);
    if (item.url) {
      lines.push(`URL: ${item.url}`);
    }
    if (item.captureNote) {
      lines.push(`Capture note: ${item.captureNote}`);
    }
    if (item.recencyNote) {
      lines.push(`Recency verification: ${item.recencyNote}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

export async function buildNotebookLmPreparedRequest(
  scope: NotebookLmPodcastScope,
  options?: BuildPreparedRequestOptions,
): Promise<NotebookLmPreparedRequest | null> {
  if (options?.forceCoverageRefresh) {
    await getDashboardPayload({ force: true });
  }

  const persistedCoverage = await loadPersistedCoverageState();

  if (!persistedCoverage) {
    return null;
  }

  const payload = normalizeDashboardPayload(persistedCoverage.payload);
  const brief = buildPodcastBrief(
    scope,
    payload,
    persistedCoverage.sourceResults,
    persistedCoverage.lastSuccessfulRefreshAt || payload.generatedAt || new Date().toISOString(),
  );
  const coverageFingerprint = buildPreparedRequestCoverageFingerprint({
    brief,
    lastSuccessfulRefreshAt: persistedCoverage.lastSuccessfulRefreshAt,
    sourceResults: persistedCoverage.sourceResults,
  });

  const windowedItems = filterItemsForBriefWindow(
    persistedCoverage.sourceResults.flatMap((result) => result.items),
    brief,
  );

  if (windowedItems.length === 0) {
    return null;
  }

  const cachedRequest = await loadPreparedRequestFromCache(
    coverageFingerprint,
    scope,
  );
  if (cachedRequest) {
    return cachedRequest;
  }

  const notebookTitle = buildNotebookTitle(brief, scope);
  const prompt = buildNotebookLmPodcastPrompt(brief, scope);
  const jobHash = createHash("sha256");
  jobHash.update(prompt);
  const rawPacketDrafts = await buildNotebookLmSourcePackets(
    brief,
    persistedCoverage.sourceResults,
  );
  const packetDrafts = rawPacketDrafts.map((packetDraft) =>
    createUploadReadyPacketDraft(packetDraft),
  );
  const sourceQuality = evaluateNotebookLmSourceComprehensiveness(
    packetDrafts,
    scope,
  );
  const includedPacketDrafts = packetDrafts.filter(
    (packetDraft) => !shouldSkipSourceForWeeklyDeepDive(packetDraft),
  ).filter((packetDraft) => packetDraft.items.length > 0);

  const sourcePackets = includedPacketDrafts
    .slice()
    .sort((left, right) => left.source.localeCompare(right.source))
    .map((packetDraft) => {
      const rawPacketDraft =
        rawPacketDrafts.find((candidate) => candidate.source === packetDraft.source) ??
        packetDraft;
      const content = buildSourcePacketContent(
        packetDraft.source,
        packetDraft.items,
      );
      const auditContent = buildSourceAuditContent(
        rawPacketDraft.source,
        brief,
        rawPacketDraft.items,
        rawPacketDraft.diagnostics,
        rawPacketDraft.checkedSurfaces ?? [],
        rawPacketDraft.weeklySourceCheck ?? null,
        rawPacketDraft.weeklyUploadCheck ?? null,
      );
      const fileName = `${slugify(packetDraft.source)}.md`;
      const auditFileName = `${slugify(packetDraft.source)}-audit.md`;

      jobHash.update(packetDraft.source);
      jobHash.update(content);

      return {
        source: packetDraft.source,
        fileName,
        filePath: "",
        itemCount: packetDraft.items.length,
        content,
        auditFileName,
        auditContent,
        driveDocTitle: buildNotebookLmDriveDocTitle(packetDraft.source, scope),
      };
    });

  if (sourcePackets.every((packet) => packet.itemCount === 0)) {
    return null;
  }

  const request = {
    brief,
    coverageFingerprint,
    jobKey: jobHash.digest("hex").slice(0, 16),
    notebookTitle,
    prompt,
    sourcePackets,
    sourceQuality,
  } satisfies NotebookLmPreparedRequest;

  await savePreparedRequestToCache(request, scope);

  return request;
}

async function materializeSourcePackets(
  request: NotebookLmPreparedRequest,
) {
  await ensureNotebookLmDirectories();

  const packetDirectory = path.join(NOTEBOOKLM_SOURCE_DIRECTORY, request.jobKey);
  const auditDirectory = path.join(NOTEBOOKLM_AUDIT_DIRECTORY, request.jobKey);
  await rm(packetDirectory, { recursive: true, force: true });
  await rm(auditDirectory, { recursive: true, force: true });
  await mkdir(packetDirectory, { recursive: true });
  await mkdir(auditDirectory, { recursive: true });

  const sourcePackets: NotebookLmSourcePacket[] = [];

  for (const packet of request.sourcePackets) {
    const filePath = path.join(packetDirectory, packet.fileName);
    const auditPath = path.join(auditDirectory, packet.auditFileName);
    await writeFile(filePath, packet.content, "utf8");
    await writeFile(auditPath, packet.auditContent, "utf8");
    sourcePackets.push({
      ...packet,
      filePath,
    });
  }

  return sourcePackets;
}

function buildPublicState(
  coverage: NotebookLmCoverageSummary,
  state: NotebookLmPodcastState,
): NotebookLmPodcastPublicState {
  const config = getNotebookLmScopeConfig(state.scope);
  const currentReadyAudio = resolveCurrentReadyAudioArtifact(state);
  const hasCurrentReadyAudio = Boolean(currentReadyAudio);
  const stateTimestamp =
    state.requestedAt ?? state.updatedAt ?? state.completedAt ?? null;
  const stateTime = stateTimestamp ? new Date(stateTimestamp).getTime() : NaN;
  const refreshTime = coverage.lastSuccessfulRefreshAt
    ? new Date(coverage.lastSuccessfulRefreshAt).getTime()
    : NaN;
  const matchesCurrentCoverage =
    Number.isFinite(stateTime) &&
    Number.isFinite(refreshTime) &&
    stateTime >= refreshTime;
  const shouldShowAsStale =
    hasCurrentReadyAudio && coverage.canGenerate && !matchesCurrentCoverage;
  const shouldTreatReadyStateAsBroken =
    state.status === "ready" && !hasCurrentReadyAudio;
  const currentPacketExplicitlyBlocked =
    state.message?.startsWith(
      "Deep dive blocked until the weekly source packet is comprehensive enough.",
    ) ||
    state.message?.startsWith(
      "Recent audio briefing blocked until the last-two-days source packet is comprehensive enough.",
    ) ||
    state.message?.includes(
      "Audio generation will stay blocked until the weekly packet is comprehensive enough.",
    ) ||
    state.error?.includes("Need at least") ||
    false;
  const status = shouldTreatReadyStateAsBroken
    ? "failed"
    : shouldShowAsStale
      ? "stale"
      : state.status;

  return {
    provider: NOTEBOOKLM_PROVIDER,
    scope: state.scope,
    mode: config.mode,
    label: config.label,
    status,
    jobKey: state.jobKey,
    notebookTitle: state.notebookTitle,
    notebookUrl: state.notebookUrl,
    prompt: state.prompt,
    requestedAt: state.requestedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
    windowStart: coverage.brief?.windowStart ?? null,
    windowEnd: coverage.brief?.windowEnd ?? null,
    audioUrl:
      currentReadyAudio
        ? `/api/podcast/audio?scope=${encodeURIComponent(state.scope)}&job=${encodeURIComponent(currentReadyAudio.jobKey)}`
        : null,
    sourceCount: state.sourceCount > 0 ? state.sourceCount : coverage.sourceCount,
    sourceLabel:
      state.sourceCount > 0 ? state.sourceLabel : coverage.sourceLabel,
    message:
      shouldTreatReadyStateAsBroken
        ? "The last NotebookLM run did not finish cleanly, so no fresh podcast audio is available yet."
        : shouldShowAsStale
        ? config.staleMessage
        : state.status === "ready" && hasCurrentReadyAudio && matchesCurrentCoverage
          ? state.scope === "recent"
            ? "Last two days audio episode is ready."
            : "Weekly audio episode is ready."
          : state.status === "running" && hasCurrentReadyAudio
            ? state.scope === "recent"
              ? "A newer two-day NotebookLM run is still in progress. The most recent finished audio remains available below."
              : "A newer weekly NotebookLM run is still in progress. The most recent finished audio remains available below."
          : state.message,
    error: shouldTreatReadyStateAsBroken
      ? state.error ?? "NotebookLM did not confirm a fresh audio download for this job."
      : state.error,
    matchesCurrentCoverage,
    needsSignin: state.needsSignin,
    canGenerate: currentPacketExplicitlyBlocked ? false : coverage.canGenerate,
  };
}

function buildStateFromRequest(
  request: NotebookLmPreparedRequest,
  sourcePackets: NotebookLmSourcePacket[],
  currentState: NotebookLmPodcastState,
  reusableNotebook: NotebookLmReusableNotebookRecord | null,
  scope: NotebookLmPodcastScope,
  operation: NotebookLmWorkerOperation = "generate-audio",
): NotebookLmPodcastState {
  const totalItems = sourcePackets.reduce(
    (total, packet) => total + packet.itemCount,
    0,
  );

  return {
    ...createEmptyState(scope),
    notebookUrl: resolveReusableNotebookUrl(
      currentState,
      reusableNotebook,
      request.notebookTitle,
    ),
    schemaVersion: NOTEBOOKLM_STATE_SCHEMA_VERSION,
    provider: NOTEBOOKLM_PROVIDER,
    scope,
    mode: getNotebookLmScopeConfig(scope).mode,
    status: "queued",
    jobKey: request.jobKey,
    notebookTitle: request.notebookTitle,
    prompt: request.prompt,
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    audioPath: null,
    sourceCount: totalItems,
    sourceLabel: formatSourceCountLabel(totalItems, sourcePackets.length),
    message:
      operation === "sync-sources"
        ? "Refreshing the notebook sources with source-authored publication text only."
        : scope === "recent"
          ? "Preparing the Ethiopia News Watch last two days episode."
          : "Preparing the Ethiopia News Watch weekly episode.",
    error: null,
    needsSignin: false,
  };
}

async function writeJobFile(
  request: NotebookLmPreparedRequest,
  sourcePackets: NotebookLmSourcePacket[],
  currentState: NotebookLmPodcastState,
  reusableNotebook: NotebookLmReusableNotebookRecord | null,
  scope: NotebookLmPodcastScope,
  operation: NotebookLmWorkerOperation = "generate-audio",
) {
  await ensureNotebookLmDirectories();
  const config = getNotebookLmScopeConfig(scope);

  const job: NotebookLmPodcastJob = {
    schemaVersion: NOTEBOOKLM_STATE_SCHEMA_VERSION,
    scope,
    operation,
    jobKey: request.jobKey,
    createdAt: new Date().toISOString(),
    notebookTitle: request.notebookTitle,
    allowLegacyTitleReuse: config.allowLegacyTitleReuse,
    prompt: request.prompt,
    notebookUrl: resolveReusableNotebookUrl(
      currentState,
      reusableNotebook,
      request.notebookTitle,
    ),
    profileDir: NOTEBOOKLM_PROFILE_DIRECTORY,
    debugDir: path.join(NOTEBOOKLM_DEBUG_DIRECTORY, request.jobKey),
    outputAudioPath: path.join(NOTEBOOKLM_AUDIO_DIRECTORY, `${request.jobKey}.m4a`),
    outputAudioProofPath: buildNotebookLmAudioProofPath(request.jobKey, scope),
    statePath: getNotebookLmStatePath(scope),
    sharedNotebookPath: NOTEBOOKLM_REUSABLE_NOTEBOOK_PATH,
    driveSourceIndexPath: getNotebookLmDriveSourceIndexPath(scope),
    browserChannel: NOTEBOOKLM_BROWSER_CHANNEL,
    browserProfileDirectory:
      NOTEBOOKLM_BROWSER_PROFILE_DIRECTORY.trim().length > 0
        ? NOTEBOOKLM_BROWSER_PROFILE_DIRECTORY.trim()
        : null,
    browserHeadless: NOTEBOOKLM_BROWSER_HEADLESS,
    sourceFiles: sourcePackets.map((packet) => ({
      source: packet.source,
      path: packet.filePath,
      itemCount: packet.itemCount,
      driveDocTitle: packet.driveDocTitle,
    })),
  };

  await writeJsonAtomically(
    getNotebookLmJobPath(scope),
    getNotebookLmJobTempPath(scope),
    job,
  );

  return job;
}

function spawnWorker(scope: NotebookLmPodcastScope) {
  const workerPath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "scripts",
    "notebooklm-podcast-worker.mjs",
  );
  const stdoutFd = openSync(getNotebookLmWorkerStdoutPath(scope), "a");
  const stderrFd = openSync(getNotebookLmWorkerStderrPath(scope), "a");
  const worker = spawn(process.execPath, [workerPath, getNotebookLmJobPath(scope)], {
    cwd: /* turbopackIgnore: true */ process.cwd(),
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
    windowsHide: true,
  });

  worker.unref();

  logNewsEvent("info", "notebooklm_podcast_worker_spawned", {
    workerPath,
    pid: worker.pid,
  });
}

async function loadAllStoredStates() {
  const [weekly, recent] = await Promise.all([
    loadStoredState("weekly"),
    loadStoredState("recent"),
  ]);

  return { weekly, recent };
}

function isAnotherScopeRunning(
  scope: NotebookLmPodcastScope,
  states: Awaited<ReturnType<typeof loadAllStoredStates>>,
) {
  return Object.entries(states).some(
    ([candidateScope, state]) =>
      candidateScope !== scope && state.status === "running",
  );
}

export async function getNotebookLmPodcastPublicState(
  scope: NotebookLmPodcastScope = "weekly",
) {
  const [request, fallbackCoverage, state] = await Promise.all([
    loadPreparedRequestSnapshot(scope),
    loadCoverageSummary(scope),
    loadStoredState(scope),
  ]);
  const coverage = request
    ? buildCoverageSummaryFromRequest(request)
    : fallbackCoverage;

  return buildPublicState(coverage, state);
}

export async function startNotebookLmPodcastGeneration(options?: {
  force?: boolean;
  scope?: NotebookLmPodcastScope;
}) {
  const force = options?.force ?? false;
  const scope = options?.scope ?? "weekly";
  const [request, currentState, allStates, reusableNotebook] = await Promise.all([
    buildNotebookLmPreparedRequest(scope, { forceCoverageRefresh: true }),
    loadStoredState(scope),
    loadAllStoredStates(),
    loadReusableNotebookRecord(),
  ]);

  if (!request) {
    const emptyState = {
      ...createEmptyState(scope),
      updatedAt: new Date().toISOString(),
      message:
        scope === "recent"
          ? "Refresh Ethiopia coverage first so the last two days source packets exist for NotebookLM."
          : "Refresh Ethiopia coverage first so the weekly source packets exist for NotebookLM.",
    };
    await saveStoredState(emptyState, scope);

    return {
      state: buildPublicState(
        {
          canGenerate: false,
          brief: null,
          sourceCount: 0,
          packetCount: 0,
          sourceLabel: "No source packets prepared yet.",
          lastSuccessfulRefreshAt: null,
        },
        emptyState,
      ),
      started: false,
      notice:
        scope === "recent"
          ? "Coverage needs to be refreshed before a last-two-days podcast can be prepared."
          : "Coverage needs to be refreshed before a deep-dive podcast can be prepared.",
    };
  }

  const requestCoverage = buildCoverageSummaryFromRequest(request);
  const currentPublicState = buildPublicState(requestCoverage, currentState);

  if (!request.sourceQuality.isComprehensive && !force) {
    const blockedState: NotebookLmPodcastState = {
      ...createEmptyState(scope),
      status: "failed",
      notebookTitle: request.notebookTitle,
      prompt: request.prompt,
      updatedAt: new Date().toISOString(),
      sourceCount: request.sourceQuality.totalItems,
      sourceLabel: formatSourceCountLabel(
        request.sourceQuality.totalItems,
        request.sourcePackets.length,
      ),
      message: request.sourceQuality.summary,
      error: request.sourceQuality.issues.join(" "),
    };
    await saveStoredState(blockedState, scope);

    return {
      state: buildPublicState(requestCoverage, blockedState),
      started: false,
      notice: request.sourceQuality.summary,
    };
  }

  if (
    !force &&
    currentState.jobKey === request.jobKey &&
    (currentState.status === "queued" ||
      currentState.status === "running" ||
      currentState.status === "auth-required")
  ) {
    return {
      state: currentPublicState,
      started: false,
      notice: "The current Google deep-dive generation is already in progress.",
    };
  }

  if (!force && isAnotherScopeRunning(scope, allStates)) {
    return {
      state: currentPublicState,
      started: false,
      notice:
        "Another NotebookLM podcast job is already running. Let it finish before starting a new episode.",
    };
  }

  if (
    !force &&
    currentState.jobKey === request.jobKey &&
    currentState.status === "ready" &&
    currentState.audioPath &&
    existsSync(currentState.audioPath)
  ) {
    return {
      state: currentPublicState,
      started: false,
      notice: "The current Google deep-dive audio overview is already ready.",
    };
  }

  if (
    currentState.status === "running" &&
    currentState.jobKey &&
    currentState.jobKey !== request.jobKey
  ) {
    return {
      state: currentPublicState,
      started: false,
      notice:
        "Another NotebookLM episode generation is still running. Let it finish before starting a new one.",
    };
  }

  const sourcePackets = await materializeSourcePackets(request);
  const nextState = buildStateFromRequest(
    request,
    sourcePackets,
    currentState,
    reusableNotebook,
    scope,
    "generate-audio",
  );
  await saveStoredState(nextState, scope);

  const job = await writeJobFile(
    request,
    sourcePackets,
    currentState,
    reusableNotebook,
    scope,
    "generate-audio",
  );

  if (nextState.audioPath && existsSync(nextState.audioPath)) {
    await unlink(nextState.audioPath).catch(() => undefined);
  }

  if (existsSync(job.outputAudioPath)) {
    await unlink(job.outputAudioPath).catch(() => undefined);
  }

  if (existsSync(job.outputAudioProofPath)) {
    await unlink(job.outputAudioProofPath).catch(() => undefined);
  }

  await mkdir(path.dirname(getNotebookLmWorkerStdoutPath(scope)), { recursive: true });
  await writeFile(
    getNotebookLmWorkerStdoutPath(scope),
    `${new Date().toISOString()} Starting NotebookLM worker for ${request.jobKey}\n`,
    "utf8",
  );
  await writeFile(getNotebookLmWorkerStderrPath(scope), "", "utf8");

  spawnWorker(scope);

  return {
    state: buildPublicState(requestCoverage, nextState),
    started: true,
    notice:
      scope === "recent"
        ? "Last two days episode generation started. A browser window may open if sign-in is required."
        : "Weekly episode generation started. A browser window may open if sign-in is required.",
  };
}

export async function startNotebookLmSourceRepair(options?: {
  force?: boolean;
  scope?: NotebookLmPodcastScope;
}) {
  const force = options?.force ?? false;
  const scope = options?.scope ?? "weekly";
  const [request, currentState, allStates, reusableNotebook] = await Promise.all([
    buildNotebookLmPreparedRequest(scope, { forceCoverageRefresh: true }),
    loadStoredState(scope),
    loadAllStoredStates(),
    loadReusableNotebookRecord(),
  ]);

  if (!request) {
    const emptyState = {
      ...createEmptyState(scope),
      updatedAt: new Date().toISOString(),
      message:
        scope === "recent"
          ? "Refresh Ethiopia coverage first so the last two days source packets exist for NotebookLM source repair."
          : "Refresh Ethiopia coverage first so the weekly source packets exist for NotebookLM source repair.",
    };
    await saveStoredState(emptyState, scope);

    return {
      state: buildPublicState(
        {
          canGenerate: false,
          brief: null,
          sourceCount: 0,
          packetCount: 0,
          sourceLabel: "No source packets prepared yet.",
          lastSuccessfulRefreshAt: null,
        },
        emptyState,
      ),
      started: false,
      notice:
        "Coverage needs to be refreshed before NotebookLM sources can be repaired.",
    };
  }

  const requestCoverage = buildCoverageSummaryFromRequest(request);
  const currentPublicState = buildPublicState(requestCoverage, currentState);

  if (
    !force &&
    isAnotherScopeRunning(scope, allStates)
  ) {
    return {
      state: currentPublicState,
      started: false,
      notice:
        "Another NotebookLM podcast job is already running. Let it finish before starting a source repair.",
    };
  }

  if (
    !force &&
    currentState.status === "running" &&
    currentState.jobKey &&
    currentState.jobKey !== request.jobKey
  ) {
    return {
      state: currentPublicState,
      started: false,
      notice:
        "Another NotebookLM job is still running. Let it finish before starting a source repair.",
    };
  }

  const sourcePackets = await materializeSourcePackets(request);

  if (sourcePackets.length === 0) {
    const blockedState: NotebookLmPodcastState = {
      ...createEmptyState(scope),
      status: "failed",
      notebookTitle: request.notebookTitle,
      prompt: request.prompt,
      updatedAt: new Date().toISOString(),
      sourceCount: 0,
      sourceLabel: "No source-authored packets were available for NotebookLM repair.",
      message:
        scope === "recent"
          ? "NotebookLM source repair could not start because there were no source-authored packets in the latest two-day window to upload."
          : "NotebookLM source repair could not start because there were no source-authored current-week packets to upload.",
      error: "No source-authored packets were available for source repair.",
    };
    await saveStoredState(blockedState, scope);

    return {
      state: buildPublicState(requestCoverage, blockedState),
      started: false,
      notice: blockedState.message ?? "NotebookLM source repair could not start.",
    };
  }

  const nextState = buildStateFromRequest(
    request,
    sourcePackets,
    currentState,
    reusableNotebook,
    scope,
    "sync-sources",
  );
  await saveStoredState(nextState, scope);

  await writeJobFile(
    request,
    sourcePackets,
    currentState,
    reusableNotebook,
    scope,
    "sync-sources",
  );

  await mkdir(path.dirname(getNotebookLmWorkerStdoutPath(scope)), { recursive: true });
  await writeFile(
    getNotebookLmWorkerStdoutPath(scope),
    `${new Date().toISOString()} Starting NotebookLM source repair for ${request.jobKey}\n`,
    "utf8",
  );
  await writeFile(getNotebookLmWorkerStderrPath(scope), "", "utf8");

  spawnWorker(scope);

  return {
    state: buildPublicState(requestCoverage, nextState),
    started: true,
    notice:
      "Source refresh started. The notebook sources will be refreshed with publication text only.",
  };
}

export async function markNotebookLmPodcastStartedFromRefresh() {
  try {
    const result = await startNotebookLmPodcastGeneration({ scope: "weekly" });

    logNewsEvent("info", "notebooklm_podcast_refresh_check", {
      started: result.started,
      status: result.state.status,
      notice: result.notice,
    });
  } catch (error) {
    logNewsEvent("warn", "notebooklm_podcast_refresh_failed", {
      message: error instanceof Error ? error.message : "Unknown podcast error",
    });
  }
}

export async function getNotebookLmCurrentAudioPath(
  scope: NotebookLmPodcastScope = "weekly",
) {
  const state = await loadStoredState(scope);
  return resolveCurrentReadyAudioArtifact(state)?.audioPath ?? null;
}

export async function cloneNotebookLmAudioTo(targetPath: string) {
  const currentAudioPath = await getNotebookLmCurrentAudioPath("weekly");

  if (!currentAudioPath) {
    return null;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(currentAudioPath, targetPath);
  return targetPath;
}

export async function clearNotebookLmPodcastState() {
  await rm(NOTEBOOKLM_DIRECTORY, { recursive: true, force: true });
}

export function getNotebookLmProfileDirectory() {
  return NOTEBOOKLM_PROFILE_DIRECTORY;
}

export function getNotebookLmSetupHint() {
  return `If NotebookLM sign-in is needed, the browser will wait up to ${NOTEBOOKLM_SETUP_TIMEOUT_MINUTES} minutes in the opened window.`;
}

export function shouldTreatPodcastAsFresh(updatedAt: string | null) {
  if (!updatedAt) {
    return false;
  }

  const timestamp = new Date(updatedAt).getTime();

  return Number.isFinite(timestamp) && Date.now() - timestamp <= CACHE_TTL_MS;
}
