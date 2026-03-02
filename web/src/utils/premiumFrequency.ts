const ANNUALIZATION_MULTIPLIERS: Readonly<Record<string, number>> = {
  Annual: 1,
  "Semi-Annual": 2,
  Quarterly: 4,
  "Mthly-1": 12,
  "Mthly-2": 12,
  Single: 1,
};

type PremiumRowLike = {
  premium?: number | null;
  frequency?: string | null;
};

type ProductLike = {
  quantitiesAndPremiums?: PremiumRowLike[] | null;
  riders?: ProductLike[] | null;
};

export function normalizePremiumFrequency(
  frequency?: string | null,
): string | undefined {
  const value = typeof frequency === "string" ? frequency.trim() : "";
  return value && value in ANNUALIZATION_MULTIPLIERS ? value : undefined;
}

export function annualizePremiumAmount(
  premium: number,
  frequency?: string | null,
): number | null {
  const normalizedFrequency = normalizePremiumFrequency(frequency);
  if (!normalizedFrequency) {
    return null;
  }
  return premium * ANNUALIZATION_MULTIPLIERS[normalizedFrequency];
}

export function countInvalidPremiumFrequencyRows(
  items: ProductLike[] | null | undefined,
): number {
  let total = 0;
  for (const item of items || []) {
    for (const row of item.quantitiesAndPremiums || []) {
      const premium = Number(row?.premium) || 0;
      if (premium <= 0) {
        continue;
      }
      if (!normalizePremiumFrequency(row?.frequency)) {
        total += 1;
      }
    }
    total += countInvalidPremiumFrequencyRows(item.riders);
  }
  return total;
}
