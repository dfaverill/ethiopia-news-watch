import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeText(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

describe("podcast archive helpers", () => {
  let tempDirectory: string | null = null;
  const originalCacheDirectory = process.env.NEWS_WATCH_CACHE_DIR;

  afterEach(async () => {
    vi.resetModules();

    if (originalCacheDirectory === undefined) {
      delete process.env.NEWS_WATCH_CACHE_DIR;
    } else {
      process.env.NEWS_WATCH_CACHE_DIR = originalCacheDirectory;
    }

    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
      tempDirectory = null;
    }
  });

  it("lists saved weekly, recent, and scripted episodes from the archive", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "podcast-archive-"));
    process.env.NEWS_WATCH_CACHE_DIR = tempDirectory;

    const notebookAudioDirectory = path.join(tempDirectory, "notebooklm", "audio");
    const notebookAuditDirectory = path.join(
      tempDirectory,
      "notebooklm",
      "source-audits",
    );
    const elevenAudioDirectory = path.join(
      tempDirectory,
      "elevenlabs-podcast",
      "audio",
    );
    const elevenReportDirectory = path.join(
      tempDirectory,
      "elevenlabs-podcast",
      "reports",
    );

    const weeklyAudioPath = path.join(notebookAudioDirectory, "job-weekly-1.m4a");
    await writeText(weeklyAudioPath, "weekly-audio");
    await writeJson(path.join(notebookAudioDirectory, "weekly-job-weekly-1.ready.json"), {
      jobKey: "job-weekly-1",
      audioPath: weeklyAudioPath,
      generatedAt: "2026-04-08T21:32:01.272Z",
    });
    await writeText(
      path.join(notebookAuditDirectory, "job-weekly-1", "ena-audit.md"),
      [
        "# Ethiopia News Watch source audit",
        "Coverage window: Mar 26 to Apr 2",
        "Uploadable source-authored items: 12",
      ].join("\n"),
    );
    await writeText(
      path.join(notebookAuditDirectory, "job-weekly-1", "reporter-audit.md"),
      [
        "# Ethiopia News Watch source audit",
        "Coverage window: Mar 26 to Apr 2",
        "Uploadable source-authored items: 8",
      ].join("\n"),
    );

    const recentAudioPath = path.join(notebookAudioDirectory, "job-recent-1.m4a");
    await writeText(recentAudioPath, "recent-audio");
    await writeJson(path.join(notebookAudioDirectory, "recent-job-recent-1.ready.json"), {
      jobKey: "job-recent-1",
      audioPath: recentAudioPath,
      generatedAt: "2026-04-08T22:05:00.000Z",
    });
    await writeText(
      path.join(notebookAuditDirectory, "job-recent-1", "ena-audit.md"),
      [
        "# Ethiopia News Watch source audit",
        "Coverage window: Apr 7 to Apr 8",
        "Uploadable source-authored items: 18",
      ].join("\n"),
    );

    const scriptedAudioPath = path.join(elevenAudioDirectory, "script-job-1.mp3");
    await writeText(scriptedAudioPath, "scripted-audio");
    await writeJson(path.join(elevenAudioDirectory, "script-job-1.ready.json"), {
      jobKey: "script-job-1",
      audioPath: scriptedAudioPath,
      savedAt: "2026-04-08T04:15:44.225Z",
    });
    await writeJson(path.join(elevenReportDirectory, "script-job-1.json"), {
      request: {
        sourceLabel: "4 source packets across 31 coverage items",
        brief: {
          windowStart: "2026-04-07T00:00:00.000Z",
          windowEnd: "2026-04-08T23:59:59.999Z",
        },
      },
      report: {
        headline: "Election security and reform dominate Ethiopia's two-day agenda",
        theme: "Elections, diplomacy, economy, and humanitarian strain",
      },
    });

    const archive = await import("@/lib/podcast-archive");
    const collections = await archive.listPodcastArchiveCollections();

    expect(collections.weekly).toHaveLength(1);
    expect(collections.weekly[0]).toMatchObject({
      label: "Mar 26 to Apr 2",
      scope: "weekly",
      sourceLabel: "2 source packets across 20 coverage items",
    });
    expect(collections.weekly[0]?.audioUrl).toContain(
      "provider=google-notebooklm",
    );

    expect(collections.recent).toHaveLength(1);
    expect(collections.recent[0]).toMatchObject({
      label: "Apr 7 to Apr 8",
      scope: "recent",
      sourceLabel: "1 source packet across 18 coverage items",
    });

    expect(collections.scriptedRecent).toHaveLength(1);
    expect(collections.scriptedRecent[0]).toMatchObject({
      label: "Apr 7 to Apr 8",
      headline: "Election security and reform dominate Ethiopia's two-day agenda",
      theme: "Elections, diplomacy, economy, and humanitarian strain",
    });
  });

  it("excludes the currently active job and resolves archived audio safely", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "podcast-archive-"));
    process.env.NEWS_WATCH_CACHE_DIR = tempDirectory;

    const notebookAudioDirectory = path.join(tempDirectory, "notebooklm", "audio");
    const notebookAuditDirectory = path.join(
      tempDirectory,
      "notebooklm",
      "source-audits",
    );
    const weeklyAudioPath = path.join(notebookAudioDirectory, "current-weekly.m4a");
    const olderWeeklyAudioPath = path.join(notebookAudioDirectory, "older-weekly.m4a");

    await writeText(weeklyAudioPath, "current-weekly");
    await writeText(olderWeeklyAudioPath, "older-weekly");
    await writeJson(path.join(notebookAudioDirectory, "weekly-current-weekly.ready.json"), {
      jobKey: "current-weekly",
      audioPath: weeklyAudioPath,
      generatedAt: "2026-04-08T22:00:00.000Z",
    });
    await writeJson(path.join(notebookAudioDirectory, "weekly-older-weekly.ready.json"), {
      jobKey: "older-weekly",
      audioPath: olderWeeklyAudioPath,
      generatedAt: "2026-04-07T22:00:00.000Z",
    });
    await writeText(
      path.join(notebookAuditDirectory, "older-weekly", "ena-audit.md"),
      [
        "# Ethiopia News Watch source audit",
        "Coverage window: Mar 26 to Apr 2",
        "Uploadable source-authored items: 10",
      ].join("\n"),
    );

    const archive = await import("@/lib/podcast-archive");
    const collections = await archive.listPodcastArchiveCollections({
      currentNotebookLmJobKeys: {
        weekly: "current-weekly",
      },
    });

    expect(collections.weekly.map((entry) => entry.jobKey)).toEqual([
      "older-weekly",
    ]);

    const resolved = await archive.resolvePodcastArchiveAudioRecord({
      provider: "google-notebooklm",
      scope: "weekly",
      jobKey: "older-weekly",
    });

    expect(resolved?.audioPath).toBe(olderWeeklyAudioPath);
  });

  it("keeps only the most recently saved archive entry for each weekly and 48-hour date range", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "podcast-archive-"));
    process.env.NEWS_WATCH_CACHE_DIR = tempDirectory;

    const notebookAudioDirectory = path.join(tempDirectory, "notebooklm", "audio");
    const notebookAuditDirectory = path.join(
      tempDirectory,
      "notebooklm",
      "source-audits",
    );

    const olderWeeklyAudioPath = path.join(notebookAudioDirectory, "weekly-old.m4a");
    const newerWeeklyAudioPath = path.join(notebookAudioDirectory, "weekly-new.m4a");
    const olderRecentAudioPath = path.join(notebookAudioDirectory, "recent-old.m4a");
    const newerRecentAudioPath = path.join(notebookAudioDirectory, "recent-new.m4a");

    await writeText(olderWeeklyAudioPath, "weekly-old");
    await writeText(newerWeeklyAudioPath, "weekly-new");
    await writeText(olderRecentAudioPath, "recent-old");
    await writeText(newerRecentAudioPath, "recent-new");

    await writeJson(path.join(notebookAudioDirectory, "weekly-weekly-old.ready.json"), {
      jobKey: "weekly-old",
      audioPath: olderWeeklyAudioPath,
      generatedAt: "2026-04-07T10:00:00.000Z",
    });
    await writeJson(path.join(notebookAudioDirectory, "weekly-weekly-new.ready.json"), {
      jobKey: "weekly-new",
      audioPath: newerWeeklyAudioPath,
      generatedAt: "2026-04-08T10:00:00.000Z",
    });
    await writeText(
      path.join(notebookAuditDirectory, "weekly-old", "ena-audit.md"),
      [
        "# Ethiopia News Watch source audit",
        "Coverage window: Apr 1 to Apr 8",
        "Uploadable source-authored items: 11",
      ].join("\n"),
    );
    await writeText(
      path.join(notebookAuditDirectory, "weekly-new", "ena-audit.md"),
      [
        "# Ethiopia News Watch source audit",
        "Coverage window: Apr 1 to Apr 8",
        "Uploadable source-authored items: 14",
      ].join("\n"),
    );

    await writeJson(path.join(notebookAudioDirectory, "recent-recent-old.ready.json"), {
      jobKey: "recent-old",
      audioPath: olderRecentAudioPath,
      generatedAt: "2026-04-08T08:00:00.000Z",
    });
    await writeJson(path.join(notebookAudioDirectory, "recent-recent-new.ready.json"), {
      jobKey: "recent-new",
      audioPath: newerRecentAudioPath,
      generatedAt: "2026-04-08T12:00:00.000Z",
    });
    await writeText(
      path.join(notebookAuditDirectory, "recent-old", "ena-audit.md"),
      [
        "# Ethiopia News Watch source audit",
        "Coverage window: Apr 7 to Apr 8",
        "Uploadable source-authored items: 15",
      ].join("\n"),
    );
    await writeText(
      path.join(notebookAuditDirectory, "recent-new", "ena-audit.md"),
      [
        "# Ethiopia News Watch source audit",
        "Coverage window: Apr 7 to Apr 8",
        "Uploadable source-authored items: 18",
      ].join("\n"),
    );

    const archive = await import("@/lib/podcast-archive");
    const collections = await archive.listPodcastArchiveCollections();

    expect(collections.weekly).toHaveLength(1);
    expect(collections.weekly[0]).toMatchObject({
      jobKey: "weekly-new",
      label: "Apr 1 to Apr 8",
    });

    expect(collections.recent).toHaveLength(1);
    expect(collections.recent[0]).toMatchObject({
      jobKey: "recent-new",
      label: "Apr 7 to Apr 8",
    });
  });

  it("filters out saved podcast entries that do not have a real date range label", async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "podcast-archive-"));
    process.env.NEWS_WATCH_CACHE_DIR = tempDirectory;

    const notebookAudioDirectory = path.join(tempDirectory, "notebooklm", "audio");

    const weeklyAudioPath = path.join(notebookAudioDirectory, "weekly-no-range.m4a");
    await writeText(weeklyAudioPath, "weekly-no-range");
    await writeJson(
      path.join(notebookAudioDirectory, "weekly-weekly-no-range.ready.json"),
      {
        jobKey: "weekly-no-range",
        audioPath: weeklyAudioPath,
        generatedAt: "2026-04-08T22:00:00.000Z",
      },
    );

    const recentAudioPath = path.join(notebookAudioDirectory, "recent-no-range.m4a");
    await writeText(recentAudioPath, "recent-no-range");
    await writeJson(
      path.join(notebookAudioDirectory, "recent-recent-no-range.ready.json"),
      {
        jobKey: "recent-no-range",
        audioPath: recentAudioPath,
        generatedAt: "2026-04-08T23:00:00.000Z",
      },
    );

    const archive = await import("@/lib/podcast-archive");
    const collections = await archive.listPodcastArchiveCollections();

    expect(collections.weekly).toHaveLength(0);
    expect(collections.recent).toHaveLength(0);
    expect(collections.scriptedRecent).toHaveLength(0);
  });
});
