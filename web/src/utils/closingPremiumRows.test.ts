import { describe, expect, it } from "vitest";
import { consolidatePremiumRowsByAmountAndFrequency } from "./closingPremiumRows";

describe("consolidatePremiumRowsByAmountAndFrequency", () => {
  it("merges rows with the same premium and frequency while preserving first-seen order", () => {
    expect(
      consolidatePremiumRowsByAmountAndFrequency([
        { quantity: 1, premium: 100, frequency: "Annual" },
        { quantity: 2, premium: 50, frequency: "Quarterly" },
        { quantity: 2, premium: 100, frequency: "Annual" },
        { quantity: 1, premium: 50, frequency: "Quarterly" },
      ]),
    ).toEqual([
      { quantity: 3, premium: 100, frequency: "Annual" },
      { quantity: 3, premium: 50, frequency: "Quarterly" },
    ]);
  });
});
