import { beforeEach, describe, expect, it, vi } from "vitest";

const { translateNewsItemToEnglish } = vi.hoisted(() => ({
  translateNewsItemToEnglish: vi.fn(),
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

import {
  collapseSameDayMultilingualDuplicates,
  translateItemsForEnglishDisplay,
} from "@/lib/news/multilingual-dedupe";
import { buildNormalizedItem } from "@/lib/news/sources/helpers";

describe("multilingual duplicate collapse", () => {
  beforeEach(() => {
    translateNewsItemToEnglish.mockReset();
  });

  it("collapses Addis Standard English and Oromo variants on the same day", async () => {
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
      url: "https://example.com/addis-english",
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
        "Baankiin Biyyaalessaa dhaabbilee daddabarsa maallaqa alaa hayyama hin qabne 23 ifoomse; uummannis akka irraa of eeggatu akeekkachiise",
      url: "https://example.com/addis-oromo",
      publishedAt: "2026-04-04T07:01:00.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "Baankiin Biyyaalessaa dhaabbilee daddabarsa maallaqa alaa hayyama hin qabne 23 ifoomse; uummannis akka irraa of eeggatu akeekkachiise.",
      section: "News",
      language: "English",
      sourceType: "search-fallback",
    });

    const deduped = await collapseSameDayMultilingualDuplicates([
      englishItem,
      oromoItem,
    ]);

    expect(deduped.collapsedCount).toBe(1);
    expect(deduped.items).toHaveLength(1);
    expect(deduped.items[0]?.title).toBe(englishItem.title);
  });

  it("collapses same-day Amharic and English variants for other sources too", async () => {
    translateNewsItemToEnglish.mockImplementation(
      async ({ title }: { title: string }) => {
        if (title.includes("ምርጫ")) {
          return {
            title:
              "Election board warns coercion in voter registration could void the poll",
            body:
              "The election board warned that illegal coercion during voter registration could lead to the poll being annulled.",
            captureNote: "Translated into English using gpt-5.4-mini.",
            model: "gpt-5.4-mini",
          };
        }

        return null;
      },
    );

    const englishItem = buildNormalizedItem({
      source: "ENA",
      title:
        "Election board warns coercion in voter registration could void the poll",
      url: "https://example.com/ena-english",
      publishedAt: "2026-04-05T08:00:00.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "The election board warned that illegal coercion during voter registration could lead to the poll being annulled.",
      section: "Election",
      language: "English",
      sourceType: "html",
    });
    const amharicItem = buildNormalizedItem({
      source: "ENA",
      title: "የምርጫ ቦርድ በመራጮች ምዝገባ ላይ የሚደረግ ህገወጥ ግፍ ምርጫውን ሊያሰርዝ ይችላል አለ",
      url: "https://example.com/ena-amharic",
      publishedAt: "2026-04-05T08:30:00.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "ቦርዱ በመራጮች ምዝገባ ላይ የሚደረግ ህገወጥ ግፍ ምርጫውን እስከ ማሰረዝ ድረስ እርምጃ ሊወስድ እንደሚችል አስጠነቀቀ።",
      section: "Election",
      language: "Amharic",
      sourceType: "html",
    });

    const deduped = await collapseSameDayMultilingualDuplicates([
      englishItem,
      amharicItem,
    ]);

    expect(deduped.collapsedCount).toBe(1);
    expect(deduped.items).toHaveLength(1);
    expect(deduped.items[0]?.title).toBe(englishItem.title);
  });

  it("translates surviving Oromo feed items into English for display", async () => {
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
      url: "https://example.com/addis-election-oromo",
      publishedAt: "2026-04-06T14:02:08.000Z",
      attemptedAt: "2026-04-06T18:00:00.000Z",
      snippet:
        "Xiinxalli Addis Standard mootummaa paartii tokkootti deebi'uu danda'u irratti akeekkachiisa.",
      section: "Election",
      language: "English",
      sourceType: "search-fallback",
    });

    const translated = await translateItemsForEnglishDisplay([oromoItem]);

    expect(translated.translatedCount).toBe(1);
    expect(translated.items[0]?.title).toContain("Election2026 - Oromia at a crossroads");
    expect(translated.items[0]?.language).toBe("English");
    expect(translated.items[0]?.originalLanguage).toBe("Afaan Oromoo");
  });
});
