import { describe, expect, it } from "vitest";
import type { ClosingProduct } from "../services/closingsService";
import {
  annualizePremium,
  calculateClosingFyc,
  calculateProductFyc,
  calculateProductSelfFyc,
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

  it("handles monthly-2 FYC using collected premium and includes riders", () => {
    const items: ClosingProduct[] = [
      buildProduct({
        fycRate: 0.5,
        quantitiesAndPremiums: [
          {
            quantity: 1,
            premium: 100,
            frequency: "Mthly-2",
          },
        ],
        riders: [
          buildProduct({
            isRider: true,
            productId: "RIDER-1",
            fullName: "Booster Rider",
            shortName: "Booster",
            fycRate: 1,
            quantitiesAndPremiums: [
              {
                quantity: 2,
                premium: 50,
                frequency: "Annual",
              },
            ],
          }),
        ],
      }),
    ];

    expect(calculateProductSelfFyc(items[0])).toBe(1);
    expect(calculateClosingFyc(items)).toBe(2);
  });

  it("applies FYC rounding per premium row before quantity multiplication", () => {
    const items: ClosingProduct[] = [
      buildProduct({
        fycRate: 0.1,
        quantitiesAndPremiums: [
          {
            quantity: 3,
            premium: 100.01,
            frequency: "Annual",
          },
        ],
      }),
    ];

    expect(calculateClosingFyc(items)).toBeCloseTo(0.33, 6);
  });

  it("covers FYC scenarios for Mthly-1 vs Mthly-2, GST, and riders", () => {
    const cases: Array<{
      label: string;
      item: ClosingProduct;
      expected: number;
    }> = [
      {
        label: "Mthly-1 without GST",
        item: buildProduct({
          fycRate: 10,
          quantitiesAndPremiums: [
            { quantity: 1, premium: 100, frequency: "Mthly-1" },
          ],
        }),
        expected: 10,
      },
      {
        label: "Mthly-2 without GST",
        item: buildProduct({
          fycRate: 10,
          quantitiesAndPremiums: [
            { quantity: 1, premium: 100, frequency: "Mthly-2" },
          ],
        }),
        expected: 20,
      },
      {
        label: "Annual with GST",
        item: buildProduct({
          fycRate: 10,
          gst: 9,
          quantitiesAndPremiums: [
            { quantity: 1, premium: 109, frequency: "Annual" },
          ],
        }),
        expected: 10,
      },
      {
        label: "Base + rider with mixed GST",
        item: buildProduct({
          fycRate: 10,
          gst: 9,
          quantitiesAndPremiums: [
            { quantity: 1, premium: 109, frequency: "Annual" },
          ],
          riders: [
            buildProduct({
              isRider: true,
              productId: "RIDER-MIX",
              fullName: "Rider Mix",
              shortName: "Rider Mix",
              fycRate: 10,
              gst: 9,
              quantitiesAndPremiums: [
                { quantity: 1, premium: 54.5, frequency: "Annual" },
              ],
            }),
          ],
        }),
        expected: 15,
      },
    ];

    for (const testCase of cases) {
      expect(
        calculateClosingFyc([testCase.item]),
        `${testCase.label} should match expected FYC`,
      ).toBeCloseTo(testCase.expected, 6);
    }
  });

  it("covers AFYP scenarios for Mthly-1 vs Mthly-2, GST, and riders", () => {
    const cases: Array<{
      label: string;
      item: ClosingProduct;
      expected: number;
    }> = [
      {
        label: "Mthly-1 without GST",
        item: buildProduct({
          quantitiesAndPremiums: [
            { quantity: 1, premium: 100, frequency: "Mthly-1" },
          ],
        }),
        expected: 1200,
      },
      {
        label: "Mthly-2 without GST",
        item: buildProduct({
          quantitiesAndPremiums: [
            { quantity: 1, premium: 100, frequency: "Mthly-2" },
          ],
        }),
        expected: 1200,
      },
      {
        label: "Annual with GST",
        item: buildProduct({
          gst: 9,
          quantitiesAndPremiums: [
            { quantity: 1, premium: 109, frequency: "Annual" },
          ],
        }),
        expected: 100,
      },
      {
        label: "Regular base + rider",
        item: buildProduct({
          type: "regular",
          quantitiesAndPremiums: [
            { quantity: 1, premium: 100, frequency: "Annual" },
          ],
          riders: [
            buildProduct({
              isRider: true,
              productId: "RIDER-REG",
              fullName: "Rider Regular",
              shortName: "Rider Regular",
              quantitiesAndPremiums: [
                { quantity: 2, premium: 50, frequency: "Annual" },
              ],
            }),
          ],
        }),
        expected: 200,
      },
      {
        label: "Single base + rider inherits single multiplier",
        item: buildProduct({
          type: "single",
          quantitiesAndPremiums: [
            { quantity: 1, premium: 100, frequency: "Annual" },
          ],
          riders: [
            buildProduct({
              isRider: true,
              productId: "RIDER-SINGLE",
              fullName: "Rider Single",
              shortName: "Rider Single",
              quantitiesAndPremiums: [
                { quantity: 2, premium: 50, frequency: "Annual" },
              ],
            }),
          ],
        }),
        expected: 20,
      },
    ];

    for (const testCase of cases) {
      expect(
        calculateClosingAfyp([testCase.item]),
        `${testCase.label} should match expected AFYP`,
      ).toBeCloseTo(testCase.expected, 6);
    }
  });

  it("excludes products marked not counting toward production from FYC and AFYP", () => {
    const item = buildProduct({
      countsTowardProduction: "N",
      fycRate: 10,
      quantitiesAndPremiums: [{ quantity: 1, premium: 100, frequency: "Annual" }],
      riders: [
        buildProduct({
          isRider: true,
          productId: "RIDER-N",
          fullName: "Excluded Rider",
          shortName: "Excluded Rider",
          fycRate: 10,
          quantitiesAndPremiums: [
            { quantity: 2, premium: 50, frequency: "Annual" },
          ],
        }),
      ],
    });

    expect(calculateProductFyc(item)).toBe(0);
    expect(calculateClosingFyc([item])).toBe(0);
    expect(calculateClosingAfyp([item])).toBe(0);
  });
});
