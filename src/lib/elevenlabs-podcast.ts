import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import OpenAI from "openai";

import { type WeeklyBrief } from "@/lib/dashboard";
import {
  buildNotebookLmPreparedRequest,
  type NotebookLmPreparedRequest,
} from "@/lib/notebooklm-podcast";
import { logNewsEvent } from "@/lib/news/logger";
import { stripHtml, truncate } from "@/lib/news/text";

const DEFAULT_CACHE_DIRECTORY = path.join(process.cwd(), ".cache");
const CACHE_DIRECTORY = process.env.NEWS_WATCH_CACHE_DIR
  ? path.resolve(process.env.NEWS_WATCH_CACHE_DIR)
  : DEFAULT_CACHE_DIRECTORY;
const ELEVENLABS_DIRECTORY = path.join(CACHE_DIRECTORY, "elevenlabs-podcast");
const ELEVENLABS_AUDIO_DIRECTORY = path.join(ELEVENLABS_DIRECTORY, "audio");
const ELEVENLABS_SCRIPT_DIRECTORY = path.join(ELEVENLABS_DIRECTORY, "scripts");
const ELEVENLABS_REPORT_DIRECTORY = path.join(ELEVENLABS_DIRECTORY, "reports");
const ELEVENLABS_STATE_PATH = path.join(ELEVENLABS_DIRECTORY, "recent-state.json");
const ELEVENLABS_STATE_TEMP_PATH = path.join(
  ELEVENLABS_DIRECTORY,
  "recent-state.tmp.json",
);
const ELEVENLABS_STATE_SCHEMA_VERSION = 1;
const ELEVENLABS_PROVIDER = "elevenlabs";
const ELEVENLABS_LABEL = "Ethiopia News Watch scripted last two days episode";
const OPENAI_PODCAST_SCRIPT_MODEL =
  process.env.OPENAI_PODCAST_SCRIPT_MODEL || "gpt-5.4";
const ELEVENLABS_PODCAST_MODEL =
  process.env.ELEVENLABS_PODCAST_MODEL || "eleven_v3";
const DEFAULT_HOST_A_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_HOST_B_VOICE_ID = "Aw4FAjKCGjjNkVhN1Xmq";
const MAX_DIALOGUE_CHARACTERS = 4_800;

let openAiClient: OpenAI | null = null;
let elevenLabsClient: ElevenLabsClient | null = null;

export type ElevenLabsPodcastStatus =
  | "idle"
  | "running"
  | "ready"
  | "failed"
  | "stale";

export interface ElevenLabsPodcastPublicState {
  provider: typeof ELEVENLABS_PROVIDER;
  scope: "recent";
  label: string;
  status: ElevenLabsPodcastStatus;
  jobKey: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  audioUrl: string | null;
  scriptUrl: string | null;
  sourceCount: number;
  sourceLabel: string;
  message: string | null;
  error: string | null;
  canGenerate: boolean;
  matchesCurrentCoverage: boolean;
  headline: string | null;
  theme: string | null;
  notebookUrl: null;
}

interface ElevenLabsPodcastStoredState {
  schemaVersion: number;
  provider: typeof ELEVENLABS_PROVIDER;
  scope: "recent";
  status: Exclude<ElevenLabsPodcastStatus, "stale">;
  jobKey: string | null;
  requestedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  coverageFingerprint: string | null;
  audioPath: string | null;
  scriptPath: string | null;
  reportPath: string | null;
  sourceCount: number;
  sourceLabel: string;
  message: string | null;
  error: string | null;
  headline: string | null;
  theme: string | null;
}

interface ElevenLabsCoverageSummary {
  canGenerate: boolean;
  brief: WeeklyBrief | null;
  coverageFingerprint: string | null;
  sourceCount: number;
  sourceLabel: string;
}

type ScriptSpeaker = "HOST_A" | "HOST_B";

interface ScriptedPodcastTurn {
  speaker: ScriptSpeaker;
  text: string;
}

