export type ClosingDisplayProductLineInput = {
  quantity: number;
  shortName: string;
  fyc: number;
};

export type ClosingDisplayModel = {
  headerLine: string;
  productLines: string[];
  afypLine: string;
  sourceLine?: string;
  referralsLine?: string;
  timeLabel?: string;
};

type BuildClosingDisplayModelInput = {
  primaryName: string;
  isShared?: boolean;
  sharedFscCode?: string;
  sharedFscName?: string;
  totalFyc: number;
  totalAfyp: number;
  products: ClosingDisplayProductLineInput[];
  sourceLineText?: string;
  referrals?: number | null;
  timeLabel?: string;
  includeSource?: boolean;
  includeReferrals?: boolean;
};

export const isSharedClosing = (
  sharedFscCode?: string,
  sharedFscName?: string,
  isShared?: boolean,
): boolean =>
  typeof isShared === "boolean"
    ? isShared
    : Boolean(sharedFscCode || sharedFscName);

export const getSharedHeaderName = (
  primaryName: string,
  sharedFscName?: string,
): string => {
  if (sharedFscName === "Other - Not in list") return `${primaryName} (shared)`;
  if (sharedFscName) return `${primaryName} / ${sharedFscName}`;
  return `${primaryName} (shared)`;
};

export const formatSourceLine = (
  sourceId: string,
  sourceLabel?: string,
  sourceItemId?: string,
  sourceItemLabel?: string,
  sourceComment?: string,
): string => {
  const label = sourceLabel || sourceId;
  const detail = sourceItemLabel || sourceItemId || "";
  const detailPart = detail ? ` - ${detail}` : "";
  const commentPart = sourceComment ? ` (${sourceComment})` : "";
  return `${label}${detailPart}${commentPart}`;
};

export const buildClosingDisplayModel = (
  input: BuildClosingDisplayModelInput,
): ClosingDisplayModel => {
  const primaryName = input.primaryName || "Unknown";
  const isShared = isSharedClosing(
    input.sharedFscCode,
    input.sharedFscName,
    input.isShared,
  );
  const displayName = isShared
    ? getSharedHeaderName(primaryName, input.sharedFscName)
    : primaryName;
  const displayedFyc = isShared ? input.totalFyc / 2 : input.totalFyc;
  const displayedAfyp = isShared ? input.totalAfyp / 2 : input.totalAfyp;
  const includeSource = input.includeSource ?? true;
  const includeReferrals = input.includeReferrals ?? true;

  return {
    headerLine: `${displayName} - $${displayedFyc.toFixed(2)}${
      isShared ? " each" : ""
    }`,
    productLines: input.products.map(
      (product) =>
        `${product.quantity} x ${product.shortName} - $${product.fyc.toFixed(2)}`,
    ),
    afypLine: `AFYP: $${displayedAfyp.toFixed(2)}${isShared ? " each" : ""}`,
    sourceLine:
      includeSource && input.sourceLineText
        ? `Source: ${input.sourceLineText}`
        : undefined,
    referralsLine:
      includeReferrals && typeof input.referrals === "number"
        ? `Referrals: ${input.referrals}`
        : undefined,
    timeLabel: input.timeLabel,
  };
};

export const formatClosingDisplayForWhatsApp = (
  model: ClosingDisplayModel,
): string =>
  [
    model.headerLine,
    ...model.productLines,
    model.afypLine,
    model.sourceLine,
    model.referralsLine,
  ]
    .filter(Boolean)
    .join("\n");
