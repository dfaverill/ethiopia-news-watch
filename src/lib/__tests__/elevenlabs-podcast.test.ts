import { describe, expect, it } from "vitest";

import {
  buildScriptedPodcastMarkdown,
  calculateScriptedDialogueCharacterCount,
  normalizeScriptedPodcastTurns,
} from "@/lib/elevenlabs-podcast";
import type { NotebookLmPreparedRequest } from "@/lib/notebooklm-podcast";

function createPreparedRequest(): NotebookLmPreparedRequest {
  return {
    brief: {
      status: "ready",
      generatedAt: "2026-04-07T20:00:00.000Z",
      windowStart: "2026-04-06T00:00:00.000Z",
      windowEnd: "2026-04-07T23:59:59.999Z",
      headline: "Last two days Ethiopia coverage",
      summary: "Short summary",
      keyPoints: [],
      sourceDifferences: [],
      watchList: [],
      note: null,
      model: "gpt-5.4",
      sourceCount: 3,
      storylineCount: 8,
    },
    coverageFingerprint: "coverage-123",
    jobKey: "job-123",
    notebookTitle: "Recent packet",
    prompt: "prompt",
    sourcePackets: [
      {
        source: "Addis Standard",
        fileName: "addis-standard.md",
        filePath: "",
        itemCount: 3,
        content: "# Addis Standard",
        auditFileName: "addis-standard-audit.md",
        auditContent: "audit",
        driveDocTitle: "Recent - Addis Standard",
      },
      {
        source: "ENA",
        fileName: "ena.md",
        filePath: "",
        itemCount: 4,
        content: "# ENA",
        auditFileName: "ena-audit.md",
        auditContent: "audit",
        driveDocTitle: "Recent - ENA",
      },
    ],
    sourceQuality: {
      isComprehensive: true,
      totalItems: 7,
      nonEmptyPacketCount: 2,
      richPacketCount: 2,
      fullArticlePacketCount: 1,
      issues: [],
      verifiedSparseSources: [],
      skippedInactiveSources: [],
      summary: "Recent source packet confirmed: 2 non-empty sources and 7 recent items passed the deep-dive preflight.",
    },
  };
}

describe("ElevenLabs scripted podcast helpers", () => {
  it("normalizes turns, strips host labels, and alternates speakers", () => {
    const turns = normalizeScriptedPodcastTurns([
      { speaker: "host_b", text: "HOST B: Opening line." },
      { text: "Second line without an explicit speaker." },
      { speaker: "host_a", text: "   " },
      { speaker: "host_a", text: "HOST A: Third line." },
    ]);

    expect(turns).toEqual([
      { speaker: "HOST_A", text: "Opening line." },
      { speaker: "HOST_B", text: "Second line without an explicit speaker." },
      { speaker: "HOST_A", text: "Third line." },
    ]);
  });

  it("counts dialogue characters across all turns", () => {
    const count = calculateScriptedDialogueCharacterCount([
      { speaker: "HOST_A", text: "Hello there." },
      { speaker: "HOST_B", text: "And good evening." },
    ]);

    expect(count).toBe("Hello there.And good evening.".length);
  });

  it("renders a markdown report with the analysis and final script", () => {
    const markdown = buildScriptedPodcastMarkdown(
      {
        headline: "Ethiopia News Watch | Apr 6 to Apr 7",
        theme: "Election tensions and diplomacy",
        summary: "A grounded two-day report.",
        keyThreads: [
          "Election security planning moved closer to the June vote.",
          "Diplomatic messaging stayed active around regional and AU engagement.",
        ],
        sourceDifferences: [
          "Addis Standard emphasized political strain.",
          "ENA stressed official diplomacy and state policy messaging.",
        ],
        turns: [
          { speaker: "HOST_A", text: "Welcome to Ethiopia News Watch." },
          { speaker: "HOST_B", text: "Here is the two-day report." },
        ],
      },
      createPreparedRequest(),
    );

    expect(markdown).toContain("# Ethiopia News Watch | Apr 6 to Apr 7");
    expect(markdown).toContain("## Key threads");
    expect(markdown).toContain("## Where sources differed");
    expect(markdown).toContain("HOST A: Welcome to Ethiopia News Watch.");
    expect(markdown).toContain("HOST B: Here is the two-day report.");
  });
});