interface ScriptedPodcastReport {
  headline: string;
  theme: string;
  summary: string;
  keyThreads: string[];
  sourceDifferences: string[];
  turns: ScriptedPodcastTurn[];
}

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  openAiClient ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return openAiClient;
}

function getElevenLabsClient() {
  if (!process.env.ELEVENLABS_API_KEY) {
    return null;
  }

  elevenLabsClient ??= new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
  });

  return elevenLabsClient;
}

function formatSourceCountLabel(sourceCount: number, packetCount: number) {
  const sourceText =
    packetCount === 1 ? "1 source packet" : `${packetCount} source packets`;
  const articleText =
    sourceCount === 1 ? "1 coverage item" : `${sourceCount} coverage items`;

  return `${sourceText} across ${articleText}`;
}

function createEmptyState(): ElevenLabsPodcastStoredState {
  return {
    schemaVersion: ELEVENLABS_STATE_SCHEMA_VERSION,
    provider: ELEVENLABS_PROVIDER,
    scope: "recent",
    status: "idle",
    jobKey: null,
    requestedAt: null,
    updatedAt: null,
    completedAt: null,
    coverageFingerprint: null,
    audioPath: null,
    scriptPath: null,
    reportPath: null,
    sourceCount: 0,
    sourceLabel: "No source packets prepared yet.",
    message: "Refresh coverage to prepare the last two days scripted episode.",
    error: null,
    headline: null,
    theme: null,
  };
}

function isStoredState(value: unknown): value is ElevenLabsPodcastStoredState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.schemaVersion === ELEVENLABS_STATE_SCHEMA_VERSION &&
    candidate.provider === ELEVENLABS_PROVIDER &&
    candidate.scope === "recent" &&
    typeof candidate.status === "string"
  );
}

