import { describe, expect, it } from "vitest";

import {
  buildNotebookLmAudioProofPath,
  NOTEBOOKLM_NOTEBOOK_TITLE,
  buildNotebookLmDriveDocTitle,
  buildNotebookLmPodcastPrompt,
  buildSourcePacketContent,
  createUploadReadyPacketDraft,
  evaluateNotebookLmSourceComprehensiveness,
  normalizeNotebookLmStoredState,
} from "@/lib/notebooklm-podcast";
import type { NotebookLmPacketDraft } from "@/lib/notebooklm-source-harvest";

function createDraft(
  source: string,
  items: Array<{
    body: string;
    captureKind:
      | "full-article"
      | "rss-excerpt"
      | "mirror-excerpt"
      | "translated-transcript"
      | "social-post"
      | "dashboard-snippet"
      | "headline-record";
  }>,
  options?: {
    coverageExhausted?: boolean;
    weeklySourceCheck?: NotebookLmPacketDraft["weeklySourceCheck"];
  },
) {
  return {
    source,
    diagnostics: [],
    coverageExhausted: options?.coverageExhausted ?? false,
    checkedSurfaces: options?.coverageExhausted ? ["https://example.com"] : [],
    weeklySourceCheck: options?.weeklySourceCheck ?? null,
    weeklyUploadCheck: null,
    items: items.map((item, index) => ({
      title: `${source} item ${index + 1}`,
      url: `https://example.com/${source}/${index + 1}`,
      publishedAt: "2026-03-29T12:00:00.000Z",
      language: "English" as const,
      section: "News",
      captureNote: null,
      ...item,
    })),
  } satisfies NotebookLmPacketDraft;
}

