import { createHash } from "node:crypto";
import { existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type {
  NotebookLmPodcastPublicState,
  NotebookLmPodcastStatus,
} from "@/lib/notebooklm-podcast";
import { buildNotebookLmPreparedRequest } from "@/lib/notebooklm-podcast";
import { logNewsEvent } from "@/lib/news/logger";

const DEFAULT_CACHE_DIRECTORY = path.join(process.cwd(), ".cache");
const CACHE_DIRECTORY = process.env.NEWS_WATCH_CACHE_DIR
  ? path.resolve(process.env.NEWS_WATCH_CACHE_DIR)
  : DEFAULT_CACHE_DIRECTORY;
const WEEKLY_DIRECTORY = path.join(CACHE_DIRECTORY, "reliable-weekly-podcast");
const WEEKLY_AUDIO_DIRECTORY = path.join(WEEKLY_DIRECTORY, "audio");
const WEEKLY_SCRIPT_DIRECTORY = path.join(WEEKLY_DIRECTORY, "scripts");
const WEEKLY_REPORT_DIRECTORY = path.join(WEEKLY_DIRECTORY, "reports");
const WEEKLY_STATE_PATH = path.join(WEEKLY_DIRECTORY, "weekly-state.json");
const WEEKLY_STATE_TEMP_PATH = path.join(WEEKLY_DIRECTORY, "weekly-state.tmp.json");
const WEEKLY_JOB_PATH = path.join(WEEKLY_DIRECTORY, "weekly-job.json");
const WEEKLY_JOB_TEMP_PATH = path.join(WEEKLY_DIRECTORY, "weekly-job.tmp.json");
const WEEKLY_WORKER_STDOUT_PATH = path.join(WEEKLY_DIRECTORY, "weekly-worker.out.log");
const WEEKLY_WORKER_STDERR_PATH = path.join(WEEKLY_DIRECTORY, "weekly-worker.err.log");
const WEEKLY_PROVIDER = "google-notebooklm";
const WEEKLY_LABEL = "Ethiopia News Watch weekly episode";
const WEEKLY_MODE = "deep-dive-long";
const WEEKLY_STATE_SCHEMA_VERSION = 1;
const MIN_RELIABLE_WEEKLY_PACKET_COUNT = 3;
const MIN_RELIABLE_WEEKLY_ITEM_COUNT = 12;
const MIN_RELIABLE_WEEKLY_RICH_PACKET_COUNT = 1;

type WeeklyStoredStatus = Exclude<NotebookLmPodcastStatus, "queued" | "auth-required">;
type WeeklyRequest = NonNullable<
  Awaited<ReturnType<typeof buildNotebookLmPreparedRequest>>
>;

interface WeeklyCoverageSummary {
  canGenerate: boolean;
  coverageFingerprint: string | null;
  sourceCount: number;
  sourceLabel: string;
  windowStart: string | null;
  windowEnd: string | null;
  readinessSummary: string | null;
  readinessIssues: string[];
}

interface WeeklyStoredState {
  schemaVersion: number;
  provider: typeof WEEKLY_PROVIDER;
  scope: "weekly";
  mode: typeof WEEKLY_MODE;
  status: WeeklyStoredStatus;
  jobKey: string | null;
  notebookTitle: string | null;
  prompt: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  audioPath: string | null;
  audioProofPath: string | null;
  scriptPath: string | null;
  reportPath: string | null;
  coverageFingerprint: string | null;
  sourceCount: number;
  sourceLabel: string;
  message: string | null;
  error: string | null;
}

interface WeeklyWorkerJob {
  schemaVersion: number;
  jobKey: string;
  request: WeeklyRequest;
  statePath: string;
  outputAudioPath: string;
  outputAudioProofPath: string;
  outputScriptPath: string;
  outputReportPath: string;
}

function formatSourceCountLabel(sourceCount: number, packetCount: number) {
  const sourceText =
    packetCount === 1 ? "1 source packet" : `${packetCount} source packets`;
  const articleText =
    sourceCount === 1 ? "1 coverage item" : `${sourceCount} coverage items`;

  return `${sourceText} across ${articleText}`;
}

function evaluateReliableWeeklyReadiness(request: WeeklyRequest) {
  const sourceCount = request.sourcePackets.reduce(
    (total, packet) => total + packet.itemCount,
    0,
  );
  const packetCount = request.sourcePackets.length;
  const issues: string[] = [];

  if (packetCount < MIN_RELIABLE_WEEKLY_PACKET_COUNT) {
    issues.push(
      `Need at least ${MIN_RELIABLE_WEEKLY_PACKET_COUNT} source packets; only ${packetCount} are prepared.`,
    );
  }

  if (sourceCount < MIN_RELIABLE_WEEKLY_ITEM_COUNT) {
    issues.push(
      `Need at least ${MIN_RELIABLE_WEEKLY_ITEM_COUNT} weekly coverage items; only ${sourceCount} are prepared.`,
    );
  }

  if (
    request.sourceQuality.richPacketCount < MIN_RELIABLE_WEEKLY_RICH_PACKET_COUNT
  ) {
    issues.push(
      `Need at least ${MIN_RELIABLE_WEEKLY_RICH_PACKET_COUNT} source packet with substantial recovered text; only ${request.sourceQuality.richPacketCount} qualified.`,
    );
  }

  return {
    canGenerate: issues.length === 0,
    sourceCount,
    packetCount,
    issues,
    summary:
      issues.length === 0
        ? `Weekly long-form episode can be generated from ${packetCount} source packets and ${sourceCount} coverage items.`
        : `Weekly long-form episode is waiting for a stronger prepared packet. ${issues.join(" ")}`,
  };
}

function createEmptyState(): WeeklyStoredState {
  return {
    schemaVersion: WEEKLY_STATE_SCHEMA_VERSION,
    provider: WEEKLY_PROVIDER,
    scope: "weekly",
    mode: WEEKLY_MODE,
    status: "idle",
    jobKey: null,
    notebookTitle: null,
    prompt: null,
    requestedAt: null,
    updatedAt: null,
    completedAt: null,
    audioPath: null,
    audioProofPath: null,
    scriptPath: null,
    reportPath: null,
    coverageFingerprint: null,
    sourceCount: 0,
    sourceLabel: "No source packets prepared yet.",
    message: "Refresh coverage to prepare the weekly long-form episode.",
    error: null,
  };
}

function isStoredState(value: unknown): value is WeeklyStoredState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === WEEKLY_STATE_SCHEMA_VERSION &&
    candidate.provider === WEEKLY_PROVIDER &&
    candidate.scope === "weekly" &&
    candidate.mode === WEEKLY_MODE &&
    typeof candidate.status === "string"
  );
}