async function ensureDirectories() {
  await mkdir(ELEVENLABS_DIRECTORY, { recursive: true });
  await mkdir(ELEVENLABS_AUDIO_DIRECTORY, { recursive: true });
  await mkdir(ELEVENLABS_SCRIPT_DIRECTORY, { recursive: true });
  await mkdir(ELEVENLABS_REPORT_DIRECTORY, { recursive: true });
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

async function loadStoredState(): Promise<ElevenLabsPodcastStoredState> {
  try {
    const raw = await readFile(ELEVENLABS_STATE_PATH, "utf8");
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

async function saveStoredState(state: ElevenLabsPodcastStoredState) {
  await ensureDirectories();
  await writeJsonAtomically(ELEVENLABS_STATE_PATH, ELEVENLABS_STATE_TEMP_PATH, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

function buildCoverageSummaryFromRequest(
  request: NotebookLmPreparedRequest | null,
): ElevenLabsCoverageSummary {
  if (!request) {
    return {
      canGenerate: false,
      brief: null,
      coverageFingerprint: null,
      sourceCount: 0,
      sourceLabel: "No source packets prepared yet.",
    };
  }

  const sourceCount = request.sourcePackets.reduce(
    (total, packet) => total + packet.itemCount,
    0,
  );

  return {
    canGenerate: sourceCount > 0 && request.sourceQuality.isComprehensive,
    brief: request.brief,
    coverageFingerprint: request.coverageFingerprint,
    sourceCount,
    sourceLabel: formatSourceCountLabel(sourceCount, request.sourcePackets.length),
  };
}

function buildAudioPath(jobKey: string) {
  return path.join(ELEVENLABS_AUDIO_DIRECTORY, `${jobKey}.mp3`);
}

function buildAudioProofPath(jobKey: string) {
  return path.join(ELEVENLABS_AUDIO_DIRECTORY, `${jobKey}.ready.json`);
}

function buildScriptPath(jobKey: string) {
  return path.join(ELEVENLABS_SCRIPT_DIRECTORY, `${jobKey}.md`);
}

function buildReportPath(jobKey: string) {
  return path.join(ELEVENLABS_REPORT_DIRECTORY, `${jobKey}.json`);
}

function hasVerifiedReadyAudioArtifact(state: ElevenLabsPodcastStoredState) {
  if (
    state.status !== "ready" ||
    !state.jobKey ||
    !state.audioPath ||
    !existsSync(state.audioPath)
  ) {
    return false;
  }

  const proofPath = buildAudioProofPath(state.jobKey);

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
}

function buildPublicState(
  coverage: ElevenLabsCoverageSummary,
  state: ElevenLabsPodcastStoredState,
): ElevenLabsPodcastPublicState {
  const hasAudio = hasVerifiedReadyAudioArtifact(state);
  const matchesCurrentCoverage =
    Boolean(coverage.coverageFingerprint) &&
    Boolean(state.coverageFingerprint) &&
    coverage.coverageFingerprint === state.coverageFingerprint;
  const status =
    state.status === "ready" && hasAudio && !matchesCurrentCoverage
      ? "stale"
      : state.status === "ready" && !hasAudio
        ? "failed"
        : state.status;

  return {
    provider: ELEVENLABS_PROVIDER,
    scope: "recent",
    label: ELEVENLABS_LABEL,
    status,
    jobKey: state.jobKey,
    requestedAt: state.requestedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
    windowStart: coverage.brief?.windowStart ?? null,
    windowEnd: coverage.brief?.windowEnd ?? null,
    audioUrl:
      hasAudio
        ? "/api/podcast/elevenlabs/audio"
        : null,
    scriptUrl:
      state.scriptPath && existsSync(state.scriptPath)
        ? "/api/podcast/elevenlabs/script"
        : null,
    sourceCount: state.sourceCount > 0 ? state.sourceCount : coverage.sourceCount,
    sourceLabel:
      state.sourceCount > 0 ? state.sourceLabel : coverage.sourceLabel,
    message:
      status === "stale"
        ? "A newer two-day coverage window is available. Regenerate the scripted episode to match the latest reporting."
        : state.message,
    error: state.error,
    canGenerate: coverage.canGenerate,
    matchesCurrentCoverage,
    headline: state.headline,
    theme: state.theme,
    notebookUrl: null,
  };
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Script generation did not return a JSON object.");
  }

  return JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
}

function normalizeStringList(value: unknown, limit: number, maxLength = 180) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) =>
      typeof entry === "string"
        ? truncate(stripHtml(entry).trim(), maxLength)
        : "",
    )
    .filter(Boolean)
    .slice(0, limit);
}

function stripSpeakerPrefix(text: string) {
  return stripHtml(
    text
    .replace(/^host\s*a\s*:\s*/i, "")
    .replace(/^host\s*b\s*:\s*/i, "")
    .replace(/^anchor\s*:\s*/i, "")
    .replace(/^analyst\s*:\s*/i, "")
    .trim(),
  );
}

export function normalizeScriptedPodcastTurns(
  value: unknown,
): ScriptedPodcastTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      const text =
        typeof candidate.text === "string"
          ? stripSpeakerPrefix(candidate.text)
          : "";
      if (!text) {
        return null;
      }

      const speakerValue =
        typeof candidate.speaker === "string"
          ? candidate.speaker.toUpperCase()
          : "";
      const speaker: ScriptSpeaker =
        speakerValue === "HOST_B"
          ? "HOST_B"
          : speakerValue === "HOST_A"
            ? "HOST_A"
            : index % 2 === 0
              ? "HOST_A"
              : "HOST_B";

      return {
        speaker,
        text: truncate(text, 900),
      } satisfies ScriptedPodcastTurn;
    })
    .filter((entry): entry is ScriptedPodcastTurn => Boolean(entry))
    .slice(0, 12)
    .map(
      (turn, index) =>
        ({
          ...turn,
          speaker: index % 2 === 0 ? "HOST_A" : "HOST_B",
        }) satisfies ScriptedPodcastTurn,
    );
}

export function calculateScriptedDialogueCharacterCount(
  turns: ScriptedPodcastTurn[],
) {
  return turns.reduce((total, turn) => total + turn.text.length, 0);
}

function calculateWordCount(turns: ScriptedPodcastTurn[]) {
  return turns.reduce(
    (total, turn) =>
      total +
      turn.text
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean).length,
    0,
  );
}

