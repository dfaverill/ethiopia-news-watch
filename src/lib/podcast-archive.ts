import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { NotebookLmPodcastScope } from "@/lib/notebooklm-podcast";

const DEFAULT_CACHE_DIRECTORY = path.join(process.cwd(), ".cache");
const CACHE_DIRECTORY = process.env.NEWS_WATCH_CACHE_DIR
  ? path.resolve(process.env.NEWS_WATCH_CACHE_DIR)
  : DEFAULT_CACHE_DIRECTORY;
const NOTEBOOKLM_DIRECTORY = path.join(CACHE_DIRECTORY, "notebooklm");
const NOTEBOOKLM_AUDIO_DIRECTORY = path.join(NOTEBOOKLM_DIRECTORY, "audio");
const NOTEBOOKLM_SOURCE_AUDIT_DIRECTORY = path.join(
  NOTEBOOKLM_DIRECTORY,
  "source-audits",
);
const NOTEBOOKLM_WEEKLY_STATE_PATH = path.join(
  NOTEBOOKLM_DIRECTORY,
  "podcast-state.json",
);
const NOTEBOOKLM_RECENT_STATE_PATH = path.join(
  NOTEBOOKLM_DIRECTORY,
  "podcast-state-recent.json",
);
const ELEVENLABS_DIRECTORY = path.join(CACHE_DIRECTORY, "elevenlabs-podcast");
const ELEVENLABS_AUDIO_DIRECTORY = path.join(ELEVENLABS_DIRECTORY, "audio");
const ELEVENLABS_REPORT_DIRECTORY = path.join(ELEVENLABS_DIRECTORY, "reports");
const ELEVENLABS_RECENT_STATE_PATH = path.join(
  ELEVENLABS_DIRECTORY,
  "recent-state.json",
);

type ArchiveProvider = "google-notebooklm" | "elevenlabs";

export interface PodcastArchiveEntry {
  id: string;
  provider: ArchiveProvider;
  section: "weekly" | "recent" | "scriptedRecent";
  scope: NotebookLmPodcastScope;
  jobKey: string;
  label: string;
  savedAt: string | null;
  sourceLabel: string | null;
  headline: string | null;
  theme: string | null;
  audioUrl: string;
  downloadUrl: string;
}

export interface PodcastArchiveCollections {
  weekly: PodcastArchiveEntry[];
  recent: PodcastArchiveEntry[];
  scriptedRecent: PodcastArchiveEntry[];
}

interface PodcastArchiveAudioRecord extends PodcastArchiveEntry {
  audioPath: string;
}

interface NotebookLmArchiveOptions {
  excludeJobKeys?: string[];
}

interface ElevenLabsArchiveOptions {
  excludeJobKeys?: string[];
}

export interface PodcastArchiveExclusions {
  currentNotebookLmJobKeys: Partial<Record<NotebookLmPodcastScope, string | null>>;
  currentElevenLabsJobKey: string | null;
}

const EMPTY_ARCHIVE_COLLECTIONS: PodcastArchiveCollections = {
  weekly: [],
  recent: [],
  scriptedRecent: [],
};

function toPublicArchiveEntry(record: PodcastArchiveAudioRecord): PodcastArchiveEntry {
  const { audioPath, ...entry } = record;
  void audioPath;
  return entry;
}

