import { describe, expect, it } from "vitest";
import type { ClosingProduct } from "../services/closingsService";
import {
  annualizePremium,
  calculateClosingAfyp,
  countInvalidPremiumFrequencyRows,
} from "./closingMetrics";

const buildProduct = (
  overrides: Partial<ClosingProduct> = {},
): ClosingProduct => ({
  productId: "PLAN-1",
  fullName: "Starter Plan",
  shortName: "Starter",
  fycRate: 10,
  gst: 0,
  quantitiesAndPremiums: [],
  riders: [],
  ...overrides,
});

describe("closingMetrics", () => {
  it("returns null for missing or invalid frequencies", () => {
    expect(annualizePremium(100, undefined)).toBeNull();
    expect(annualizePremium(100, "Not-A-Real-Frequency")).toBeNull();
  });

  it("excludes invalid frequency rows from AFYP and counts them for warnings", () => {
    const items: ClosingProduct[] = [
      buildProduct({
        quantitiesAndPremiums: [
          {
            quantity: 1,
            premium: 100,
            frequency: "Annual",
          },
          {
            quantity: 1,
            premium: 50,
            frequency: undefined,
          },
        ],
        riders: [
          buildProduct({
            isRider: true,
            productId: "RIDER-1",
            fullName: "Booster Rider",
            shortName: "Booster",
            quantitiesAndPremiums: [
              {
                quantity: 1,
                premium: 30,
                frequency: "Unexpected" as any,
              },
            ],
          }),
        ],
      }),
    ];

    expect(calculateClosingAfyp(items)).toBe(100);
    expect(countInvalidPremiumFrequencyRows(items)).toBe(2);
  });
});