function normalizeReport(
  parsed: Record<string, unknown>,
  brief: WeeklyBrief,
): ScriptedPodcastReport {
  const turns = normalizeScriptedPodcastTurns(parsed.turns);

  if (turns.length < 6) {
    throw new Error("Script generation returned too few usable dialogue turns.");
  }

  return {
    headline:
      typeof parsed.headline === "string" && parsed.headline.trim()
        ? truncate(stripHtml(parsed.headline).trim(), 120)
        : "Ethiopia News Watch last two days",
    theme:
      typeof parsed.theme === "string" && parsed.theme.trim()
        ? truncate(stripHtml(parsed.theme).trim(), 120)
        : `Coverage from ${brief.windowStart} to ${brief.windowEnd}`,
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? truncate(stripHtml(parsed.summary).trim(), 520)
        : "Scripted two-day report generated from the latest Ethiopia News Watch source packets.",
    keyThreads: normalizeStringList(parsed.keyThreads, 6),
    sourceDifferences: normalizeStringList(parsed.sourceDifferences, 4, 220),
    turns,
  };
}

function buildPromptForRecentReport(request: NotebookLmPreparedRequest) {
  const packets = request.sourcePackets
    .map((packet) => {
      return [
        `Source packet: ${packet.source}`,
        `Items: ${packet.itemCount}`,
        packet.content,
      ].join("\n\n");
    })
    .join("\n\n---\n\n");

  return [
    "Build a grounded Ethiopia News Watch last-two-days podcast script from the supplied source packets.",
    "Return JSON only with this shape:",
    '{"headline":"string","theme":"string","summary":"string","keyThreads":["string"],"sourceDifferences":["string"],"turns":[{"speaker":"HOST_A","text":"string"},{"speaker":"HOST_B","text":"string"}]}',
    "Requirements:",
    "- Use only facts that appear in the supplied source packets.",
    "- First infer the main storylines and determine what this two-day window is about before writing the script.",
    "- Make it sound like an official Ethiopia News Watch report: serious, polished, neutral, and engaging.",
    "- Open by introducing Ethiopia News Watch and the exact date window covered.",
    "- Prioritize the most consequential developments, then connect the political, diplomatic, economic, humanitarian, and conflict threads only when the packets support them.",
    "- Make clear where sources align and where they differ in emphasis or framing.",
    "- Keep the tone restrained and professional. No hype, no dramatic scene-setting, and no invented transitions.",
    "- Write 8 to 12 alternating turns across HOST_A and HOST_B.",
    "- Keep the total spoken script between 550 and 700 words, and keep the combined dialogue text within 4800 characters.",
    "- Each turn should be one to three sentences, with natural radio pacing.",
    "- headline under 16 words.",
    "- theme under 14 words.",
    "- summary between 90 and 140 words.",
    "",
    JSON.stringify(
      {
        windowStart: request.brief.windowStart,
        windowEnd: request.brief.windowEnd,
        sourceLabel: formatSourceCountLabel(
          request.sourcePackets.reduce(
            (total, packet) => total + packet.itemCount,
            0,
          ),
          request.sourcePackets.length,
        ),
        sourceQuality: request.sourceQuality.summary,
      },
      null,
      2,
    ),
    "",
    packets,
  ].join("\n");
}

async function generateRecentReport(
  request: NotebookLmPreparedRequest,
): Promise<ScriptedPodcastReport> {
  const openai = getOpenAiClient();

  if (!openai) {
    throw new Error(
      "OPENAI_API_KEY is required to build the scripted last-two-days report.",
    );
  }

  const response = await openai.responses.create({
    model: OPENAI_PODCAST_SCRIPT_MODEL,
    max_output_tokens: 2_200,
    instructions:
      "You are the senior audio editor for Ethiopia News Watch. Work only from the supplied source packets. Keep the reporting neutral, factual, official, and easy to listen to. Do not invent facts, attributions, or claims that are not in the packets.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPromptForRecentReport(request),
          },
        ],
      },
    ],
  });

  const report = normalizeReport(parseJsonObject(response.output_text), request.brief);

  if (
    calculateScriptedDialogueCharacterCount(report.turns) <=
    MAX_DIALOGUE_CHARACTERS
  ) {
    return report;
  }

  const compacted = await openai.responses.create({
    model: OPENAI_PODCAST_SCRIPT_MODEL,
    max_output_tokens: 1_600,
    instructions:
      "Compress the supplied Ethiopia News Watch report script without changing factual meaning or source framing. Keep it official, neutral, and broadcast-ready.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Return JSON only with the same shape.",
              "Keep the combined dialogue text within 4800 characters.",
              JSON.stringify(report, null, 2),
            ].join("\n"),
          },
        ],
      },
    ],
  });

  return normalizeReport(parseJsonObject(compacted.output_text), request.brief);
}