async function ensureDirectories() {
  await mkdir(WEEKLY_DIRECTORY, { recursive: true });
  await mkdir(WEEKLY_AUDIO_DIRECTORY, { recursive: true });
  await mkdir(WEEKLY_SCRIPT_DIRECTORY, { recursive: true });
  await mkdir(WEEKLY_REPORT_DIRECTORY, { recursive: true });
}

async function writeJsonAtomically(
  filePath: string,
  tempPath: string,
  value: unknown,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tempPath, filePath);
}

async function loadStoredState(): Promise<WeeklyStoredState> {
  try {
    const raw = await readFile(WEEKLY_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isStoredState(parsed)) {
      return createEmptyState();
    }

    return {
      ...createEmptyState(),
      ...parsed,
    };
  } catch {
    return createEmptyState();
  }
}

async function saveStoredState(state: WeeklyStoredState) {
  await ensureDirectories();
  await writeJsonAtomically(WEEKLY_STATE_PATH, WEEKLY_STATE_TEMP_PATH, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

function buildCoverageSummaryFromRequest(
  request: Awaited<ReturnType<typeof buildNotebookLmPreparedRequest>>,
): WeeklyCoverageSummary {
  if (!request) {
    return {
      canGenerate: false,
      coverageFingerprint: null,
      sourceCount: 0,
      sourceLabel: "No source packets prepared yet.",
      windowStart: null,
      windowEnd: null,
      readinessSummary: "No weekly source packet is prepared yet.",
      readinessIssues: ["Refresh Ethiopia coverage to prepare the weekly source packet."],
    };
  }

  const readiness = evaluateReliableWeeklyReadiness(request);

  return {
    canGenerate: readiness.canGenerate,
    coverageFingerprint: request.coverageFingerprint,
    sourceCount: readiness.sourceCount,
    sourceLabel: formatSourceCountLabel(
      readiness.sourceCount,
      request.sourcePackets.length,
    ),
    windowStart: request.brief.windowStart,
    windowEnd: request.brief.windowEnd,
    readinessSummary: readiness.summary,
    readinessIssues: readiness.issues,
  };
}

function buildAudioPath(jobKey: string) {
  return path.join(WEEKLY_AUDIO_DIRECTORY, `${jobKey}.mp3`);
}

function buildAudioProofPath(jobKey: string) {
  return path.join(WEEKLY_AUDIO_DIRECTORY, `${jobKey}.ready.json`);
}

function buildScriptPath(jobKey: string) {
  return path.join(WEEKLY_SCRIPT_DIRECTORY, `${jobKey}.md`);
}

function buildReportPath(jobKey: string) {
  return path.join(WEEKLY_REPORT_DIRECTORY, `${jobKey}.json`);
}

function hasVerifiedReadyAudioArtifact(state: WeeklyStoredState) {
  if (
    state.status !== "ready" ||
    !state.jobKey ||
    !state.audioPath ||
    !state.audioProofPath ||
    !existsSync(state.audioPath) ||
    !existsSync(state.audioProofPath)
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(state.audioProofPath, "utf8")) as {
      jobKey?: string;
      audioPath?: string;
    };

    return parsed.jobKey === state.jobKey && parsed.audioPath === state.audioPath;
  } catch {
    return false;
  }
}

function buildPublicState(
  coverage: WeeklyCoverageSummary,
  state: WeeklyStoredState,
): NotebookLmPodcastPublicState {
  const hasAudio = hasVerifiedReadyAudioArtifact(state);
  const matchesCurrentCoverage =
    Boolean(coverage.coverageFingerprint) &&
    Boolean(state.coverageFingerprint) &&
    coverage.coverageFingerprint === state.coverageFingerprint;
  const status: NotebookLmPodcastStatus =
    state.status === "ready" && hasAudio && !matchesCurrentCoverage
      ? "stale"
      : state.status === "ready" && !hasAudio
        ? "failed"
        : state.status;

  return {
    provider: WEEKLY_PROVIDER,
    scope: "weekly",
    mode: WEEKLY_MODE,
    label: WEEKLY_LABEL,
    status,
    jobKey: state.jobKey,
    notebookTitle: state.notebookTitle,
    notebookUrl: null,
    prompt: state.prompt,
    requestedAt: state.requestedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
    windowStart: coverage.windowStart,
    windowEnd: coverage.windowEnd,
    audioUrl: hasAudio ? "/api/podcast/audio?scope=weekly" : null,
    sourceCount: state.sourceCount > 0 ? state.sourceCount : coverage.sourceCount,
    sourceLabel: state.sourceCount > 0 ? state.sourceLabel : coverage.sourceLabel,
    message:
      status === "idle" && coverage.canGenerate
        ? coverage.readinessSummary
        : status === "idle" && coverage.readinessSummary
          ? coverage.readinessSummary
          : status === "stale"
            ? "A newer weekly coverage packet is ready. Generate a fresh weekly episode to match the latest reporting."
            : state.message,
    error: state.error,
    matchesCurrentCoverage,
    needsSignin: false,
    canGenerate: coverage.canGenerate,
  };
}

function buildBlockedState(
  request: WeeklyRequest,
  coverage: WeeklyCoverageSummary,
): WeeklyStoredState {
  return {
    ...createEmptyState(),
    status: "failed",
    requestedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    notebookTitle: request.notebookTitle,
    prompt: request.prompt,
    coverageFingerprint: request.coverageFingerprint,
    sourceCount: coverage.sourceCount,
    sourceLabel: coverage.sourceLabel,
    message: coverage.readinessSummary,
    error: coverage.readinessIssues.join(" "),
  };
}

function buildReadyState(
  request: WeeklyRequest,
  coverage: WeeklyCoverageSummary,
  audioProofPath: string,
  scriptPath: string,
  reportPath: string,
  jobKey: string,
): WeeklyStoredState {
  return {
    ...createEmptyState(),
    status: "running",
    jobKey,
    notebookTitle: request.notebookTitle,
    prompt: request.prompt,
    requestedAt: new Date().toISOString(),
    coverageFingerprint: request.coverageFingerprint,
    sourceCount: coverage.sourceCount,
    sourceLabel: coverage.sourceLabel,
    scriptPath,
    reportPath,
    audioPath: null,
    audioProofPath,
    message:
      "Analyzing the weekly source packets and drafting the long-form Ethiopia News Watch episode.",
  };
}

function shouldReuseRunningState(
  currentState: WeeklyStoredState,
  request: WeeklyRequest,
) {
  return (
    currentState.status === "running" &&
    currentState.coverageFingerprint === request.coverageFingerprint
  );
}

function shouldReuseReadyState(
  currentState: WeeklyStoredState,
  request: WeeklyRequest,
) {
  return (
    currentState.status === "ready" &&
    currentState.coverageFingerprint === request.coverageFingerprint &&
    hasVerifiedReadyAudioArtifact(currentState)
  );
}

function buildWorkerJobKey(request: WeeklyRequest) {
  const hash = createHash("sha256");
  hash.update(request.coverageFingerprint);
  hash.update(request.prompt);
  hash.update(process.env.OPENAI_PODCAST_SCRIPT_MODEL || "gpt-5.4");
  hash.update(process.env.ELEVENLABS_PODCAST_MODEL || "eleven_v3");
  hash.update(process.env.ELEVENLABS_HOST_A_VOICE_ID || "");
  hash.update(process.env.ELEVENLABS_HOST_B_VOICE_ID || "");
  return hash.digest("hex").slice(0, 16);
}

async function writeJobFile(job: WeeklyWorkerJob) {
  await ensureDirectories();
  await writeJsonAtomically(WEEKLY_JOB_PATH, WEEKLY_JOB_TEMP_PATH, job);
}

function spawnWorker() {
  const workerPath = path.join(
    process.cwd(),
    "scripts",
    "reliable-weekly-podcast-worker.mjs",
  );
  const stdoutFd = openSync(WEEKLY_WORKER_STDOUT_PATH, "a");
  const stderrFd = openSync(WEEKLY_WORKER_STDERR_PATH, "a");
  const worker = spawn(process.execPath, [workerPath, WEEKLY_JOB_PATH], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
    windowsHide: true,
  });

  worker.unref();

  logNewsEvent("info", "reliable_weekly_podcast_worker_spawned", {
    workerPath,
    pid: worker.pid,
  });
}

