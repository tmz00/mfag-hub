import type {
  ClosingProduct,
  ClosingProductQuantityAndPremium,
} from "../services/closingsService";

export function annualizePremium(
  premium: number,
  frequency?: string,
): number {
  switch (frequency) {
    case "Annual":
    case "Single":
      return premium;
    case "Semi-Annual":
      return premium * 2;
    case "Quarterly":
      return premium * 4;
    case "Mthly-1":
    case "Mthly-2":
      return premium * 12;
    default:
      return 0;
  }
}

// ─── FYC ────────────────────────────────────────────────────────────────────

export function calculateProductFyc(product: ClosingProduct): number {
  if (product.countsTowardProduction === "N") {
    return 0;
  }
  const qps: ClosingProductQuantityAndPremium[] =
    product.quantitiesAndPremiums || [];
  let totalPremium = 0;
  for (const qp of qps) {
    totalPremium += qp.quantity * qp.premium;
  }

  let fyc = totalPremium * product.fycRate;
  if (product.gst > 0) {
    fyc /= 1 + product.gst / 100;
  }
  fyc = Math.ceil(fyc) / 100.0;

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
  const gst = product.gst || 0;
  let total = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    let annualized = annualizePremium(qp.premium, qp.frequency);
    if (gst > 0) annualized /= 1 + gst / 100;
    total += annualized * qp.quantity;
  }
  for (const rider of product.riders || []) {
    const riderGst = rider.gst || 0;
    for (const qp of rider.quantitiesAndPremiums || []) {
      let annualized = annualizePremium(qp.premium, qp.frequency);
      if (riderGst > 0) annualized /= 1 + riderGst / 100;
      total += annualized * qp.quantity;
    }
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
  const gst = product.gst || 0;
  let total = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    let annualized = annualizePremium(qp.premium, qp.frequency);
    if (gst > 0) annualized /= 1 + gst / 100;
    total += annualized * qp.quantity * fypMultiplier;
  }
  for (const rider of product.riders || []) {
    const riderGst = rider.gst || 0;
    for (const qp of rider.quantitiesAndPremiums || []) {
      let annualized = annualizePremium(qp.premium, qp.frequency);
      if (riderGst > 0) annualized /= 1 + riderGst / 100;
      total += annualized * qp.quantity * fypMultiplier;
    }
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
  const gst = product.gst || 0;
  const rate = product.fycRate || 0;
  let total = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    let annualized = annualizePremium(qp.premium, qp.frequency);
    if (gst > 0) annualized /= 1 + gst / 100;
    total += annualized * qp.quantity * fypMultiplier * rate;
  }
  for (const rider of product.riders || []) {
    const riderGst = rider.gst || 0;
    const riderRate = rider.fycRate || rate;
    for (const qp of rider.quantitiesAndPremiums || []) {
      let annualized = annualizePremium(qp.premium, qp.frequency);
      if (riderGst > 0) annualized /= 1 + riderGst / 100;
      total += annualized * qp.quantity * fypMultiplier * riderRate;
    }
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