export function buildScriptedPodcastMarkdown(
  report: ScriptedPodcastReport,
  request: NotebookLmPreparedRequest,
) {
  const lines = [
    `# ${report.headline}`,
    "",
    `Window: ${request.brief.windowStart} to ${request.brief.windowEnd}`,
    `Coverage: ${formatSourceCountLabel(
      request.sourcePackets.reduce((total, packet) => total + packet.itemCount, 0),
      request.sourcePackets.length,
    )}`,
    "",
    `Theme: ${report.theme}`,
    "",
    "## Report summary",
    report.summary,
    "",
  ];

  if (report.keyThreads.length > 0) {
    lines.push("## Key threads");
    report.keyThreads.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push("");
  }

  if (report.sourceDifferences.length > 0) {
    lines.push("## Where sources differed");
    report.sourceDifferences.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push("");
  }

  lines.push("## Podcast script");
  report.turns.forEach((turn) => {
    lines.push(`${turn.speaker.replace("_", " ")}: ${turn.text}`);
  });

  return lines.join("\n").trim();
}

function buildScriptJobKey(
  request: NotebookLmPreparedRequest,
  report: ScriptedPodcastReport,
) {
  const hash = createHash("sha256");
  hash.update(request.coverageFingerprint);
  hash.update(report.headline);
  hash.update(report.theme);
  hash.update(report.turns.map((turn) => `${turn.speaker}:${turn.text}`).join("|"));
  hash.update(ELEVENLABS_PODCAST_MODEL);
  hash.update(process.env.ELEVENLABS_HOST_A_VOICE_ID ?? DEFAULT_HOST_A_VOICE_ID);
  hash.update(process.env.ELEVENLABS_HOST_B_VOICE_ID ?? DEFAULT_HOST_B_VOICE_ID);
  return hash.digest("hex").slice(0, 16);
}

async function persistScriptArtifacts(
  request: NotebookLmPreparedRequest,
  report: ScriptedPodcastReport,
  jobKey: string,
) {
  await ensureDirectories();
  const scriptPath = buildScriptPath(jobKey);
  const reportPath = buildReportPath(jobKey);

  await writeFile(
    scriptPath,
    buildScriptedPodcastMarkdown(report, request),
    "utf8",
  );
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        report,
        request: {
          brief: request.brief,
          sourceLabel: formatSourceCountLabel(
            request.sourcePackets.reduce(
              (total, packet) => total + packet.itemCount,
              0,
            ),
            request.sourcePackets.length,
          ),
          coverageFingerprint: request.coverageFingerprint,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    scriptPath,
    reportPath,
  };
}

function buildDialogueInputs(report: ScriptedPodcastReport) {
  const hostAVoiceId =
    process.env.ELEVENLABS_HOST_A_VOICE_ID ||
    process.env.ELEVENLABS_VOICE_ID ||
    DEFAULT_HOST_A_VOICE_ID;
  const hostBVoiceId =
    process.env.ELEVENLABS_HOST_B_VOICE_ID || DEFAULT_HOST_B_VOICE_ID;

  return report.turns.map((turn) => ({
    text: turn.text,
    voiceId: turn.speaker === "HOST_A" ? hostAVoiceId : hostBVoiceId,
  }));
}