function compareArchiveRecords(
  left: Pick<PodcastArchiveAudioRecord, "savedAt" | "jobKey">,
  right: Pick<PodcastArchiveAudioRecord, "savedAt" | "jobKey">,
) {
  const savedAtComparison = (right.savedAt ?? "").localeCompare(left.savedAt ?? "");
  if (savedAtComparison !== 0) {
    return savedAtComparison;
  }

  return right.jobKey.localeCompare(left.jobKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function formatWindowLabelFromIso(
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
) {
  if (!windowStart || !windowEnd) {
    return null;
  }

  const start = new Date(windowStart);
  const end = new Date(windowEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return `${formatter.format(start)} to ${formatter.format(end)}`;
}

function buildSavedLabel(savedAt: string | null) {
  if (!savedAt) {
    return "Saved episode";
  }

  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return "Saved episode";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function isDateRangeArchiveLabel(label: string) {
  return /^[A-Z][a-z]{2}\s+\d{1,2}\s+to\s+[A-Z][a-z]{2}\s+\d{1,2}$/.test(
    label.trim(),
  );
}

function formatSourceLabel(packetCount: number, itemCount: number) {
  const packetLabel =
    packetCount === 1 ? "1 source packet" : `${packetCount} source packets`;
  const itemLabel =
    itemCount === 1 ? "1 coverage item" : `${itemCount} coverage items`;

  return `${packetLabel} across ${itemLabel}`;
}

function dedupeArchiveRecordsByLabel(records: PodcastArchiveAudioRecord[]) {
  const dedupedRecords = new Map<string, PodcastArchiveAudioRecord>();

  for (const record of records) {
    if (!isDateRangeArchiveLabel(record.label)) {
      continue;
    }

    const existingRecord = dedupedRecords.get(record.label);

    if (!existingRecord || compareArchiveRecords(record, existingRecord) < 0) {
      dedupedRecords.set(record.label, record);
    }
  }

  return [...dedupedRecords.values()].sort(compareArchiveRecords);
}

function buildNotebookLmAudioUrl(scope: NotebookLmPodcastScope, jobKey: string) {
  const params = new URLSearchParams({
    provider: "google-notebooklm",
    scope,
    jobKey,
  });

  return `/api/podcast/archive/audio?${params.toString()}`;
}

function buildElevenLabsAudioUrl(jobKey: string) {
  const params = new URLSearchParams({
    provider: "elevenlabs",
    scope: "recent",
    jobKey,
  });

  return `/api/podcast/archive/audio?${params.toString()}`;
}

async function safeReadDirectory(directoryPath: string) {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readJsonFile(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readCurrentJobKey(filePath: string) {
  const payload = await readJsonFile(filePath);

  if (!isRecord(payload) || typeof payload.jobKey !== "string" || !payload.jobKey) {
    return null;
  }

  return payload.jobKey;
}

function parseNotebookLmProofName(fileName: string): {
  jobKey: string;
  scope: NotebookLmPodcastScope;
} | null {
  if (!fileName.endsWith(".ready.json")) {
    return null;
  }

  const bareName = fileName.slice(0, -".ready.json".length);
  if (bareName.startsWith("recent-")) {
    return {
      jobKey: bareName.slice("recent-".length),
      scope: "recent",
    };
  }

  if (bareName.startsWith("weekly-")) {
    return {
      jobKey: bareName.slice("weekly-".length),
      scope: "weekly",
    };
  }

  return {
    jobKey: bareName,
    scope: "weekly",
  };
}

async function readNotebookLmCoverageMetadata(jobKey: string) {
  const auditDirectory = path.join(NOTEBOOKLM_SOURCE_AUDIT_DIRECTORY, jobKey);
  const auditEntries = await safeReadDirectory(auditDirectory);

  let coverageWindow: string | null = null;
  let packetCount = 0;
  let itemCount = 0;

  for (const entry of auditEntries) {
    if (!entry.isFile() || !entry.name.endsWith("-audit.md")) {
      continue;
    }

    packetCount += 1;

    try {
      const content = await readFile(path.join(auditDirectory, entry.name), "utf8");

      if (!coverageWindow) {
        const coverageMatch = content.match(/^Coverage window:\s*(.+)$/m);
        if (coverageMatch?.[1]) {
          coverageWindow = coverageMatch[1].trim();
        }
      }

      const itemCountMatch = content.match(
        /^Uploadable source-authored items:\s*(\d+)$/m,
      );
      if (itemCountMatch?.[1]) {
        itemCount += Number.parseInt(itemCountMatch[1], 10);
      }
    } catch {
      continue;
    }
  }

  return {
    coverageWindow,
    sourceLabel:
      packetCount > 0 && itemCount > 0
        ? formatSourceLabel(packetCount, itemCount)
        : null,
  };
}

async function collectNotebookLmArchiveRecords(
  options?: NotebookLmArchiveOptions,
): Promise<PodcastArchiveAudioRecord[]> {
  const excludedJobKeys = new Set(options?.excludeJobKeys ?? []);
  const audioEntries = await safeReadDirectory(NOTEBOOKLM_AUDIO_DIRECTORY);
  const proofEntries = audioEntries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".ready.json"),
  );

  const records = await Promise.all(
    proofEntries.map(async (entry) => {
      const proofPath = path.join(NOTEBOOKLM_AUDIO_DIRECTORY, entry.name);
      const parsedProofName = parseNotebookLmProofName(entry.name);
      if (!parsedProofName) {
        return null;
      }

      const proof = await readJsonFile(proofPath);
      if (!isRecord(proof)) {
        return null;
      }

      const jobKey =
        typeof proof.jobKey === "string" && proof.jobKey.length > 0
          ? proof.jobKey
          : parsedProofName.jobKey;
      if (excludedJobKeys.has(jobKey)) {
        return null;
      }

      const audioPath =
        typeof proof.audioPath === "string" && proof.audioPath.length > 0
          ? proof.audioPath
          : null;
      if (!audioPath || !existsSync(audioPath)) {
        return null;
      }

      const stats = await stat(audioPath).catch(() => null);
      const savedAt =
        typeof proof.generatedAt === "string"
          ? proof.generatedAt
          : typeof proof.importedAt === "string"
            ? proof.importedAt
            : stats?.mtime.toISOString() ?? null;
      const coverage = await readNotebookLmCoverageMetadata(jobKey);
      const label =
        coverage.coverageWindow ?? `Saved ${buildSavedLabel(savedAt)}`;
      const audioUrl = buildNotebookLmAudioUrl(parsedProofName.scope, jobKey);

      return {
        id: `google-notebooklm:${parsedProofName.scope}:${jobKey}`,
        provider: "google-notebooklm" as const,
        section: parsedProofName.scope,
        scope: parsedProofName.scope,
        jobKey,
        label,
        savedAt,
        sourceLabel: coverage.sourceLabel,
        headline: null,
        theme: null,
        audioPath,
        audioUrl,
        downloadUrl: `${audioUrl}&download=1`,
      };
    }),
  );

  return records
    .filter((record): record is PodcastArchiveAudioRecord => Boolean(record))
    .sort(compareArchiveRecords);
}

async function collectElevenLabsArchiveRecords(
  options?: ElevenLabsArchiveOptions,
): Promise<PodcastArchiveAudioRecord[]> {
  const excludedJobKeys = new Set(options?.excludeJobKeys ?? []);
  const audioEntries = await safeReadDirectory(ELEVENLABS_AUDIO_DIRECTORY);
  const proofEntries = audioEntries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".ready.json"),
  );

  const records = await Promise.all(
    proofEntries.map(async (entry) => {
      const proofPath = path.join(ELEVENLABS_AUDIO_DIRECTORY, entry.name);
      const proof = await readJsonFile(proofPath);
      if (!isRecord(proof) || typeof proof.jobKey !== "string") {
        return null;
      }

      const jobKey = proof.jobKey;
      if (excludedJobKeys.has(jobKey)) {
        return null;
      }

      const audioPath =
        typeof proof.audioPath === "string" && proof.audioPath.length > 0
          ? proof.audioPath
          : null;
      if (!audioPath || !existsSync(audioPath)) {
        return null;
      }

      const stats = await stat(audioPath).catch(() => null);
      const savedAt =
        typeof proof.savedAt === "string"
          ? proof.savedAt
          : stats?.mtime.toISOString() ?? null;
      const reportPath = path.join(ELEVENLABS_REPORT_DIRECTORY, `${jobKey}.json`);
      const reportPayload = await readJsonFile(reportPath);
      const report = isRecord(reportPayload) ? reportPayload : null;
      const request = isRecord(report?.request) ? report.request : null;
      const brief = isRecord(request?.brief) ? request.brief : null;
      const sourceLabel =
        typeof request?.sourceLabel === "string" ? request.sourceLabel : null;
      const label =
        formatWindowLabelFromIso(
          typeof brief?.windowStart === "string" ? brief.windowStart : null,
          typeof brief?.windowEnd === "string" ? brief.windowEnd : null,
        ) ?? `Saved ${buildSavedLabel(savedAt)}`;
      const archiveReport = isRecord(report?.report) ? report.report : null;
      const audioUrl = buildElevenLabsAudioUrl(jobKey);

      return {
        id: `elevenlabs:recent:${jobKey}`,
        provider: "elevenlabs" as const,
        section: "scriptedRecent" as const,
        scope: "recent" as const,
        jobKey,
        label,
        savedAt,
        sourceLabel,
        headline:
          typeof archiveReport?.headline === "string" ? archiveReport.headline : null,
        theme: typeof archiveReport?.theme === "string" ? archiveReport.theme : null,
        audioPath,
        audioUrl,
        downloadUrl: `${audioUrl}&download=1`,
      };
    }),
  );

  return records
    .filter((record): record is PodcastArchiveAudioRecord => Boolean(record))
    .sort(compareArchiveRecords);
}

export async function listPodcastArchiveCollections(options?: {
  currentNotebookLmJobKeys?: Partial<Record<NotebookLmPodcastScope, string | null>>;
  currentElevenLabsJobKey?: string | null;
}): Promise<PodcastArchiveCollections> {
  const currentNotebookLmJobKeys = options?.currentNotebookLmJobKeys;
  const notebookLmExcludeJobKeys = [
    currentNotebookLmJobKeys?.weekly ?? null,
    currentNotebookLmJobKeys?.recent ?? null,
  ].filter((value): value is string => Boolean(value));
  const elevenLabsExcludeJobKeys = [
    options?.currentElevenLabsJobKey ?? null,
  ].filter((value): value is string => Boolean(value));

  const [notebookLmRecords, elevenLabsRecords] = await Promise.all([
    collectNotebookLmArchiveRecords({
      excludeJobKeys: notebookLmExcludeJobKeys,
    }),
    collectElevenLabsArchiveRecords({
      excludeJobKeys: elevenLabsExcludeJobKeys,
    }),
  ]);

  return {
    ...EMPTY_ARCHIVE_COLLECTIONS,
    weekly: dedupeArchiveRecordsByLabel(
      notebookLmRecords.filter((entry) => entry.section === "weekly"),
    )
      .map(toPublicArchiveEntry),
    recent: dedupeArchiveRecordsByLabel(
      notebookLmRecords.filter((entry) => entry.section === "recent"),
    )
      .map(toPublicArchiveEntry),
    scriptedRecent: dedupeArchiveRecordsByLabel(elevenLabsRecords).map(
      toPublicArchiveEntry,
    ),
  };
}

export async function resolvePodcastArchiveAudioRecord(args: {
  provider: ArchiveProvider;
  scope: NotebookLmPodcastScope;
  jobKey: string;
}) {
  if (args.provider === "google-notebooklm") {
    const records = await collectNotebookLmArchiveRecords();
    return (
      records.find(
        (record) => record.scope === args.scope && record.jobKey === args.jobKey,
      ) ?? null
    );
  }

  const records = await collectElevenLabsArchiveRecords();
  return (
    records.find(
      (record) => record.scope === args.scope && record.jobKey === args.jobKey,
    ) ?? null
  );
}

export async function getCurrentPodcastArchiveExclusions(): Promise<PodcastArchiveExclusions> {
  const [weeklyJobKey, recentJobKey, currentElevenLabsJobKey] = await Promise.all([
    readCurrentJobKey(NOTEBOOKLM_WEEKLY_STATE_PATH),
    readCurrentJobKey(NOTEBOOKLM_RECENT_STATE_PATH),
    readCurrentJobKey(ELEVENLABS_RECENT_STATE_PATH),
  ]);

  return {
    currentNotebookLmJobKeys: {
      weekly: weeklyJobKey,
      recent: recentJobKey,
    },
    currentElevenLabsJobKey,
  };
}
