import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
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

const OPENAI_PODCAST_SCRIPT_MODEL =
  process.env.OPENAI_PODCAST_SCRIPT_MODEL || "gpt-5.4";
const ELEVENLABS_PODCAST_MODEL =
  process.env.ELEVENLABS_PODCAST_MODEL || "eleven_v3";
const DEFAULT_HOST_A_VOICE_ID = "iqt7x9gyiKaSUpsmLs5d";
const DEFAULT_HOST_B_VOICE_ID = "StQrKDdqkTDh6m1iqpqH";
const MAX_SEGMENT_CHARACTERS = 4_400;

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength) {
  const normalized = stripHtml(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function createEmptyState() {
  return {
    schemaVersion: 1,
    provider: "google-notebooklm",
    scope: "weekly",
    mode: "deep-dive-long",
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
    message: null,
    error: null,
  };
}

function formatSourceCountLabel(sourceCount, packetCount) {
  const sourceText =
    packetCount === 1 ? "1 source packet" : `${packetCount} source packets`;
  const articleText =
    sourceCount === 1 ? "1 coverage item" : `${sourceCount} coverage items`;

  return `${sourceText} across ${articleText}`;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonAtomically(filePath, tempPath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tempPath, filePath);
}

async function updateState(statePath, patch) {
  const current = existsSync(statePath) ? await readJson(statePath) : createEmptyState();
  const nextState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomically(statePath, `${statePath}.tmp`, nextState);
  return nextState;
}

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getElevenLabsClient() {
  if (!process.env.ELEVENLABS_API_KEY) {
    return null;
  }
  return new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
}

function calculateSegmentCharacterCount(turns) {
  return turns.reduce((total, turn) => total + turn.text.length, 0);
}

function calculateWordCount(turns) {
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

function stripSpeakerPrefix(text) {
  return stripHtml(
    String(text || "")
      .replace(/^host\s*a\s*:\s*/i, "")
      .replace(/^host\s*b\s*:\s*/i, "")
      .replace(/^anchor\s*:\s*/i, "")
      .replace(/^analyst\s*:\s*/i, "")
      .trim(),
  );
}

function normalizeTurns(value, limit) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const text = typeof entry.text === "string" ? stripSpeakerPrefix(entry.text) : "";
      if (!text) {
        return null;
      }
      const speakerValue =
        typeof entry.speaker === "string" ? entry.speaker.toUpperCase() : "";
      const speaker =
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
      };
    })
    .filter(Boolean)
    .slice(0, limit)
    .map((turn, index) => ({
      ...turn,
      speaker: index % 2 === 0 ? "HOST_A" : "HOST_B",
    }));
}

function normalizeStringList(value, limit, maxLength = 180) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? truncate(entry, maxLength) : ""))
    .filter(Boolean)
    .slice(0, limit);
}

function parseJsonObject(raw) {
  const trimmed = String(raw || "").trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Script generation did not return a JSON object.");
  }
  return JSON.parse(trimmed.slice(first, last + 1));
}

function normalizeSegment(entry, index) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const turns = normalizeTurns(entry.turns, 8);
  if (turns.length < 6) {
    return null;
  }
  return {
    id: `segment-${index + 1}`,
    title:
      typeof entry.title === "string" && entry.title.trim()
        ? truncate(entry.title, 80)
        : `Chapter ${index + 1}`,
    turns,
  };
}

function normalizeReport(parsed, request) {
  const segments = Array.isArray(parsed.segments)
    ? parsed.segments.map((entry, index) => normalizeSegment(entry, index)).filter(Boolean)
    : [];
  if (segments.length < 3) {
    throw new Error("Weekly script generation returned too few usable segments.");
  }
  return {
    headline:
      typeof parsed.headline === "string" && parsed.headline.trim()
        ? truncate(parsed.headline, 120)
        : "Ethiopia News Watch weekly audio overview",
    theme:
      typeof parsed.theme === "string" && parsed.theme.trim()
        ? truncate(parsed.theme, 120)
        : `Coverage from ${request.brief.windowStart} to ${request.brief.windowEnd}`,
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? truncate(parsed.summary, 700)
        : "Long-form weekly report generated from the latest Ethiopia News Watch source packets.",
    keyThreads: normalizeStringList(parsed.keyThreads, 8),
    sourceDifferences: normalizeStringList(parsed.sourceDifferences, 6, 220),
    segments,
  };
}

