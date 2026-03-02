import type { PremiumFrequency } from "../../../../services/closingsService";
import { premiumFrequencyLabels } from "../../../../services/closingsService";
import type { DraftProduct, DraftPremiumRow } from "./SubmitClosing";

export const frequencyOptions: Array<PremiumFrequency> = [
  "Annual",
  "Semi-Annual",
  "Quarterly",
  "Mthly-1",
  "Mthly-2",
  "Single",
];

export const getAllowedFrequencies = (
  product?: DraftProduct | null,
): PremiumFrequency[] => {
  if (!product?.frequencies || product.frequencies.length === 0) {
    if (product?.type?.toLowerCase() === "single") {
      return ["Single"];
    }
    return ["Annual", "Semi-Annual", "Quarterly", "Mthly-1", "Mthly-2"];
  }
  return product.frequencies as PremiumFrequency[];
};

export const getFrequencyOptions = (
  product?: DraftProduct | null,
): Array<PremiumFrequency | ""> => {
  const allowed = new Set(getAllowedFrequencies(product));
  return frequencyOptions.filter((value) => allowed.has(value));
};

export const isFrequencyLocked = (product?: DraftProduct | null) =>
  getAllowedFrequencies(product).length === 1;

export const parseAttachableRiders = (value?: string[]): string[] =>
  value || [];

export const normalizeOptions = (
  options: unknown,
): Array<{ label: string; fycRate: string }> =>
  Array.isArray(options) ? options : [];

export const parseOptionRate = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

export const getOptionEntries = (
  product?: {
    options?: Array<{ label: string; fycRate: string }>;
  } | null,
) => {
  const safeOptions = normalizeOptions(product?.options);
  if (safeOptions.length === 0) return [];
  return [...safeOptions]
    .map((option) => ({ value: option.label, rate: option.fycRate }))
    .sort(
      (left, right) =>
        parseOptionRate(right.rate) - parseOptionRate(left.rate) ||
        left.value.localeCompare(right.value),
    );
};

export const cloneDraftProduct = (product: DraftProduct): DraftProduct => ({
  ...product,
  premiumRows: product.premiumRows.map((row) => ({ ...row })),
  riders: product.riders.map((rider) => ({
    ...rider,
    premiumRows: rider.premiumRows.map((row) => ({ ...row })),
  })),
});

export const isProductComplete = (product: DraftProduct) => {
  if (product.premiumRows.length === 0) return false;
  const rowsValid = product.premiumRows.every(
    (row) => row.premium > 0 && Boolean(row.frequency),
  );
  if (!rowsValid) return false;
  return product.riders.every((rider) => {
    if (rider.premiumRows.length === 0) return false;
    return rider.premiumRows.every(
      (row) => row.premium > 0 && Boolean(row.frequency),
    );
  });
};

export const arePremiumRowsEqual = (
  left: DraftPremiumRow[],
  right: DraftPremiumRow[],
): boolean => {
  if (left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index];
    return (
      row.id === other.id &&
      row.premium === other.premium &&
      row.frequency === other.frequency &&
      row.quantity === other.quantity
    );
  });
};

export const areProductsEqual = (
  left: DraftProduct,
  right: DraftProduct,
): boolean => {
  if (left.id !== right.id) return false;
  if (Boolean(left.isRider) !== Boolean(right.isRider)) return false;
  if (left.productId !== right.productId) return false;
  if (left.fullName !== right.fullName) return false;
  if (left.shortName !== right.shortName) return false;
  if (left.category !== right.category) return false;
  if (left.type !== right.type) return false;
  if (left.premiumTermOrIssueAge !== right.premiumTermOrIssueAge) return false;
  if (left.optionTitle !== right.optionTitle) {
    return false;
  }
  if (left.fycRate !== right.fycRate) return false;
  if (left.gst !== right.gst) return false;
  if (left.attachableRiders !== right.attachableRiders) return false;
  if (!arePremiumRowsEqual(left.premiumRows, right.premiumRows)) return false;
  if (left.riders.length !== right.riders.length) return false;
  return left.riders.every((rider, index) =>
    areProductsEqual(rider, right.riders[index]),
  );
};

let productIdCounter = 0;
export const generateId = () => `product-${Date.now()}-${++productIdCounter}`;
let premiumRowIdCounter = 0;
export const generateRowId = () =>
  `row-${Date.now()}-${++premiumRowIdCounter}`;

export const isAddonProduct = (product: DraftProduct) => {
  return Boolean(product.isRider);
};

export const isCustomProduct = (product: DraftProduct) =>
  (product.productId || "").startsWith("custom-");

export const formatCurrency = (value: number) => {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const formatFrequencySummary = (value?: PremiumFrequency | "") => {
  if (!value) return "Frequency";
  return value;
};

export const formatFrequencyLabel = (value?: PremiumFrequency | "") => {
  if (!value) return "Frequency";
  return premiumFrequencyLabels[value] || value;
};

export type ConsolidatedRow = {
  premium: number;
  frequency: PremiumFrequency | "";
  quantity: number;
};

export const consolidatePremiumRows = (
  rows: DraftPremiumRow[],
): ConsolidatedRow[] => {
  const map = new Map<string, ConsolidatedRow>();
  for (const row of rows) {
    const key = `${row.premium}-${row.frequency}`;
    const existing = map.get(key);
    if (existing) {
      existing.quantity += row.quantity || 1;
    } else {
      map.set(key, {
        premium: row.premium,
        frequency: row.frequency,
        quantity: row.quantity || 1,
      });
    }
  }
  return Array.from(map.values());
};