async function synthesizeReportAudio(
  report: ScriptedPodcastReport,
  jobKey: string,
) {
  const client = getElevenLabsClient();

  if (!client) {
    throw new Error(
      "ELEVENLABS_API_KEY is required to create the final scripted audio episode.",
    );
  }

  const audioStream = await client.textToDialogue.convert(
    {
      inputs: buildDialogueInputs(report),
      modelId: ELEVENLABS_PODCAST_MODEL,
      languageCode: "en",
      outputFormat: "mp3_44100_128",
      settings: {
        stability: 0.42,
      },
    },
    {
      timeoutInSeconds: 90,
    },
  );
  const audioBuffer = Buffer.from(await new Response(audioStream).arrayBuffer());
  const audioPath = buildAudioPath(jobKey);

  await writeFile(audioPath, audioBuffer);

  const audioStats = await stat(audioPath);
  await writeJsonAtomically(buildAudioProofPath(jobKey), `${buildAudioProofPath(jobKey)}.tmp`, {
    schemaVersion: 1,
    jobKey,
    audioPath,
    byteLength: audioStats.size,
    savedAt: new Date().toISOString(),
  });

  return audioPath;
}

export async function getElevenLabsRecentPodcastPublicState() {
  const [request, state] = await Promise.all([
    buildNotebookLmPreparedRequest("recent"),
    loadStoredState(),
  ]);
  const coverage = buildCoverageSummaryFromRequest(request);

  return buildPublicState(coverage, state);
}