export async function getReliableWeeklyPodcastPublicState() {
  const [request, state] = await Promise.all([
    buildNotebookLmPreparedRequest("weekly"),
    loadStoredState(),
  ]);
  const coverage = buildCoverageSummaryFromRequest(request);

  return buildPublicState(coverage, state);
}

export async function startReliableWeeklyPodcastGeneration(options?: {
  force?: boolean;
}) {
  const force = options?.force ?? false;
  const [request, currentState] = await Promise.all([
    buildNotebookLmPreparedRequest("weekly"),
    loadStoredState(),
  ]);
  const coverage = buildCoverageSummaryFromRequest(request);

  if (!request) {
    const emptyState = {
      ...createEmptyState(),
      updatedAt: new Date().toISOString(),
      message:
        "Refresh Ethiopia coverage first so the weekly source packets exist for the long-form episode.",
    };
    await saveStoredState(emptyState);

    return {
      state: buildPublicState(coverage, emptyState),
      started: false,
      notice:
        "Coverage needs to be refreshed before a weekly long-form episode can be prepared.",
    };
  }

  if (!coverage.canGenerate) {
    const blockedState = buildBlockedState(request, coverage);
    await saveStoredState(blockedState);

    return {
      state: buildPublicState(coverage, blockedState),
      started: false,
      notice: coverage.readinessSummary ?? "Weekly long-form episode is not ready yet.",
    };
  }

  if (!force && shouldReuseRunningState(currentState, request)) {
    return {
      state: buildPublicState(coverage, currentState),
      started: false,
      notice: "The weekly long-form episode is already being generated.",
    };
  }

  if (!force && shouldReuseReadyState(currentState, request)) {
    return {
      state: buildPublicState(coverage, currentState),
      started: false,
      notice: "The current weekly long-form episode is already ready.",
    };
  }

  const jobKey = buildWorkerJobKey(request);
  const audioPath = buildAudioPath(jobKey);
  const audioProofPath = buildAudioProofPath(jobKey);
  const scriptPath = buildScriptPath(jobKey);
  const reportPath = buildReportPath(jobKey);

  await unlink(audioPath).catch(() => undefined);
  await unlink(audioProofPath).catch(() => undefined);

  const runningState = buildReadyState(
    request,
    coverage,
    audioProofPath,
    scriptPath,
    reportPath,
    jobKey,
  );
  await saveStoredState(runningState);
  await ensureDirectories();
  await writeFile(
    WEEKLY_WORKER_STDOUT_PATH,
    `${new Date().toISOString()} Starting reliable weekly worker for ${jobKey}\n`,
    "utf8",
  );
  await writeFile(WEEKLY_WORKER_STDERR_PATH, "", "utf8");

  await writeJobFile({
    schemaVersion: WEEKLY_STATE_SCHEMA_VERSION,
    jobKey,
    request,
    statePath: WEEKLY_STATE_PATH,
    outputAudioPath: audioPath,
    outputAudioProofPath: audioProofPath,
    outputScriptPath: scriptPath,
    outputReportPath: reportPath,
  });

  spawnWorker();

  return {
    state: buildPublicState(coverage, runningState),
    started: true,
    notice:
      "Weekly long-form episode generation started. The app will update when the audio is ready.",
  };
}

export async function getReliableWeeklyCurrentAudioPath() {
  const state = await loadStoredState();

  if (!hasVerifiedReadyAudioArtifact(state)) {
    return null;
  }

  return state.audioPath;
}
