import type { ClosingProduct } from "../services/closingsService";
import {
  annualizePremiumAmount,
  countInvalidPremiumFrequencyRows,
} from "./premiumFrequency";

export function annualizePremium(
  premium: number,
  frequency?: string,
): number | null {
  return annualizePremiumAmount(premium, frequency);
}

export { countInvalidPremiumFrequencyRows };

// ─── FYC ────────────────────────────────────────────────────────────────────

function calculatePremiumRowFyc(
  premium: number,
  frequency: string | undefined,
  fycRate: number,
  gst: number,
): number {
  const collectedPremium = frequency === "Mthly-2" ? premium * 2 : premium;
  let fyc = collectedPremium * fycRate;
  if (gst > 0) {
    fyc /= 1 + gst / 100;
  }
  return Math.ceil(fyc) / 100.0;
}

export function calculateProductSelfFyc(product: ClosingProduct): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }
  const gst = product.gst || 0;
  const fycRate = product.fycRate || 0;
  let total = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    const quantity = qp.quantity || 0;
    total +=
      calculatePremiumRowFyc(qp.premium, qp.frequency, fycRate, gst) * quantity;
  }
  return total;
}

export function calculateProductFyc(product: ClosingProduct): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }
  let fyc = calculateProductSelfFyc(product);
  for (const rider of product.riders || []) {
    fyc += calculateProductFyc(rider);
  }
  return fyc;
}

export function calculateClosingFyc(items: ClosingProduct[]): number {
  let total = 0;
  for (const item of items || []) {
    total += calculateProductFyc(item);
  }
  return total;
}

// ─── FYP ────────────────────────────────────────────────────────────────────

export function calculateProductFyp(product: ClosingProduct): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }

  let total = calculateProductSelfFyp(product);
  for (const rider of product.riders || []) {
    total += calculateProductFyp(rider);
  }
  return total;
}

export function calculateProductSelfFyp(product: ClosingProduct): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }

  const gst = product.gst || 0;
  let total = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    let annualized = annualizePremium(qp.premium, qp.frequency);
    if (annualized === null) continue;
    if (gst > 0) annualized /= 1 + gst / 100;
    total += annualized * qp.quantity;
  }
  return total;
}

export function calculateClosingFyp(items: ClosingProduct[]): number {
  let total = 0;
  for (const item of items || []) {
    total += calculateProductFyp(item);
  }
  return total;
}

// ─── AFYP ───────────────────────────────────────────────────────────────────

export function calculateProductAfyp(product: ClosingProduct): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }

  const isSingle = product.type?.toLowerCase() === "single";
  const fypMultiplier = isSingle ? 0.1 : 1;
  let total = calculateProductSelfAfyp(product, fypMultiplier);
  for (const rider of product.riders || []) {
    total += calculateProductAfypWithMultiplier(rider, fypMultiplier);
  }
  return total;
}

function calculateProductAfypWithMultiplier(
  product: ClosingProduct,
  fypMultiplier: number,
): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }

  let total = calculateProductSelfAfyp(product, fypMultiplier);
  for (const rider of product.riders || []) {
    total += calculateProductAfypWithMultiplier(rider, fypMultiplier);
  }
  return total;
}

export function calculateProductSelfAfyp(
  product: ClosingProduct,
  fypMultiplierOverride?: number,
): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }

  const isSingle = product.type?.toLowerCase() === "single";
  const fypMultiplier = fypMultiplierOverride ?? (isSingle ? 0.1 : 1);
  const gst = product.gst || 0;
  let total = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    let annualized = annualizePremium(qp.premium, qp.frequency);
    if (annualized === null) continue;
    if (gst > 0) annualized /= 1 + gst / 100;
    total += annualized * qp.quantity * fypMultiplier;
  }
  return total;
}

export function calculateClosingAfyp(items: ClosingProduct[]): number {
  let total = 0;
  for (const item of items || []) {
    total += calculateProductAfyp(item);
  }
  return total;
}

// ─── AFYC ───────────────────────────────────────────────────────────────────

export function calculateProductAfyc(product: ClosingProduct): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }

  const isSingle = product.type?.toLowerCase() === "single";
  const fypMultiplier = isSingle ? 0.1 : 1;
  let total = calculateProductSelfAfyc(product, fypMultiplier);
  const fycRate = product.fycRate || 0;
  for (const rider of product.riders || []) {
    total += calculateProductAfycWithMultiplier(rider, fypMultiplier, fycRate);
  }
  return total;
}

function calculateProductAfycWithMultiplier(
  product: ClosingProduct,
  fypMultiplier: number,
  inheritedFycRate?: number,
): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }

  const fycRate = product.fycRate || inheritedFycRate || 0;
  let total = calculateProductSelfAfyc(product, fypMultiplier, fycRate);
  for (const rider of product.riders || []) {
    total += calculateProductAfycWithMultiplier(rider, fypMultiplier, fycRate);
  }
  return total;
}

export function calculateProductSelfAfyc(
  product: ClosingProduct,
  fypMultiplierOverride?: number,
  fycRateOverride?: number,
): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }

  const isSingle = product.type?.toLowerCase() === "single";
  const fypMultiplier = fypMultiplierOverride ?? (isSingle ? 0.1 : 1);
  const gst = product.gst || 0;
  const rate = fycRateOverride ?? (product.fycRate || 0);
  let total = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    let annualized = annualizePremium(qp.premium, qp.frequency);
    if (annualized === null) continue;
    if (gst > 0) annualized /= 1 + gst / 100;
    total += annualized * qp.quantity * fypMultiplier * rate;
  }
  return total;
}

export function calculateClosingAfyc(items: ClosingProduct[]): number {
  let total = 0;
  for (const item of items || []) {
    total += calculateProductAfyc(item);
  }
  return total;
}