export async function startElevenLabsRecentPodcastGeneration(options?: {
  force?: boolean;
}) {
  const force = options?.force ?? false;
  const [request, currentState] = await Promise.all([
    buildNotebookLmPreparedRequest("recent", { forceCoverageRefresh: true }),
    loadStoredState(),
  ]);
  const coverage = buildCoverageSummaryFromRequest(request);

  if (!request) {
    const emptyState = {
      ...createEmptyState(),
      updatedAt: new Date().toISOString(),
      message:
        "Refresh Ethiopia coverage first so the last two days source packets exist for the scripted episode.",
    };
    await saveStoredState(emptyState);

    return {
      state: buildPublicState(coverage, emptyState),
      started: false,
      notice:
        "Coverage needs to be refreshed before a scripted last-two-days episode can be prepared.",
    };
  }

  if (!request.sourceQuality.isComprehensive) {
    const blockedState: ElevenLabsPodcastStoredState = {
      ...createEmptyState(),
      status: "failed",
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      coverageFingerprint: request.coverageFingerprint,
      sourceCount: request.sourceQuality.totalItems,
      sourceLabel: formatSourceCountLabel(
        request.sourceQuality.totalItems,
        request.sourcePackets.length,
      ),
      message: request.sourceQuality.summary,
      error: request.sourceQuality.issues.join(" "),
    };
    await saveStoredState(blockedState);

    return {
      state: buildPublicState(coverage, blockedState),
      started: false,
      notice: request.sourceQuality.summary,
    };
  }

  if (
    !force &&
    currentState.status === "running" &&
    currentState.coverageFingerprint === request.coverageFingerprint
  ) {
    return {
      state: buildPublicState(coverage, currentState),
      started: false,
      notice: "The scripted ElevenLabs episode is already being generated.",
    };
  }

  if (
    !force &&
    currentState.status === "ready" &&
    currentState.coverageFingerprint === request.coverageFingerprint &&
    hasVerifiedReadyAudioArtifact(currentState)
  ) {
    return {
      state: buildPublicState(coverage, currentState),
      started: false,
      notice: "The current scripted ElevenLabs episode is already ready.",
    };
  }

  const runningState: ElevenLabsPodcastStoredState = {
    ...createEmptyState(),
    status: "running",
    requestedAt: new Date().toISOString(),
    coverageFingerprint: request.coverageFingerprint,
    sourceCount: coverage.sourceCount,
    sourceLabel: coverage.sourceLabel,
    message:
      "Analyzing the last two days source packets and drafting the Ethiopia News Watch script.",
  };
  await saveStoredState(runningState);
  let latestJobKey: string | null = null;
  let latestScriptPath: string | null = null;
  let latestReportPath: string | null = null;
  let latestHeadline: string | null = null;
  let latestTheme: string | null = null;

  try {
    const report = await generateRecentReport(request);
    const jobKey = buildScriptJobKey(request, report);
    latestJobKey = jobKey;
    latestHeadline = report.headline;
    latestTheme = report.theme;
    const { scriptPath, reportPath } = await persistScriptArtifacts(
      request,
      report,
      jobKey,
    );
    latestScriptPath = scriptPath;
    latestReportPath = reportPath;

    const reportReadyState: ElevenLabsPodcastStoredState = {
      ...runningState,
      jobKey,
      headline: report.headline,
      theme: report.theme,
      scriptPath,
      reportPath,
      message:
        "Scripted report is ready. Generating the ElevenLabs final audio now.",
    };
    await saveStoredState(reportReadyState);

    if (existsSync(buildAudioPath(jobKey))) {
      await unlink(buildAudioPath(jobKey)).catch(() => undefined);
    }
    if (existsSync(buildAudioProofPath(jobKey))) {
      await unlink(buildAudioProofPath(jobKey)).catch(() => undefined);
    }

    const audioPath = await synthesizeReportAudio(report, jobKey);
    const readyState: ElevenLabsPodcastStoredState = {
      ...reportReadyState,
      status: "ready",
      completedAt: new Date().toISOString(),
      audioPath,
      message: "Scripted ElevenLabs last two days episode is ready.",
      error: null,
    };
    await saveStoredState(readyState);

    logNewsEvent("info", "elevenlabs_recent_podcast_ready", {
      jobKey,
      coverageFingerprint: request.coverageFingerprint,
      model: ELEVENLABS_PODCAST_MODEL,
      openAiModel: OPENAI_PODCAST_SCRIPT_MODEL,
      wordCount: calculateWordCount(report.turns),
    });

    return {
      state: buildPublicState(coverage, readyState),
      started: false,
      notice: "Scripted ElevenLabs episode is ready.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown ElevenLabs episode error";
    const failedState: ElevenLabsPodcastStoredState = {
      ...runningState,
      status: "failed",
      completedAt: new Date().toISOString(),
      message:
        latestScriptPath && existsSync(latestScriptPath)
          ? "The scripted report was saved, but the ElevenLabs audio step failed. You can review the script and retry once the audio settings are corrected."
          : "Scripted episode generation hit a problem. Review the saved script, model configuration, or ElevenLabs credentials and try again.",
      error: message,
      scriptPath: latestScriptPath ?? currentState.scriptPath,
      reportPath: latestReportPath ?? currentState.reportPath,
      headline: latestHeadline ?? currentState.headline,
      theme: latestTheme ?? currentState.theme,
      jobKey: latestJobKey ?? currentState.jobKey,
    };
    await saveStoredState(failedState);

    logNewsEvent("warn", "elevenlabs_recent_podcast_failed", {
      message,
      coverageFingerprint: request.coverageFingerprint,
      model: ELEVENLABS_PODCAST_MODEL,
      openAiModel: OPENAI_PODCAST_SCRIPT_MODEL,
    });

    return {
      state: buildPublicState(coverage, failedState),
      started: false,
      notice: message,
    };
  }
}

export async function getElevenLabsRecentAudioPath() {
  const state = await loadStoredState();

  if (!hasVerifiedReadyAudioArtifact(state)) {
    return null;
  }

  return state.audioPath;
}

export async function getElevenLabsRecentScriptPath() {
  const state = await loadStoredState();

  if (!state.scriptPath || !existsSync(state.scriptPath)) {
    return null;
  }

  return state.scriptPath;
}

export async function cloneElevenLabsRecentAudioTo(targetPath: string) {
  const currentAudioPath = await getElevenLabsRecentAudioPath();

  if (!currentAudioPath) {
    return null;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(currentAudioPath, targetPath);
  return targetPath;
}

export async function clearElevenLabsRecentPodcastState() {
  await rm(ELEVENLABS_DIRECTORY, { recursive: true, force: true });
}