describe("NotebookLM podcast helpers", () => {
  it("locks the podcast notebook title to the shared reusable notebook", () => {
    expect(NOTEBOOKLM_NOTEBOOK_TITLE).toBe("Ethiopia News");
  });

  it("uses stable Drive doc titles for the reusable source documents", () => {
    expect(buildNotebookLmDriveDocTitle("Addis Standard")).toBe(
      "Ethiopia News - Addis Standard",
    );
  });

  it("uses the same reusable notebook title for the recent two-day packet", () => {
    expect(buildNotebookLmDriveDocTitle("ENA", "recent")).toBe(
      "Ethiopia News - ENA",
    );
  });

  it("uses a per-job proof file before exposing completed audio", () => {
    expect(buildNotebookLmAudioProofPath("job-123")).toContain("job-123.ready.json");
  });

  it("accepts legacy weekly state files so existing audio stays playable", () => {
    const normalized = normalizeNotebookLmStoredState(
      {
        schemaVersion: 1,
        provider: "google-notebooklm",
        mode: "deep-dive-long",
        status: "ready",
        jobKey: "weekly-job-1",
        audioPath: "D:\\audio\\weekly.m4a",
      },
      "weekly",
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.scope).toBe("weekly");
    expect(normalized?.jobKey).toBe("weekly-job-1");
    expect(normalized?.audioPath).toBe("D:\\audio\\weekly.m4a");
  });

  it("keeps all distinct source-authored news text while excluding fallback placeholders", () => {
    const uploadReady = createUploadReadyPacketDraft(
      createDraft("ENA", [
        { captureKind: "full-article", body: "Recovered ENA publication body about Ethiopia's election process in Addis Ababa." },
        { captureKind: "translated-transcript", body: "Translated official transcript about Ethiopia's election process in Addis Ababa." },
        { captureKind: "social-post", body: "Official ENA social post about Ethiopia's election process in Addis Ababa." },
        { captureKind: "rss-excerpt", body: "RSS excerpt about Ethiopia's election process in Addis Ababa." },
        { captureKind: "mirror-excerpt", body: "Mirror excerpt about Ethiopia's election process in Addis Ababa." },
        { captureKind: "headline-record", body: "Headline placeholder only." },
        { captureKind: "dashboard-snippet", body: "Dashboard fallback only." },
      ], { coverageExhausted: true }),
    );

    expect(uploadReady.items.map((item) => item.captureKind)).toEqual([
      "full-article",
      "translated-transcript",
      "rss-excerpt",
      "mirror-excerpt",
      "social-post",
    ]);
  });

  it.skip("drops only empty upload items after sanitization", () => {
    const uploadReady = createUploadReadyPacketDraft(
      createDraft("VOA Amharic", [
        {
          captureKind: "translated-transcript",
          body: "This English transcript is safe to upload.",
        },
        {
          captureKind: "full-article",
          body: "ይህ ጽሑፍ አማርኛ ነው",
        },
      ], { coverageExhausted: true }),
    );

    expect(uploadReady.items).toHaveLength(1);
    expect(uploadReady.items[0]?.body).toContain("English transcript");
  });

  it("drops empty source-authored items after sanitization", () => {
    const uploadReady = createUploadReadyPacketDraft(
      createDraft("VOA Amharic", [
        {
          captureKind: "translated-transcript",
          body: "This English transcript covers Ethiopia's election update in Addis Ababa.",
        },
        { captureKind: "social-post", body: "" },
      ], { coverageExhausted: true }),
    );

    expect(uploadReady.items).toHaveLength(1);
    expect(uploadReady.items[0]?.body).toContain("English transcript");
  });

  it("deduplicates repeated same-network reposts and keeps the richer version", () => {
    const draft = createDraft("ENA", [
        {
          captureKind: "social-post",
          body: "Government officials said the national dialogue forum opened in Addis Ababa and Tigray stakeholders called it an important step toward peaceful dialogue.",
        },
        {
          captureKind: "full-article",
          body: "Government officials said the national dialogue forum opened in Addis Ababa and Tigray stakeholders called it an important step toward peaceful dialogue. The full website publication added institutional detail, quotations, and additional context from the forum proceedings.",
        },
      ], { coverageExhausted: true });
    draft.items[0].title = "National dialogue forum opens in Addis Ababa";
    draft.items[1].title = "National dialogue forum opens in Addis Ababa";
    const uploadReady = createUploadReadyPacketDraft(draft);

    expect(uploadReady.items).toHaveLength(1);
    expect(uploadReady.items[0]?.captureKind).toBe("full-article");
  });

  it("collapses translated and English same-source variants when they resolve to the same publication", () => {
    const draft = createDraft("ENA", [
      {
        captureKind: "full-article",
        body:
          "The ministry said adequate preparations are in place across Ethiopia to prevent shortages and price increases in basic consumer goods following the Easter holiday, with monitoring teams deployed in Addis Ababa and the regions.",
      },
      {
        captureKind: "full-article",
        body:
          "The ministry said preparations are in place across Ethiopia to prevent shortages and price hikes in basic consumer goods after the Easter holiday, with market monitoring teams deployed in Addis Ababa and the regional states.",
      },
    ], { coverageExhausted: true });
    draft.items[0].title =
      "Adequate preparations have been made to prevent shortages and price increases in basic consumer goods following the Easter holiday";
    draft.items[0].url = "https://www.ena.et/web/amh/w/amh_8616915";
    draft.items[0].captureNote =
      "Translated into English using gpt-5.4-mini.";
    draft.items[1].title =
      "Preparations are in place to prevent shortages and price hikes in consumer goods after Easter";
    draft.items[1].url = "https://www.ena.et/web/eng/w/eng_8616915";

    const uploadReady = createUploadReadyPacketDraft(draft);

    expect(uploadReady.items).toHaveLength(1);
    expect(uploadReady.items[0]?.url).toBe(
      "https://www.ena.et/web/eng/w/eng_8616915",
    );
  });

  it("leans toward inclusion for related same-source stories with different angles", () => {
    const draft = createDraft("ENA", [
      {
        captureKind: "full-article",
        body:
          "President Taye said Ethiopia will remember Ambassador Konjit Sinegiorgis for her wise diplomatic leadership, long public service, and representation of Addis Ababa in African diplomacy.",
      },
      {
        captureKind: "full-article",
        body:
          "Prime Minister Abiy extended condolences over the death of Ambassador Konjit and said Ethiopia had lost a veteran diplomat whose public service reached across multiple institutions.",
      },
    ], { coverageExhausted: true });
    draft.items[0].title =
      "Ambassador Konjit Will Always Be Remembered in the Diplomatic Field";
    draft.items[0].url = "https://www.ena.et/web/eng/w/eng_8614699";
    draft.items[1].title =
      "Prime Minister Abiy Extends Condolences over Death of Veteran Diplomat Ambassador Konjit";
    draft.items[1].url = "https://www.ena.et/web/eng/w/eng_8617464";

    const uploadReady = createUploadReadyPacketDraft(draft);

    expect(uploadReady.items).toHaveLength(2);
  });

  it("rejects source-context-only global stories that lack explicit Ethiopia context", () => {
    const draft = createDraft("ENA", [
      {
        captureKind: "full-article",
        body:
          "French President Emmanuel Macron said Thursday that using military force to reopen the Strait of Hormuz would be unrealistic. He emphasized diplomacy and criticized calls for a military solution.",
      },
      {
        captureKind: "full-article",
        body:
          "The National Bank of Ethiopia and the People's Bank of China discussed trade financing and monetary cooperation to support Ethiopia's economy and bilateral investment ties.",
      },
    ], { coverageExhausted: true });
    draft.items[0].title =
      "French Macron Rejects Military Option for Strait of Hormuz, Urges Diplomacy";
    draft.items[1].title =
      "Ethiopia's Central Bank, PBOC Strengthen Strategic Financial Partnership";

    const uploadReady = createUploadReadyPacketDraft(draft);

    expect(uploadReady.items).toHaveLength(1);
    expect(uploadReady.items[0]?.title).toContain("Ethiopia's Central Bank");
  });

  it("drops mixed global roundup social posts even when they mention Ethiopia once", () => {
    const draft = createDraft("Addis Standard", [
      {
        captureKind: "social-post",
        body:
          "Top stories from Addis Standard covering major developments across global and regional affairs: U.S. President Donald Trump warns Iran of possible heavy strikes in the coming weeks, escalating geopolitical tensions. Ethiopia records up to a 26% surge in fuel prices.",
      },
    ], { coverageExhausted: true });
    draft.items[0].title =
      "Trump Warns Iran of Severe Strike | Ethiopia Fuel Prices Surge 26% | Sudan-Egypt Row & Somalia";

    const uploadReady = createUploadReadyPacketDraft(draft);

    expect(uploadReady.items).toHaveLength(0);
  });

  it("omits packet-organization process wording from NotebookLM source docs", () => {
    const content = buildSourcePacketContent("ENA", [
      {
        title: "National dialogue forum opens in Addis Ababa",
        url: "https://www.ena.et/web/eng/w/eng_12345",
        publishedAt: "2026-03-29T12:00:00.000Z",
        language: "English",
        section: "News",
        captureKind: "full-article",
        captureNote: null,
        body:
          "Government officials said the national dialogue forum opened in Addis Ababa and Tigray stakeholders called it an important step toward peaceful dialogue.",
      },
    ]);

    expect(content).not.toContain("How this packet is organized");
    expect(content).not.toContain("Entries are grouped by source platform below");
    expect(content).not.toContain("Same-network reposts");
  });

  it("keeps the Ethiopia News Watch hosting instructions in the prompt", () => {
    const prompt = buildNotebookLmPodcastPrompt({
      headline: "Test headline",
      summary: "Test summary",
      keyPoints: [],
      sourceDifferences: [],
      sourceCount: 5,
      sourceNames: ["Addis Standard"],
      itemCount: 12,
      windowStart: "2026-03-25T12:00:00.000Z",
      windowEnd: "2026-04-01T12:00:00.000Z",
      generatedAt: "2026-04-01T12:00:00.000Z",
      available: true,
    });

    expect(prompt).toContain("professional news presenters");
    expect(prompt).toContain("Ethiopia News Watch website");
    expect(prompt).toContain("Do not start with a dramatic scene opener.");
    expect(prompt).toContain("single seven-day reporting window");
    expect(prompt).toContain(
      "Do not add a disclaimer about not personally endorsing the beliefs, claims, or events being discussed.",
    );
    expect(prompt).toContain("Coverage window: Mar 25 to Apr 1.");
  });

  it("builds a recent two-day prompt with the exact shorter window", () => {
    const prompt = buildNotebookLmPodcastPrompt({
      headline: "Test headline",
      summary: "Test summary",
      keyPoints: [],
      sourceDifferences: [],
      sourceCount: 3,
      sourceNames: ["ENA"],
      itemCount: 7,
      windowStart: "2026-04-05T00:00:00.000Z",
      windowEnd: "2026-04-06T23:59:59.999Z",
      generatedAt: "2026-04-06T12:00:00.000Z",
      available: true,
    }, "recent");

    expect(prompt).toContain("last-two-days audio overview");
    expect(prompt).toContain("single two-day reporting window");
    expect(prompt).toContain("Coverage window: Apr 5 to Apr 6.");
  });

  it("accepts packet sets that are comprehensive enough for a deep dive", () => {
    const report = evaluateNotebookLmSourceComprehensiveness([
      createDraft("Addis Standard", [
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
      ], { coverageExhausted: true }),
      createDraft("ENA", [
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "social-post", body: "Official ENA social post. ".repeat(60) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "social-post", body: "Official ENA social post. ".repeat(60) },
      ], { coverageExhausted: true }),
      createDraft("The Reporter Ethiopia", [
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
      ], { coverageExhausted: true }),
      createDraft("Ethiopia Insight", [
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
      ], { coverageExhausted: true }),
      createDraft("NEBE", [
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
      ], { coverageExhausted: true }),
      createDraft("VOA Amharic", [
        {
          captureKind: "translated-transcript",
          body: "Translated VOA Amharic episode transcript in English. ".repeat(220),
        },
        {
          captureKind: "translated-transcript",
          body: "Translated VOA Amharic episode transcript in English. ".repeat(220),
        },
      ], { coverageExhausted: true }),
    ]);

    expect(report.isComprehensive).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it("blocks packet sets that are too thin for a deep dive", () => {
    const report = evaluateNotebookLmSourceComprehensiveness([
      createDraft("Addis Standard", [
        { captureKind: "headline-record", body: "Headline only." },
      ]),
      createDraft("ENA", [
        { captureKind: "headline-record", body: "Headline only." },
      ]),
      createDraft("VOA Amharic", []),
    ]);

    expect(report.isComprehensive).toBe(false);
    expect(report.summary).toContain("Deep dive blocked");
    expect(report.issues.join(" ")).toContain("VOA Amharic");
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("accepts verified sparse sources when official surfaces were exhausted", () => {
    const report = evaluateNotebookLmSourceComprehensiveness([
      createDraft("Addis Standard", [
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
      ], { coverageExhausted: true }),
      createDraft("ENA", [
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "social-post", body: "Official ENA social post. ".repeat(120) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "social-post", body: "Official ENA social post. ".repeat(120) },
      ], { coverageExhausted: true }),
      createDraft("The Reporter Ethiopia", [
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
      ], { coverageExhausted: true }),
      createDraft("Ethiopia Insight", [
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
      ], { coverageExhausted: true }),
      createDraft("NEBE", [
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
      ], { coverageExhausted: true }),
      createDraft("VOA Amharic", [
        {
          captureKind: "translated-transcript",
          body: "Translated VOA Amharic episode transcript in English. ".repeat(220),
        },
      ], { coverageExhausted: true }),
    ]);

    expect(report.isComprehensive).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.verifiedSparseSources.join(" ")).toContain("VOA Amharic");
    expect(report.verifiedSparseSources.join(" ")).toContain("Ethiopia Insight");
  });

  it("temporarily skips VOA when it has no verified current-week archived material", () => {
    const report = evaluateNotebookLmSourceComprehensiveness([
      createDraft("Addis Standard", [
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
        { captureKind: "headline-record", body: "Resolved exact publisher record.".repeat(20) },
      ], { coverageExhausted: true }),
      createDraft("ENA", [
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "social-post", body: "Official ENA social post. ".repeat(120) },
        { captureKind: "social-post", body: "Official ENA social post. ".repeat(120) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
      ], { coverageExhausted: true }),
      createDraft("The Reporter Ethiopia", [
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) },
      ], { coverageExhausted: true }),
      createDraft("Ethiopia Insight", [
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
      ], { coverageExhausted: true }),
      createDraft("NEBE", [
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
        { captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) },
      ], { coverageExhausted: true }),
      createDraft("VOA Amharic", [], {
        coverageExhausted: true,
        weeklySourceCheck: {
          checkedSurfaceCount: 6,
          checkedWindowEnd: "2026-04-02T23:59:59.000Z",
          checkedWindowStart: "2026-03-26T00:00:00.000Z",
          coverageExhausted: true,
          latestVerifiedItemAt: null,
          method: "Checked official VOA archive and social surfaces.",
          status: "no-current-items-found",
          summary: "Checked official VOA surfaces and found no verified current-window items in this 7-day window.",
          verifiedItemCount: 0,
          verifiedItemDates: [],
        },
      }),
    ]);

    expect(report.isComprehensive).toBe(true);
    expect(report.skippedInactiveSources).toContain("VOA Amharic");
    expect(report.issues.join(" ")).not.toContain("VOA Amharic");
    expect(report.summary).toContain(
      "Temporarily skipped sources without recoverable source-authored current-week text this week: VOA Amharic",
    );
  });

  it("accepts a three-packet week when the missing sources were exhaustively checked", () => {
    const report = evaluateNotebookLmSourceComprehensiveness([
      createDraft("ENA", [
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
        { captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) },
      ], { coverageExhausted: true }),
      createDraft("Ethiopia Insight", [
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered Insight text. ".repeat(220) },
      ], { coverageExhausted: true }),
      createDraft("NEBE", [
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
        { captureKind: "full-article", body: "Long recovered NEBE text. ".repeat(220) },
      ], { coverageExhausted: true }),
      createDraft("The Reporter Ethiopia", [], { coverageExhausted: true }),
      createDraft("Addis Standard", [], {
        coverageExhausted: true,
        weeklySourceCheck: {
          checkedSurfaceCount: 4,
          checkedWindowEnd: "2026-04-02T23:59:59.000Z",
          checkedWindowStart: "2026-03-26T00:00:00.000Z",
          coverageExhausted: true,
          latestVerifiedItemAt: null,
          method: "Checked official Addis Standard surfaces.",
          status: "no-current-items-found",
          summary: "Checked official Addis Standard surfaces and found no verified current-window items in this 7-day window.",
          verifiedItemCount: 0,
          verifiedItemDates: [],
        },
      }),
      createDraft("VOA Amharic", [], {
        coverageExhausted: true,
        weeklySourceCheck: {
          checkedSurfaceCount: 6,
          checkedWindowEnd: "2026-04-02T23:59:59.000Z",
          checkedWindowStart: "2026-03-26T00:00:00.000Z",
          coverageExhausted: true,
          latestVerifiedItemAt: null,
          method: "Checked official VOA surfaces.",
          status: "no-current-items-found",
          summary: "Checked official VOA surfaces and found no verified current-window items in this 7-day window.",
          verifiedItemCount: 0,
          verifiedItemDates: [],
        },
      }),
    ]);

    expect(report.isComprehensive).toBe(true);
    expect(report.issues.join(" ")).not.toContain("Need at least 4 non-empty source packets");
  });

  it("treats translated official audio transcripts as rich source material", () => {
    const report = evaluateNotebookLmSourceComprehensiveness([
      createDraft(
        "VOA Amharic",
        [
          {
            captureKind: "translated-transcript",
            body: "Translated VOA Amharic episode transcript in English. ".repeat(220),
          },
          {
            captureKind: "translated-transcript",
            body: "Translated VOA Amharic episode transcript in English. ".repeat(220),
          },
        ],
        { coverageExhausted: true },
      ),
      createDraft(
        "ENA",
        [{ captureKind: "full-article", body: "Long recovered ENA text. ".repeat(250) }],
        { coverageExhausted: true },
      ),
      createDraft(
        "The Reporter Ethiopia",
        [{ captureKind: "full-article", body: "Long recovered Reporter text. ".repeat(220) }],
        { coverageExhausted: true },
      ),
      createDraft(
        "NEBE",
        [{ captureKind: "social-post", body: "Official NEBE social post. ".repeat(150) }],
        { coverageExhausted: true },
      ),
    ]);

    expect(report.richPacketCount).toBeGreaterThanOrEqual(3);
    expect(report.summary).toContain("Deep dive blocked");
    expect(report.issues.join(" ")).not.toContain("VOA Amharic needs at least 2 recovered items");
  });
});
