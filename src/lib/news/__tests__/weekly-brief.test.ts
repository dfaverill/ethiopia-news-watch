import { describe, expect, it } from "vitest";

import type { WeeklyBrief } from "@/lib/dashboard";
import { getReusableWeeklyBrief } from "@/lib/news/weekly-brief";

function buildWeeklyBrief(
  overrides: Partial<WeeklyBrief> = {},
): WeeklyBrief {
  return {
    status: "ready",
    generatedAt: "2026-04-02T06:30:03.900Z",
    windowStart: "2026-03-26T06:30:03.900Z",
    windowEnd: "2026-04-02T06:30:03.900Z",
    headline: "Ethiopia's Week",
    summary: "A weekly summary.",
    keyPoints: ["Point one"],
    sourceDifferences: ["Difference one"],
    watchList: ["Watch one"],
    note: "AI-generated from 12 recent items across 5 sources.",
    model: "gpt-5.4-mini",
    sourceCount: 5,
    storylineCount: 12,
    ...overrides,
  };
}

describe("getReusableWeeklyBrief", () => {
  it("reuses the cached weekly brief inside the seven-day window", () => {
    const brief = buildWeeklyBrief();

    expect(
      getReusableWeeklyBrief(brief, "2026-04-05T06:30:03.900Z"),
    ).toEqual(brief);
  });

  it("forces a new weekly brief after seven days have elapsed", () => {
    const brief = buildWeeklyBrief();

    expect(
      getReusableWeeklyBrief(brief, "2026-04-09T06:30:03.900Z"),
    ).toBeNull();
  });

  it("ignores cached briefs with invalid timestamps", () => {
    const brief = buildWeeklyBrief({
      generatedAt: "",
    });

    expect(
      getReusableWeeklyBrief(brief, "2026-04-05T06:30:03.900Z"),
    ).toBeNull();
  });

  it("reuses the cached weekly brief during the 24-hour OpenAI cooldown even if fresher content arrived", () => {
    const brief = buildWeeklyBrief();

    expect(
      getReusableWeeklyBrief(brief, "2026-04-03T05:30:03.900Z", {
        latestContentAt: "2026-04-03T01:15:00.000Z",
      }),
    ).toEqual(brief);
  });

  it("forces a new weekly brief after the daily cooldown when fresher source content arrived", () => {
    const brief = buildWeeklyBrief();

    expect(
      getReusableWeeklyBrief(brief, "2026-04-03T07:30:03.900Z", {
        latestContentAt: "2026-04-03T07:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("forces a new weekly brief when the source corpus changed", () => {
    const brief = buildWeeklyBrief();

    expect(
      getReusableWeeklyBrief(brief, "2026-04-03T07:30:03.900Z", {
        sourceCount: 6,
        storylineCount: 12,
      }),
    ).toBeNull();

    expect(
      getReusableWeeklyBrief(brief, "2026-04-03T07:30:03.900Z", {
        sourceCount: 5,
        storylineCount: 13,
      }),
    ).toBeNull();
  });
});
