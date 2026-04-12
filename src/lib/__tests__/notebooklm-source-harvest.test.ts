import { describe, expect, it } from "vitest";

import {
  buildWeeklySourceCheck,
  buildWeeklyUploadCheck,
  extractVoaPodcastFeedEpisodes,
  extractVoaScheduleDayEntry,
  extractVoaVideoSitemapEntries,
  filterBoilerplateParagraphs,
  verifyNotebookLmItemRecency,
} from "@/lib/notebooklm-source-harvest";
import {
  extractInstagramTimelineItems,
  sanitizeOfficialSocialItem,
} from "@/lib/notebooklm-social-harvest";
import {
  extractVoaEpisodeDetail,
  extractVoaSectionCandidates,
  selectPreferredVoaAudioSource,
} from "@/lib/voa-audio-translation";

describe("NotebookLM source harvest helpers", () => {
  const brief = {
    windowStart: "2026-03-26T00:00:00.000Z",
    windowEnd: "2026-04-02T23:59:59.000Z",
  } as Parameters<typeof verifyNotebookLmItemRecency>[0]["brief"];

  it("drops Reporter subscription boilerplate while keeping article paragraphs", () => {
    const paragraphs = filterBoilerplateParagraphs("The Reporter Ethiopia", [
      "The National Bank of Ethiopia’s Monetary Policy Committee has warned that supply shocks could reverse inflation gains.",
      "Receive in-depth analysis, breaking news, and exclusive reports from Ethiopia and beyond.",
      "You’re almost there! Confirm your subscription to The Reporter Magazine to start receiving exclusive news.",
      "The committee said tighter policy should remain in place.",
    ]);

    expect(paragraphs).toEqual([
      "The National Bank of Ethiopia's Monetary Policy Committee has warned that supply shocks could reverse inflation gains.",
      "The committee said tighter policy should remain in place.",
    ]);
  });

  it("drops NEBE contact boilerplate from article text", () => {
    const paragraphs = filterBoilerplateParagraphs("NEBE", [
      "The National Election Board of Ethiopia held the 7th General Election free-airtime lottery for political parties.",
      "Telephone: (+251) 11-5510024 or (+251) 11-5510252",
      "Email: contact [at] nebe.org.et",
      "The board said the allocation framework is meant to ensure a free, impartial, and fair election.",
    ]);

    expect(paragraphs).toEqual([
      "The National Election Board of Ethiopia held the 7th General Election free-airtime lottery for political parties.",
      "The board said the allocation framework is meant to ensure a free, impartial, and fair election.",
    ]);
  });

  it("extracts VOA daily show candidates from the current section page", () => {
    const candidates = extractVoaSectionCandidates(`
      <div class="media-block">
        <a href="/a/8128303.html" title="ከምሽቱ 3:00 የአማርኛ ዜና">
          <span class="ico ico-audio ico--media-type"></span>
        </a>
        <div class="media-block__content">
          <a href="/a/8128303.html">
            <h4 class="media-block__title">ከምሽቱ 3:00 የአማርኛ ዜና</h4>
          </a>
        </div>
      </div>
      <div class="media-block">
        <a href="/a/8127873.html" title="Ignore video only">
          <span class="ico ico-video ico--media-type"></span>
        </a>
        <div class="media-block__content">
          <a href="/a/8127873.html">
            <h4 class="media-block__title">Ignore video only</h4>
          </a>
        </div>
      </div>
    `);

    expect(candidates).toEqual([
      {
        title: "ከምሽቱ 3:00 የአማርኛ ዜና",
        url: "https://amharic.voanews.com/a/8128303.html",
      },
      {
        title: "Ignore video only",
        url: "https://amharic.voanews.com/a/8127873.html",
      },
    ]);
  });

  it("extracts VOA direct audio sources and published time from an episode page", () => {
    const detail = extractVoaEpisodeDetail(
      `
        <meta name="twitter:player:stream" content="https://voa-ingest.example/playlist.m3u8" />
        <script>
          var analyticsData = {pub_datetime:"2026-03-30 18:00:00Z"};
        </script>
        <div class="intro">
          <p>የአማርኛ ዜና መግቢያ</p>
        </div>
        <div class="media-download">
          <a href="/audio/program_hq.mp3?download=1" title="128 kbps MP3">128 kbps MP3</a>
          <a href="/audio/program_32k.mp3?download=1" title="32 kbps MP3">32 kbps MP3</a>
        </div>
      `,
      "https://amharic.voanews.com/a/8128303.html",
    );

    expect(detail.publishedAt).toBe("2026-03-30T18:00:00.000Z");
    expect(detail.description).toBe("የአማርኛ ዜና መግቢያ");
    expect(selectPreferredVoaAudioSource(detail.audioSources)).toEqual({
      kind: "download",
      label: "32 kbps MP3",
      url: "https://amharic.voanews.com/audio/program_32k.mp3?download=1",
    });
  });

  it("extracts exact VOA podcast episodes from the official enclosure feed", async () => {
    const episodes = await extractVoaPodcastFeedEpisodes(`
      <?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
        <channel>
          <item>
            <title>ሐሙስ፡-ከምሽቱ ሦስት ሰዓት የአማርኛ ዜና - ኤፕሪል 2, 2026</title>
            <link>https://amharic.voanews.com/a/8127714.html</link>
            <guid>https://amharic.voanews.com/a/8127714.html</guid>
            <pubDate>Thu, 02 Apr 2026 21:00:00 +0300</pubDate>
            <description>Exact official audio episode.</description>
            <itunes:summary>Exact official audio episode.</itunes:summary>
            <enclosure url="https://voa-audio-ns.akamaized.net/vam/2026/04/02/20260402-180000-vam068-program_hq.mp3" type="audio/mpeg" length="22112256" />
          </item>
        </channel>
      </rss>
    `);

    expect(episodes).toEqual([
      {
        enclosureUrl:
          "https://voa-audio-ns.akamaized.net/vam/2026/04/02/20260402-180000-vam068-program_hq.mp3",
        publishedAt: "2026-04-02T18:00:00.000Z",
        summary: "Exact official audio episode.",
        title: "ሐሙስ፡-ከምሽቱ ሦስት ሰዓት የአማርኛ ዜና - ኤፕሪል 2, 2026",
        url: "https://amharic.voanews.com/a/8127714.html",
      },
    ]);
  });

  it("extracts exact daily VOA schedule evidence from the official schedule page", () => {
    const entry = extractVoaScheduleDayEntry(
      `
        <html>
          <head>
            <title>Schedule - Radio - VOA Amharic Audio Tube, ሐሙስ 2 ኤፕሪል 2026 - የአሜሪካ ድምፅ</title>
          </head>
          <body>
            <div class="schedule__item" data-switch-target="more-less-8127714">
              <h4 class="schedule__item-title">ሐሙስ፡-ከምሽቱ ሦስት ሰዓት የአማርኛ ዜና</h4>
              <p class="schedule__item-intro">ትክክለኛ ዕለታዊ የሬዲዮ ስርጭት ማስረጃ።</p>
            </div>
          </body>
        </html>
      `,
      "https://amharic.voanews.com/radio/schedule/68/2026/4/2",
    );

    expect(entry).toEqual({
      itemId: "8127714",
      publishedAt: "2026-04-02T00:00:00.000Z",
      scheduleUrl: "https://amharic.voanews.com/radio/schedule/68/2026/4/2",
      summary: "ትክክለኛ ዕለታዊ የሬዲዮ ስርጭት ማስረጃ።",
      title: "ሐሙስ፡-ከምሽቱ ሦስት ሰዓት የአማርኛ ዜና",
    });
  });

  it("extracts exact VOA video sitemap entries from the official sitemap xml", () => {
    const entries = extractVoaVideoSitemapEntries(`
      <urlset xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
        <url>
          <loc>https://amharic.voanews.com/a/8128303.html</loc>
          <video:video>
            <video:title>VOA Program</video:title>
            <video:publication_date>2026-03-20T22:06:27+03:00</video:publication_date>
          </video:video>
        </url>
      </urlset>
    `);

    expect(entries).toEqual([
      {
        url: "https://amharic.voanews.com/a/8128303.html",
        publishedAt: "2026-03-20T19:06:27.000Z",
        title: "VOA Program",
      },
    ]);
  });

  it("summarizes weekly VOA upload checks against the covered window", () => {
    const report = buildWeeklyUploadCheck({
      brief,
      exactEpisodes: [
        {
          enclosureUrl:
            "https://voa-audio-ns.akamaized.net/vam/2026/04/02/20260402-180000-vam068-program_hq.mp3",
          publishedAt: "2026-04-02T18:00:00.000Z",
          summary: "Exact official audio episode.",
          title: "Episode",
          url: "https://amharic.voanews.com/a/8127714.html",
        },
      ],
      latestArchiveListingDate: "ማርች 22, 2026",
      scheduleEntries: [
        {
          itemId: "8127322",
          publishedAt: "2026-04-01T00:00:00.000Z",
          scheduleUrl: "https://amharic.voanews.com/radio/schedule/68/2026/4/1",
          summary: "Schedule entry",
          title: "Apr 1 program",
        },
        {
          itemId: "8127714",
          publishedAt: "2026-04-02T00:00:00.000Z",
          scheduleUrl: "https://amharic.voanews.com/radio/schedule/68/2026/4/2",
          summary: "Schedule entry",
          title: "Apr 2 program",
        },
      ],
    });

    expect(report.exactUploadCount).toBe(1);
    expect(report.missingUploadDates).toEqual(["2026-04-01T00:00:00.000Z"]);
    expect(report.summary).toContain("VOA uploaded 1 exact archived audio item");
    expect(report.latestArchiveListingDate).toBe("ማርች 22, 2026");
  });

  it("summarizes a verified weekly source check for non-VOA sources", () => {
    const report = buildWeeklySourceCheck({
      source: "Ethiopia Insight",
      brief,
      items: [
        {
          title: "Item 1",
          url: "https://www.ethiopia-insight.com/2026/03/27/example/",
          publishedAt: "2026-03-27T12:00:00.000Z",
          language: "English",
          section: "Analysis",
          body: "Verified article body.",
          captureKind: "full-article",
          captureNote: null,
        },
      ],
      checkedSurfaces: [
        "https://www.ethiopia-insight.com/feed/",
        "https://www.ethiopia-insight.com/",
      ],
      coverageExhausted: true,
    });

    expect(report.status).toBe("verified-items-found");
    expect(report.verifiedItemCount).toBe(1);
    expect(report.summary).toContain("Verified 1 current-window item");
    expect(report.summary).toContain("Ethiopia Insight");
    expect(report.checkedSurfaceCount).toBe(2);
  });

  it("rejects stale pages when the source itself exposes an older date", () => {
    const verification = verifyNotebookLmItemRecency({
      source: "VOA Amharic",
      brief,
      title: "Fresh looking wrapper",
      body: "Fresh looking wrapper",
      publishedAt: "2026-04-02T23:11:30.000Z",
      url: "https://amharic.voanews.com/a/8128303.html",
      html: `
        <script>var analyticsData = {pub_datetime:"2026-03-20 19:06:27Z"};</script>
        <meta name="twitter:player:stream" content="https://voa-video-ns.akamaized.net/pangeavideo/2026/03/5/57/example.mp4?download=1" />
      `,
    });

    expect(verification.accepted).toBe(false);
    expect(verification.reason).toContain("older date");
  });

  it("rejects generic VOA audio tube wrappers even with a current timestamp", () => {
    const verification = verifyNotebookLmItemRecency({
      source: "VOA Amharic",
      brief,
      title: "VOA Amharic Audio Tube",
      body: "VOA Amharic Audio Tube (MC-45)",
      publishedAt: "2026-04-02T23:11:30.000Z",
      url: "https://amharic.voanews.com/t/68.html",
      html: `
        <meta property="og:url" content="https://amharic.voanews.com/t/68.html" />
        <script>var analyticsData = {pub_datetime:"2026-04-02 23:11:30Z"};</script>
      `,
    });

    expect(verification.accepted).toBe(false);
    expect(verification.reason).toContain("generic audio/live wrapper");
  });

  it("accepts current-window items and records recency evidence", () => {
    const verification = verifyNotebookLmItemRecency({
      source: "The Reporter Ethiopia",
      brief,
      title: "Economic reforms draw scrutiny",
      body: "A verified current article body.",
      publishedAt: "2026-03-30T10:00:00.000Z",
      url: "https://example.com/2026/03/30/economic-reforms",
      html: `
        <meta property="article:published_time" content="2026-03-30T10:00:00Z" />
      `,
    });

    expect(verification.accepted).toBe(true);
    expect(verification.note).toContain("published timestamp");
    expect(verification.note).toContain("page metadata");
  });

  it("extracts exact instagram timeline items from the public response json", () => {
    const items = extractInstagramTimelineItems(
      JSON.stringify({
        items: [
          {
            code: "DTest123",
            taken_at: 1774800000,
            caption: {
              text: "VOA Amharic weekly bulletin\nSecond line",
            },
          },
        ],
      }),
      "https://www.instagram.com/voaamharic/",
    );

    expect(items).toEqual([
      {
        body: "VOA Amharic weekly bulletin Second line",
        publishedAt: "2026-03-29T16:00:00.000Z",
        title: "VOA Amharic weekly bulletin",
        url: "https://www.instagram.com/p/DTest123/",
      },
    ]);
  });

  it("drops slogan-only ENA social posts that are not usable news text", () => {
    const sanitized = sanitizeOfficialSocialItem({
      source: "ENA",
      title: "Ethiopia Rises as a New Horizon of Hope",
      body: "Ethiopia Rises as a New Horizon of Hope",
    });

    expect(sanitized).toBeNull();
  });

  it("drops Addis Standard sponsored posts from official social supplements", () => {
    const sanitized = sanitizeOfficialSocialItem({
      source: "Addis Standard",
      title: "TUV Rheinland webinar",
      body:
        "#Sponsored_post: Ethiopia's import compliance requirements under the PVoC framework are becoming increasingly important for exporters and importers.",
    });

    expect(sanitized).toBeNull();
  });

  it("removes NEBE app-download promo tails from official social posts", () => {
    const sanitized = sanitizeOfficialSocialItem({
      source: "NEBE",
      title: "NEBE election update",
      body: [
        "The National Election Board said the free-airtime lottery for political parties was conducted in line with electoral rules and oversight procedures.",
        "Register with the app at https://play.google.com/store/apps/details?id=mirchaye and https://apps.apple.com/us/app/mirchaye/id6756587049",
        "#mirchaye #election",
      ].join(" "),
    });

    expect(sanitized).not.toBeNull();
    expect(sanitized?.body).toContain("free-airtime lottery");
    expect(sanitized?.body).not.toContain("play.google.com");
    expect(sanitized?.body).not.toContain("apps.apple.com");
    expect(sanitized?.body).not.toContain("#mirchaye");
  });

  it("removes Telegram read more tails and humanizes hashtag-led Addis titles", () => {
    const sanitized = sanitizeOfficialSocialItem({
      source: "Addis Standard",
      title:
        "#Ethiopia: Election Board warns polls could be canceled where illegal coercion persists",
      body:
        "#Ethiopia: Election Board warns polls could be canceled where illegal coercion persists. The National Election Board of Ethiopia said constituencies could lose polling if irregularities continue. Read more: https://addisstandard.com/story",
    });

    expect(sanitized).not.toBeNull();
    expect(sanitized?.title).toContain("Ethiopia");
    expect(sanitized?.title).not.toContain("#");
    expect(sanitized?.body).not.toContain("Read more:");
    expect(sanitized?.body).not.toContain("https://");
  });
});
