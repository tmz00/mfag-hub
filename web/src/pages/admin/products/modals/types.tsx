import type { JSX } from "solid-js";
import type { BasePlan, Rider, ProductCatalog, ProductBackup } from "../../../../services/productsService";

export type TabKey = "basePlans" | "riders";

export type ProductItem = BasePlan | Rider;

export type ProductGroup = {
  category: string;
  items: ProductItem[];
};

export type OptionRow = {
  id: string;
  label: string;
  fycRate: string;
};

export type TypeRow = {
  key: string;
  label: string;
};

export const defaultFrequencies = [
  "Annual",
  "Semi-Annual",
  "Quarterly",
  "Mthly-1",
  "Mthly-2",
  "Single",
];

export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const highlightText = (text: string, query: string): JSX.Element => {
  const trimmed = query.trim();
  if (!trimmed) return text as unknown as JSX.Element;
  const parts = text.split(new RegExp(`(${escapeRegExp(trimmed)})`, "gi"));
  return parts.map((part) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark class="rounded-sm bg-amber-200 px-0.5 text-gray-900">{part}</mark>
    ) : (
      <span>{part}</span>
    ),
  ) as unknown as JSX.Element;
};

export const groupByCategory = (items: ProductItem[]): ProductGroup[] => {
  const groups: ProductGroup[] = [];
  const lookup = new Map<string, ProductGroup>();

  items.forEach((item) => {
    const category = item.category || "Other";
    const group = lookup.get(category);
    if (group) {
      group.items.push(item);
    } else {
      const nextGroup = { category, items: [item] };
      lookup.set(category, nextGroup);
      groups.push(nextGroup);
    }
  });

  return groups;
};

export const getOptionEntries = (item: ProductItem): Array<[string, string]> => {
  return (item.options || []).map((option) => [option.label, option.fycRate]);
};

export const createOptionRow = (label = "", fycRate = ""): OptionRow => ({
  id:
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  label,
  fycRate,
});

export const toTypeRows = (types?: Record<string, string>): TypeRow[] => {
  if (!types) return [];
  return Object.entries(types).map(([key, label]) => ({ key, label }));
};

export const normalizeTypeRows = (rows: TypeRow[]): Record<string, string> => {
  const output: Record<string, string> = {};
  rows.forEach((row) => {
    const key = row.key.trim();
    const label = row.label.trim();
    if (key && label) {
      output[key] = label;
    }
  });
  return output;
};

export const formatBackupDate = (value?: Date) => {
  if (!value) return "Unknown date";
  return value.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatTimestamp = (value: Date = new Date()) => {
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}`;
};

export const formatBackupOwner = (backup: ProductBackup) => {
  return backup.data?.updatedBy || "Unknown";
};