function buildPromptForWeeklyReport(request) {
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
    "Build a grounded Ethiopia News Watch weekly long-form podcast script from the supplied source packets.",
    "Treat this as a replacement for the old NotebookLM weekly audio overview, but keep the same editorial brief and host behavior.",
    `Host instructions: ${request.prompt}`,
    "Return JSON only with this shape:",
    '{"headline":"string","theme":"string","summary":"string","keyThreads":["string"],"sourceDifferences":["string"],"segments":[{"title":"string","turns":[{"speaker":"HOST_A","text":"string"},{"speaker":"HOST_B","text":"string"}]}]}',
    "Requirements:",
    "- Use only facts that appear in the supplied source packets.",
    "- First determine what this reporting week is mainly about before writing the script.",
    "- Make it sound like an official Ethiopia News Watch weekly report: serious, polished, neutral, engaging, and attribution-heavy.",
    "- Open in the first segment by introducing Ethiopia News Watch and the exact seven-day date window covered.",
    "- Produce exactly 3 segments.",
    "- Each segment should have 6 to 8 alternating turns across HOST_A and HOST_B.",
    `- Keep each segment under ${MAX_SEGMENT_CHARACTERS} dialogue characters total.`,
    "- Target roughly 1600 to 2200 spoken words across the full episode.",
    "- Segment 1 should establish the dominant developments and framing of the week.",
    "- Segment 2 should deepen the politics, conflict, diplomacy, and election picture where supported.",
    "- Segment 3 should cover economy, humanitarian, institutions, source differences, and a disciplined close.",
    "- Make clear where sources align and where they differ in emphasis or framing.",
    "- No hype, no dramatic scene-setting, no invented facts, and no casual banter that undercuts credibility.",
    "- headline under 16 words.",
    "- theme under 14 words.",
    "- summary between 120 and 180 words.",
    "",
    JSON.stringify(
      {
        windowStart: request.brief.windowStart,
        windowEnd: request.brief.windowEnd,
        sourceCount: request.sourcePackets.length,
        sourceQuality: request.sourceQuality.summary,
      },
      null,
      2,
    ),
    "",
    packets,
  ].join("\n");
}

async function compactSegmentIfNeeded(openai, segment) {
  if (calculateSegmentCharacterCount(segment.turns) <= MAX_SEGMENT_CHARACTERS) {
    return segment;
  }

  const response = await openai.responses.create({
    model: OPENAI_PODCAST_SCRIPT_MODEL,
    max_output_tokens: 1600,
    instructions:
      "Compress the supplied Ethiopia News Watch weekly audio segment without changing factual meaning or source framing. Keep it official, neutral, and broadcast-ready.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              'Return JSON only with this shape: {"title":"string","turns":[{"speaker":"HOST_A","text":"string"},{"speaker":"HOST_B","text":"string"}]}',
              `Keep the combined dialogue text within ${MAX_SEGMENT_CHARACTERS} characters.`,
              JSON.stringify(segment, null, 2),
            ].join("\n"),
          },
        ],
      },
    ],
  });
  const parsed = parseJsonObject(response.output_text);
  const compacted = normalizeSegment(parsed, 0);
  if (!compacted) {
    throw new Error("Segment compaction returned unusable dialogue.");
  }
  return compacted;
}

