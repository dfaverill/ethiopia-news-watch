import { describe, expect, it } from "vitest";

import { explainRelevanceDecision, findMatchedKeywords } from "@/lib/news/relevance";
import type { NormalizedNewsItem } from "@/lib/news/types";

describe("relevance", () => {
  it("scores Ethiopia election coverage as relevant", () => {
    const decision = explainRelevanceDecision(
      "NEBE",
      "NEBE launches election debate in Addis Ababa",
      "The National Election Board opened a campaign debate ahead of the 7th general election.",
    );

    expect(decision.passes).toBe(true);
    expect(decision.topicTags).toContain("Election");
    expect(decision.matchedKeywords).toEqual(
      expect.arrayContaining(["nebe", "election", "addis ababa"]),
    );
  });

  it("does not match keyword fragments inside unrelated words", () => {
    const matches = findMatchedKeywords(
      "officials said the cabinet secretary briefed parliament",
    );

    expect(matches).not.toContain("aid");
  });

  it("rejects non-Ethiopia election coverage", () => {
    const decision = explainRelevanceDecision(
      "Associated Press" as NormalizedNewsItem["source"],
      "Slovenia's PM launches coalition talks after cliffhanger election",
      "The parliamentary bloc is negotiating a coalition after the vote.",
    );

    expect(decision.passes).toBe(false);
    expect(decision.hasAnchor).toBe(false);
  });

  it("recognizes Amharic Ethiopia coverage keywords", () => {
    const decision = explainRelevanceDecision(
      "VOA Amharic",
      "የኢትዮጵያ ፌደራል መንግሥት በትግራይ ውጥረት ላይ መግለጫ ሰጠ",
      "በአዲስ አበባ የተሰጠው መግለጫ ስለ ኢትዮጵያ እና ኤርትራ ጉዳዮች ተናግሯል።",
    );

    expect(decision.passes).toBe(true);
    expect(decision.hasAnchor).toBe(true);
    expect(decision.matchedKeywords).toEqual(
      expect.arrayContaining(["ኢትዮጵያ", "ትግራይ", "አዲስ አበባ", "ኤርትራ"]),
    );
  });
});
