export type PremiumRowLike = {
  premium?: number | null;
  quantity?: number | null;
  frequency?: string | null;
};

export type ConsolidatedPremiumRow = {
  premium: number;
  quantity: number;
  frequency: string;
};

export const consolidatePremiumRowsByAmountAndFrequency = (
  rows: readonly PremiumRowLike[],
): ConsolidatedPremiumRow[] => {
  const consolidated: ConsolidatedPremiumRow[] = [];
  const rowsByKey = new Map<string, ConsolidatedPremiumRow>();

  for (const row of rows) {
    const premium = Number(row?.premium) || 0;
    const quantity = Math.max(1, Number(row?.quantity) || 1);
    const frequency = String(row?.frequency ?? "").trim();
    const key = `${premium}::${frequency}`;

    const existing = rowsByKey.get(key);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }

    const nextRow: ConsolidatedPremiumRow = {
      premium,
      quantity,
      frequency,
    };
    rowsByKey.set(key, nextRow);
    consolidated.push(nextRow);
  }

  return consolidated;
};