async function generateWeeklyReport(request) {
  const openai = getOpenAiClient();
  if (!openai) {
    throw new Error("OPENAI_API_KEY is required to build the weekly long-form script.");
  }

  const response = await openai.responses.create({
    model: OPENAI_PODCAST_SCRIPT_MODEL,
    max_output_tokens: 5200,
    instructions:
      "You are the senior audio editor for Ethiopia News Watch. Work only from the supplied source packets. Keep the reporting neutral, factual, official, and easy to listen to. Do not invent facts, attributions, or claims that are not in the packets.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: buildPromptForWeeklyReport(request) }],
      },
    ],
  });

  const report = normalizeReport(parseJsonObject(response.output_text), request);
  const compactedSegments = [];
  for (const segment of report.segments) {
    compactedSegments.push(await compactSegmentIfNeeded(openai, segment));
  }
  return { ...report, segments: compactedSegments };
}

function buildMarkdown(report, request) {
  const lines = [
    `# ${report.headline}`,
    "",
    `Window: ${request.brief.windowStart} to ${request.brief.windowEnd}`,
    `Coverage: ${request.sourcePackets.length} source packets`,
    "",
    `Theme: ${report.theme}`,
    "",
    "## Report summary",
    report.summary,
    "",
  ];

  if (report.keyThreads.length > 0) {
    lines.push("## Key threads");
    report.keyThreads.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  if (report.sourceDifferences.length > 0) {
    lines.push("## Where sources differed");
    report.sourceDifferences.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  lines.push("## Podcast script");
  report.segments.forEach((segment) => {
    lines.push("");
    lines.push(`### ${segment.title}`);
    segment.turns.forEach((turn) => {
      lines.push(`${turn.speaker.replace("_", " ")}: ${turn.text}`);
    });
  });

  return lines.join("\n").trim();
}

function buildSegmentJobKey(jobKey, report, index) {
  const hash = createHash("sha256");
  hash.update(jobKey);
  hash.update(report.headline);
  hash.update(report.segments[index].title);
  hash.update(
    report.segments[index].turns.map((turn) => `${turn.speaker}:${turn.text}`).join("|"),
  );
  return hash.digest("hex").slice(0, 10);
}

function buildDialogueInputs(segment) {
  const hostAVoiceId =
    process.env.ELEVENLABS_HOST_A_VOICE_ID ||
    process.env.ELEVENLABS_VOICE_ID ||
    DEFAULT_HOST_A_VOICE_ID;
  const hostBVoiceId =
    process.env.ELEVENLABS_HOST_B_VOICE_ID || DEFAULT_HOST_B_VOICE_ID;
  return segment.turns.map((turn) => ({
    text: turn.text,
    voiceId: turn.speaker === "HOST_A" ? hostAVoiceId : hostBVoiceId,
  }));
}

async function synthesizeSegmentAudio(client, report, jobKey, index, segmentDirectory) {
  const segment = report.segments[index];
  const segmentKey = buildSegmentJobKey(jobKey, report, index);
  const segmentPath = path.join(
    segmentDirectory,
    `${String(index + 1).padStart(2, "0")}-${segmentKey}.mp3`,
  );
  await unlink(segmentPath).catch(() => undefined);

  const audioStream = await client.textToDialogue.convert(
    {
      inputs: buildDialogueInputs(segment),
      modelId: ELEVENLABS_PODCAST_MODEL,
      languageCode: "en",
      outputFormat: "mp3_44100_128",
      settings: { stability: 0.42, speed: 1 },
    },
    { timeoutInSeconds: 120 },
  );
  const audioBuffer = Buffer.from(await new Response(audioStream).arrayBuffer());
  await writeFile(segmentPath, audioBuffer);
  return segmentPath;
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
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
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function stitchSegments(segmentPaths, outputAudioPath, workingDirectory) {
  const concatListPath = path.join(workingDirectory, "concat.txt");
  const concatList = segmentPaths
    .map((segmentPath) => `file '${segmentPath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(concatListPath, concatList, "utf8");
  await unlink(outputAudioPath).catch(() => undefined);

  try {
    await runProcess(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", outputAudioPath],
      workingDirectory,
    );
  } catch {
    await runProcess(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        outputAudioPath,
      ],
      workingDirectory,
    );
  }
}

async function persistArtifacts(job, request, report) {
  await writeFile(job.outputScriptPath, buildMarkdown(report, request), "utf8");
  await writeFile(
    job.outputReportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        report,
        request: {
          brief: request.brief,
          coverageFingerprint: request.coverageFingerprint,
          sourceCount: request.sourcePackets.length,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function main() {
  const jobPath = process.argv[2];
  if (!jobPath) {
    throw new Error("Reliable weekly worker requires a path to the job JSON file.");
  }

  const job = await readJson(jobPath);
  const request = job.request;
  const openai = getOpenAiClient();
  const elevenLabs = getElevenLabsClient();
  if (!openai) {
    throw new Error("OPENAI_API_KEY is required to generate the weekly long-form episode.");
  }
  if (!elevenLabs) {
    throw new Error("ELEVENLABS_API_KEY is required to generate the weekly long-form episode.");
  }

  const segmentDirectory = path.join(path.dirname(job.outputAudioPath), `${job.jobKey}-segments`);
  await rm(segmentDirectory, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(segmentDirectory, { recursive: true });

  await updateState(job.statePath, {
    status: "running",
    jobKey: job.jobKey,
    notebookTitle: request.notebookTitle,
    prompt: request.prompt,
    requestedAt: new Date().toISOString(),
    coverageFingerprint: request.coverageFingerprint,
    sourceCount: request.sourcePackets.reduce((total, packet) => total + packet.itemCount, 0),
    sourceLabel: formatSourceCountLabel(
      request.sourcePackets.reduce((total, packet) => total + packet.itemCount, 0),
      request.sourcePackets.length,
    ),
    scriptPath: job.outputScriptPath,
    reportPath: job.outputReportPath,
    audioProofPath: job.outputAudioProofPath,
    message:
      "Drafting the weekly long-form Ethiopia News Watch audio script from the current source packets.",
    error: null,
  });

  try {
    const report = await generateWeeklyReport(request);
    await persistArtifacts(job, request, report);

    const segmentPaths = [];
    for (let index = 0; index < report.segments.length; index += 1) {
      await updateState(job.statePath, {
        status: "running",
        message:
          `Generating narrated chapter ${index + 1}/${report.segments.length}: ${report.segments[index].title}.`,
        error: null,
      });
      segmentPaths.push(
        await synthesizeSegmentAudio(elevenLabs, report, job.jobKey, index, segmentDirectory),
      );
    }

    await updateState(job.statePath, {
      status: "running",
      message: "Stitching the narrated weekly chapters into the final episode audio.",
      error: null,
    });
    await stitchSegments(segmentPaths, job.outputAudioPath, segmentDirectory);

    const audioStats = await stat(job.outputAudioPath);
    await writeJsonAtomically(job.outputAudioProofPath, `${job.outputAudioProofPath}.tmp`, {
      schemaVersion: 1,
      jobKey: job.jobKey,
      audioPath: job.outputAudioPath,
      byteLength: audioStats.size,
      savedAt: new Date().toISOString(),
      segmentCount: segmentPaths.length,
      wordCount: report.segments.reduce(
        (total, segment) => total + calculateWordCount(segment.turns),
        0,
      ),
    });

    await updateState(job.statePath, {
      status: "ready",
      completedAt: new Date().toISOString(),
      audioPath: job.outputAudioPath,
      audioProofPath: job.outputAudioProofPath,
      scriptPath: job.outputScriptPath,
      reportPath: job.outputReportPath,
      message: "Weekly long-form episode is ready.",
      error: null,
    });
  } catch (error) {
    await updateState(job.statePath, {
      status: "failed",
      completedAt: new Date().toISOString(),
      scriptPath: existsSync(job.outputScriptPath) ? job.outputScriptPath : null,
      reportPath: existsSync(job.outputReportPath) ? job.outputReportPath : null,
      message:
        existsSync(job.outputScriptPath)
          ? "The weekly long-form script was saved, but audio generation failed."
          : "Weekly long-form episode generation failed before audio was ready.",
      error: error instanceof Error ? error.message : "Unknown weekly long-form worker error",
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
