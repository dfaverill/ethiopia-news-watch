import { beforeEach, describe, expect, it, vi } from "vitest";

const { translateNewsItemToEnglish } = vi.hoisted(() => ({
  translateNewsItemToEnglish: vi.fn(),
}));
const { fetchGoogleNewsFallback } = vi.hoisted(() => ({
  fetchGoogleNewsFallback: vi.fn(),
}));

vi.mock("@/lib/amharic-text-translation", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/amharic-text-translation")>(
      "@/lib/amharic-text-translation",
    );

  return {
    ...actual,
    translateNewsItemToEnglish,
  };
});

vi.mock("@/lib/news/google-news", () => ({
  fetchGoogleNewsFallback,
}));

import {
  addisStandardAdapter,
  selectAddisStandardFallbackItems,
} from "@/lib/news/sources/addis-standard";
import { buildNormalizedItem } from "@/lib/news/sources/helpers";

describe("Addis Standard source adapter helpers", () => {
  beforeEach(() => {
    translateNewsItemToEnglish.mockReset();
    fetchGoogleNewsFallback.mockReset();
  });

  it("keeps the freshest current-week Addis Standard matches when newer titles are multilingual", async () => {
    translateNewsItemToEnglish.mockImplementation(
      async ({ title }: { title: string }) => {
        if (title.includes("Wayita Mootummaan Federaalaa")) {
          return {
            title:
              "More than 700 Eritreans reportedly crossed into Tigray for a celebration as the federal government accuses Eritrea of interference",
            body:
              "Addis Standard reports that more than 700 Eritreans crossed into Tigray for a celebration at a time when the federal government is accusing Eritrea of interference.",
            captureNote: "Translated into English using gpt-5.4-mini.",
            model: "gpt-5.4-mini",
          };
        }

        return null;
      },
    );

    const newerMultilingualItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "Wayita Mootummaan Federaalaa Eertiraa giddu seentummaan himatutti Eertiraonni 700 ol ayyaaneffannaaf gara Tigraay ceuun gabaafame",
      url: "https://news.google.com/rss/articles/newer",
      publishedAt: "2026-04-06T13:50:20.000Z",
      attemptedAt: "2026-04-07T03:25:48.755Z",
      snippet:
        "Recent Addis Standard publisher match surfaced through Google News current-week indexing.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });
    const olderRelevantItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "Gold exports surge to $3.5 billion as Ethiopia pivots toward mining-led growth",
      url: "https://news.google.com/rss/articles/older",
      publishedAt: "2026-04-01T08:26:04.000Z",
      attemptedAt: "2026-04-07T03:25:48.755Z",
      snippet:
        "English Addis Standard coverage about Ethiopia's mining-led growth.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });

    const selection = await selectAddisStandardFallbackItems(
      [newerMultilingualItem, olderRelevantItem],
      "2026-04-07T03:25:48.755Z",
    );

    expect(selection.items[0]?.title).toContain(
      "More than 700 Eritreans reportedly crossed into Tigray",
    );
    expect(selection.diagnostics.join(" ")).toContain(
      "fresher current-week Addis Standard publisher matches",
    );
  });

  it("collapses same-day multilingual Addis Standard duplicates and keeps the English variant", async () => {
    translateNewsItemToEnglish.mockImplementation(
      async ({ title }: { title: string }) => {
        if (title.includes("Baankiin Biyyaalessaa")) {
          return {
            title:
              "National Bank discloses 23 foreign-exchange transfer institutions operating without a license; warns the public to be cautious",
            body:
              "The National Bank has disclosed 23 foreign-exchange transfer institutions operating without a license and has warned the public to be cautious of them.",
            captureNote: "Translated into English using gpt-5.4-mini.",
            model: "gpt-5.4-mini",
          };
        }

        return null;
      },
    );

    const englishItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "National Bank lists 23 unauthorized money transfer providers, warns public against use",
      url: "https://news.google.com/rss/articles/english-1",
      publishedAt: "2026-04-04T06:53:13.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "The National Bank of Ethiopia listed 23 unauthorized money transfer providers and warned the public against using them.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });
    const oromoItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "Baankiin Biyyaalessaa dhaabbilee maallaqa dabarsan seeraan ala taan 23 tarreesse, uummata akeekkachiise",
      url: "https://news.google.com/rss/articles/oromo-1",
      publishedAt: "2026-04-04T07:01:00.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "Baankiin Biyyaalessaa Itiyoophiyaa dhaabbilee maallaqa dabarsan seeraan ala taan 23 tarreessee uummata akeekkachiise.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });

    const selection = await selectAddisStandardFallbackItems(
      [englishItem, oromoItem],
      "2026-04-06T18:00:00.000Z",
    );

    expect(selection.items).toHaveLength(1);
    expect(selection.items[0]?.title).toBe(englishItem.title);
    expect(selection.diagnostics.join(" ")).toContain(
      "Collapsed 1 probable same-day Addis Standard multilingual duplicate",
    );
  });

  it("keeps distinct same-day Addis Standard stories when translation does not align them", async () => {
    translateNewsItemToEnglish.mockImplementation(
      async ({ title }: { title: string }) => {
        if (title.includes("Poolisiin")) {
          return {
            title:
              "Federal Police arrest international human trafficker and nine accomplices",
            body:
              "Ethiopian Federal Police said they arrested an international human trafficker and nine accomplices.",
            captureNote: "Translated into English using gpt-5.4-mini.",
            model: "gpt-5.4-mini",
          };
        }

        return null;
      },
    );

    const englishItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "Trump Escalates Threats to Decimate Iran's Power Grid, Bridges as Deadline Nears",
      url: "https://news.google.com/rss/articles/english-2",
      publishedAt: "2026-04-06T10:00:00.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "US President Donald Trump has warned that his country could launch devastating strikes on Iran's infrastructure.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });
    const oromoItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "Poolisiin mootummaa federaalaa nama daldala namaa idil-addunyaa fi gargaartota sagal hidhachuu beeksise",
      url: "https://news.google.com/rss/articles/oromo-2",
      publishedAt: "2026-04-06T11:00:00.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "Poolisiin mootummaa federaalaa nama daldala namaa idil-addunyaa fi gargaartota sagal hidhachuu beeksise.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });

    const selection = await selectAddisStandardFallbackItems(
      [englishItem, oromoItem],
      "2026-04-06T18:00:00.000Z",
    );

    expect(selection.items).toHaveLength(2);
    expect(selection.items.map((item) => item.title)).toEqual([
      "Federal Police arrest international human trafficker and nine accomplices",
      englishItem.title,
    ]);
  });

  it("translates surviving Addis Standard Oromo feed items into English for display", async () => {
    translateNewsItemToEnglish.mockImplementation(
      async ({ title }: { title: string }) => {
        if (title.includes("Filannoo2026")) {
          return {
            title:
              "Election2026 - Oromia at a crossroads: electoral competition, shrinking political space, and the risk of renewed one-party rule",
            body:
              "An Addis Standard analysis says Oromia faces a narrowing political space and a renewed risk of one-party rule ahead of the election.",
            captureNote: "Translated into English using gpt-5.4-mini.",
            model: "gpt-5.4-mini",
          };
        }

        return null;
      },
    );

    const oromoItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "Filannoo2026 – Oromiyaan daandii qaxxaamuraarra: dorgommii filannoo, dirreen siyaasaa dhiphachuufi carraa naannichi deebi'ee bulchiinsa paartii tokko qofaa jalatti kufuu",
      url: "https://news.google.com/rss/articles/oromo-3",
      publishedAt: "2026-04-06T14:02:08.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "Xiinxalli Addis Standard mootummaa paartii tokkootti deebi'uu danda'u irratti akeekkachiisa.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });

    const selection = await selectAddisStandardFallbackItems(
      [oromoItem],
      "2026-04-06T18:00:00.000Z",
    );

    expect(selection.items).toHaveLength(1);
    expect(selection.items[0]?.title).toContain(
      "Election2026 - Oromia at a crossroads",
    );
    expect(selection.diagnostics.join(" ")).toContain(
      "Translated 1 Addis Standard non-English item into English for feed display",
    );
  });

  it("hides Addis Standard items that still remain non-English after translation", async () => {
    translateNewsItemToEnglish.mockImplementation(
      async ({ title }: { title: string }) => {
        if (title.includes("Yaadawwan waraanaa")) {
          return {
            title:
              "Yaadawwan waraanaa hubannoo namtolcheen qindaa'an, Itoophiyaafi Eertiraa jidduutti qoccolloo gama maarsariitiin taasifamu hammeessaa jiru – gabaasa",
            body:
              "Yaadawwan waraanaa hubannoo namtolcheen qindaa'an, Itoophiyaafi Eertiraa jidduutti qoccolloo gama maarsariitiin taasifamu hammeessaa jiru – gabaasa",
            captureNote: "Translated into English using gpt-5.4-mini.",
            model: "gpt-5.4-mini",
          };
        }

        return null;
      },
    );

    const oromoItem = buildNormalizedItem({
      source: "Addis Standard",
      title:
        "Yaadawwan waraanaa hubannoo namtolcheen qindaa'an, Itoophiyaafi Eertiraa jidduutti qoccolloo gama maarsariitiin taasifamu hammeessaa jiru – gabaasa",
      url: "https://news.google.com/rss/articles/oromo-4",
      publishedAt: "2026-04-03T16:32:58.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "Yaadawwan waraanaa hubannoo namtolcheen qindaa'an irratti gabaasa Addis Standard.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });

    const selection = await selectAddisStandardFallbackItems(
      [oromoItem],
      "2026-04-06T18:00:00.000Z",
    );

    expect(selection.items).toHaveLength(0);
    expect(selection.diagnostics.join(" ")).toContain(
      "Hidden 1 Addis Standard item that still did not resolve to English after translation",
    );
  });

  it("treats the monitored Addis Standard publisher-index route as healthy when it succeeds", async () => {
    fetchGoogleNewsFallback.mockResolvedValue([
      {
        title:
          "Brazil authorized to export meat, 16 other products to Ethiopia, official says",
        url: "https://news.google.com/rss/articles/example-addis",
        publishedAt: "2026-04-08T11:40:08.000Z",
        snippet:
          "Addis Standard publisher indexing surfaced a current-week Ethiopia story.",
      },
    ]);

    const result = await addisStandardAdapter.fetchItems();

    expect(result.status).toBe("online");
    expect(result.healthKind).toBe("healthy");
    expect(result.usedCachedItems).toBe(false);
    expect(result.note).toContain("monitored current-week publisher indexing");
    expect(result.items).toHaveLength(1);
  });
});
