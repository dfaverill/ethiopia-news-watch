import { describe, expect, it } from "vitest";

import { explainRelevanceDecision, findMatchedKeywords } from "@/lib/news/relevance";

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

  it("rejects non-Ethiopia Reuters election coverage", () => {
    const decision = explainRelevanceDecision(
      "Reuters",
      "Slovenia's PM launches coalition talks after cliffhanger election",
      "The parliamentary bloc is negotiating a coalition after the vote.",
    );

    expect(decision.passes).toBe(false);
    expect(decision.hasAnchor).toBe(false);
  });
});
