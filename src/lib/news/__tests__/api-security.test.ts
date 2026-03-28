import { afterEach, describe, expect, it } from "vitest";

import {
  isForceRefreshCoolingDown,
  markForceRefresh,
  resetApiSecurityStateForTests,
  takeRateLimitSlot,
} from "@/lib/news/api-security";

describe("api security helpers", () => {
  afterEach(() => {
    resetApiSecurityStateForTests();
  });

  it("rate limits repeated requests within the same window", () => {
    const first = takeRateLimitSlot("coverage:test", 2, 60_000, 1_000);
    const second = takeRateLimitSlot("coverage:test", 2, 60_000, 2_000);
    const third = takeRateLimitSlot("coverage:test", 2, 60_000, 3_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("enforces a short force-refresh cooldown", () => {
    markForceRefresh(10_000);

    expect(isForceRefreshCoolingDown(45_000, 20_000)).toBe(true);
    expect(isForceRefreshCoolingDown(45_000, 60_000)).toBe(false);
  });
});
