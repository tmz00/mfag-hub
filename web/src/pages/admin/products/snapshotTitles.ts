import type { ProductItem } from "../../../services/productsService";

const MAX_PRODUCT_SNAPSHOT_TITLE_LENGTH = 255;

const normalizeText = (value?: string): string => String(value || "").trim();

const truncateLabel = (label: string, maxLength: number): string => {
  if (label.length <= maxLength) {
    return label;
  }

  if (maxLength <= 3) {
    return label.slice(0, Math.max(maxLength, 0));
  }

  return `${label.slice(0, maxLength - 3).trimEnd()}...`;
};

const formatProductSnapshotTitle = (
  actionLabel: "adding" | "editing" | "deleting",
  item: Pick<ProductItem, "id" | "shortName" | "fullName">,
): string => {
  const id = normalizeText(item.id);
  const label =
    normalizeText(item.shortName) ||
    normalizeText(item.fullName) ||
    id ||
    "Product";
  const prefix = `after ${actionLabel} `;

  if (!id) {
    const availableLabelLength = MAX_PRODUCT_SNAPSHOT_TITLE_LENGTH - prefix.length;
    return `${prefix}${truncateLabel(label, availableLabelLength)}`;
  }

  const suffix = ` (ID#${id})`;
  const availableLabelLength =
    MAX_PRODUCT_SNAPSHOT_TITLE_LENGTH - prefix.length - suffix.length;

  return `${prefix}${truncateLabel(label, availableLabelLength)}${suffix}`;
};

export const formatProductAddSnapshotTitle = (
  _sourceLabel: "Add Base Plan" | "Add Rider / Top-up",
  item: Pick<ProductItem, "id" | "shortName" | "fullName">,
): string => formatProductSnapshotTitle("adding", item);

export const formatProductChangeSnapshotTitle = (
  action: "Edit" | "Delete",
  item: Pick<ProductItem, "id" | "shortName" | "fullName">,
): string =>
  formatProductSnapshotTitle(action === "Edit" ? "editing" : "deleting", item);
