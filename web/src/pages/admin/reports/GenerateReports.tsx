import {
  Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  createEffect,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { TbOutlineDownload } from "solid-icons/tb";
import {
  closingsService,
  type Closing,
  type ClosingProduct,
} from "../../../services/closingsService";
import {
  calculateProductSelfFyc,
  calculateProductSelfFyp,
  calculateProductSelfAfyp,
  calculateProductSelfAfyc,
  calculateClosingFyc,
  calculateClosingAfyp,
} from "../../../utils/closingMetrics";
import {
  teamService,
  type TeamUser,
  type TeamAgency,
  isStaffUser,
} from "../../../services/teamService";
import {
  reportsService,
  type ReportRenderRow,
  type ReportRenderTable,
  type ReportTemplate,
  type ReportTableLayout,
} from "../../../services/reportsService";
import { sourcesService } from "../../../services/sourcesService";
import {
  Button,
  DateField,
  PageShell,
  PageHeader,
  PageBody,
  LoadingState,
  IconButton,
  Spinner,
} from "../../../components/ui";
import { adminOptionForPath } from "../adminOptions";

type DateRangeSelection = {
  startDate: string;
  endDate: string;
  start: Date;
  lastDay: Date;
};

type BreakdownRow = {
  key: string;
  label: string;
  count: number;
  fyc: number;
  afyp: number;
  share: number;
  color: string;
  units?: number;
};

type SourceBreakdownRow = BreakdownRow & {
  items: BreakdownRow[];
};

type BreakdownMetricKey = "cases" | "fyc" | "afyp";

const BREAKDOWN_METRICS: Array<{
  key: BreakdownMetricKey;
  label: string;
}> = [
  { key: "cases", label: "Cases" },
  { key: "fyc", label: "FYC" },
  { key: "afyp", label: "AFYP" },
];

function isIPadDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && (navigator as Navigator).maxTouchPoints > 1)
  );
}

function openPdfPreviewPage(
  previewWindow: Window,
  previewUrl: string,
  filename: string,
) {
  const doc = previewWindow.document;
  doc.title = filename;

  const body = doc.body;
  if (!body) {
    previewWindow.location.href = previewUrl;
    return;
  }

  body.innerHTML = "";
  body.style.margin = "0";
  body.style.background = "#f3f4f6";
  body.style.fontFamily =
    '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

  const wrapper = doc.createElement("div");
  wrapper.style.minHeight = "100vh";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";

  const header = doc.createElement("div");
  header.style.padding = "16px";
  header.style.background = "#ffffff";
  header.style.borderBottom = "1px solid #e5e7eb";

  const title = doc.createElement("div");
  title.textContent = filename;
  title.style.fontSize = "14px";
  title.style.fontWeight = "600";
  title.style.color = "#111827";

  const hint = doc.createElement("div");
  hint.textContent = "Use the download link below to keep the report filename.";
  hint.style.marginTop = "6px";
  hint.style.fontSize = "13px";
  hint.style.color = "#4b5563";

  const downloadLink = doc.createElement("a");
  downloadLink.href = previewUrl;
  downloadLink.download = filename;
  downloadLink.textContent = `Download ${filename}`;
  downloadLink.style.display = "inline-block";
  downloadLink.style.marginTop = "10px";
  downloadLink.style.fontSize = "14px";
  downloadLink.style.fontWeight = "600";
  downloadLink.style.color = "#0f766e";
  downloadLink.style.textDecoration = "none";

  header.append(title, hint, downloadLink);

  const frame = doc.createElement("iframe");
  frame.src = previewUrl;
  frame.title = filename;
  frame.style.flex = "1";
  frame.style.width = "100%";
  frame.style.minHeight = "70vh";
  frame.style.border = "0";
  frame.style.background = "#ffffff";

  wrapper.append(header, frame);
  body.appendChild(wrapper);

  window.setTimeout(() => {
    try {
      downloadLink.click();
    } catch {
      // Leave the manual link visible as a fallback if the browser blocks it.
    }
  }, 150);
}

const BREAKDOWN_COLORS = [
  "#1d4ed8",
  "#0f766e",
  "#c2410c",
  "#7c3aed",
  "#be123c",
  "#15803d",
  "#4338ca",
  "#b45309",
];

const DONUT_CHART_SIZE = 208;
const DONUT_CHART_RADIUS = 70;
const DONUT_CHART_STROKE = 20;
const DONUT_CHART_CENTER_RADIUS =
  DONUT_CHART_RADIUS - DONUT_CHART_STROKE / 2 - 2;
const DONUT_CHART_CENTER_LABEL_WIDTH = DONUT_CHART_CENTER_RADIUS * 2;

function getBreakdownMetricLabel(metric: BreakdownMetricKey): string {
  switch (metric) {
    case "fyc":
      return "FYC";
    case "afyp":
      return "AFYP";
    case "cases":
    default:
      return "Cases";
  }
}

function getBreakdownMetricTitleText(metric: BreakdownMetricKey): string {
  return metric === "cases" ? "cases" : getBreakdownMetricLabel(metric);
}

function formatCaseCountLabel(value: number): string {
  return `${formatCount(value)} ${value === 1 ? "case" : "cases"}`;
}

function getBreakdownMetricValue(
  row: Pick<BreakdownRow, "count" | "fyc" | "afyp" | "units">,
  metric: BreakdownMetricKey,
  options?: { useUnits?: boolean },
): number {
  switch (metric) {
    case "fyc":
      return row.fyc;
    case "afyp":
      return row.afyp;
    case "cases":
    default:
      return options?.useUnits ? row.units || row.count : row.count;
  }
}

function formatBreakdownMetricValue(
  value: number,
  metric: BreakdownMetricKey,
): string {
  if (metric === "cases") {
    return formatCaseCountLabel(value);
  }
  return `${getBreakdownMetricLabel(metric)} ${formatAmount(value)}`;
}

function compareBreakdownRows(
  left: Pick<BreakdownRow, "label" | "count" | "fyc" | "afyp" | "units">,
  right: Pick<BreakdownRow, "label" | "count" | "fyc" | "afyp" | "units">,
  metric: BreakdownMetricKey,
  options?: { useUnits?: boolean },
): number {
  const primaryDiff =
    getBreakdownMetricValue(right, metric, options) -
    getBreakdownMetricValue(left, metric, options);
  if (primaryDiff !== 0) {
    return primaryDiff;
  }

  const caseDiff =
    getBreakdownMetricValue(right, "cases", options) -
    getBreakdownMetricValue(left, "cases", options);
  if (caseDiff !== 0) {
    return caseDiff;
  }

  const fycDiff = right.fyc - left.fyc;
  if (fycDiff !== 0) {
    return fycDiff;
  }

  const afypDiff = right.afyp - left.afyp;
  if (afypDiff !== 0) {
    return afypDiff;
  }

  return left.label.localeCompare(right.label, undefined, {
    sensitivity: "base",
  });
}

function rankSourceBreakdownRows(
  rows: SourceBreakdownRow[],
  metric: BreakdownMetricKey,
): SourceBreakdownRow[] {
  const sortedRows = [...rows].sort((left, right) =>
    compareBreakdownRows(left, right, metric),
  );
  const totalValue = sortedRows.reduce(
    (sum, row) => sum + getBreakdownMetricValue(row, metric),
    0,
  );

  return sortedRows.map((row, index) => {
    const color = getBreakdownColor(index);
    const rowValue = getBreakdownMetricValue(row, metric);
    const items = [...row.items]
      .sort((left, right) => compareBreakdownRows(left, right, metric))
      .map((item) => ({
        ...item,
        share:
          rowValue > 0 ? getBreakdownMetricValue(item, metric) / rowValue : 0,
        color,
      }));

    return {
      ...row,
      share: totalValue > 0 ? rowValue / totalValue : 0,
      color,
      items,
    };
  });
}

function rankProductBreakdownRows(
  rows: BreakdownRow[],
  metric: BreakdownMetricKey,
): BreakdownRow[] {
  const sortedRows = [...rows].sort((left, right) =>
    compareBreakdownRows(left, right, metric, { useUnits: true }),
  );
  const totalValue = sortedRows.reduce(
    (sum, row) =>
      sum + getBreakdownMetricValue(row, metric, { useUnits: true }),
    0,
  );

  return sortedRows.map((row, index) => {
    const rowValue = getBreakdownMetricValue(row, metric, { useUnits: true });
    return {
      ...row,
      share: totalValue > 0 ? rowValue / totalValue : 0,
      color: getBreakdownColor(index),
    };
  });
}

type BreakdownMetricToggleProps = {
  sectionLabel: string;
  value: BreakdownMetricKey;
  onChange: (metric: BreakdownMetricKey) => void;
};

const BreakdownMetricToggle: Component<BreakdownMetricToggleProps> = (
  props,
) => (
  <div class="flex flex-wrap gap-2">
    <For each={BREAKDOWN_METRICS}>
      {(metric) => (
        <button
          type="button"
          class={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
            props.value === metric.key
              ? "border-admin-from/30 bg-admin-from/10 text-admin-from"
              : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"
          }`}
          aria-label={`${props.sectionLabel} by ${metric.label}`}
          aria-pressed={props.value === metric.key}
          onClick={() => props.onChange(metric.key)}
        >
          {metric.label}
        </button>
      )}
    </For>
  </div>
);

type SourceBreakdownDonutProps = {
  rows: SourceBreakdownRow[];
  metric: BreakdownMetricKey;
  expandedKeys: string[];
  onToggle: (key: string) => void;
};

const SourceBreakdownDonut: Component<SourceBreakdownDonutProps> = (props) => {
  const visibleRows = () =>
    props.rows.filter((row) => getBreakdownMetricValue(row, props.metric) > 0);
  const circumference = 2 * Math.PI * DONUT_CHART_RADIUS;
  const totalValue = () =>
    visibleRows().reduce(
      (sum, row) => sum + getBreakdownMetricValue(row, props.metric),
      0,
    );
  const maxMetricValue = () =>
    Math.max(
      1,
      ...visibleRows().map((row) => getBreakdownMetricValue(row, props.metric)),
    );
  const segments = () => {
    let offset = 0;
    const rows = visibleRows();
    const gap = rows.length > 1 ? 5 : 0;

    return rows.map((row) => {
      const segmentLength = row.share * circumference;
      const dashLength = Math.max(segmentLength - gap, 0);
      const segment = {
        color: row.color,
        dashArray: `${dashLength} ${circumference}`,
        dashOffset: -offset,
      };

      offset += segmentLength;
      return segment;
    });
  };

  return (
    <div class="mt-4 grid gap-5 lg:grid-cols-[auto,minmax(0,1fr)] lg:items-center">
      <div class="mx-auto flex h-56 w-56 items-center justify-center rounded-[32px] border border-white bg-white shadow-sm shadow-gray-200/70">
        <div class="relative h-[13rem] w-[13rem]">
          <svg
            viewBox={`0 0 ${DONUT_CHART_SIZE} ${DONUT_CHART_SIZE}`}
            class="h-full w-full -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={DONUT_CHART_SIZE / 2}
              cy={DONUT_CHART_SIZE / 2}
              r={DONUT_CHART_RADIUS}
              fill="none"
              stroke="#e5e7eb"
              stroke-width={DONUT_CHART_STROKE}
            />
            <For each={segments()}>
              {(segment) => (
                <circle
                  cx={DONUT_CHART_SIZE / 2}
                  cy={DONUT_CHART_SIZE / 2}
                  r={DONUT_CHART_RADIUS}
                  fill="none"
                  stroke={segment.color}
                  stroke-width={DONUT_CHART_STROKE}
                  stroke-linecap="round"
                  stroke-dasharray={segment.dashArray}
                  stroke-dashoffset={segment.dashOffset}
                />
              )}
            </For>
            <circle
              cx={DONUT_CHART_SIZE / 2}
              cy={DONUT_CHART_SIZE / 2}
              r={DONUT_CHART_CENTER_RADIUS}
              fill="#ffffff"
              stroke="#f3f4f6"
              stroke-width="2"
            />
          </svg>

          <div class="absolute inset-0 flex items-center justify-center">
            <div
              class="rounded-full bg-white/95 px-3 py-2 text-center shadow-sm ring-1 ring-gray-200/80"
              style={{
                width: `${DONUT_CHART_CENTER_LABEL_WIDTH}px`,
                "max-width": "100%",
              }}
            >
              <div
                class={`break-all font-semibold leading-tight text-gray-900 ${
                  props.metric === "cases" ? "text-3xl" : "text-2xl"
                }`}
              >
                {props.metric === "cases"
                  ? formatCount(totalValue())
                  : formatAmount(totalValue())}
              </div>
              <div class="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                {getBreakdownMetricLabel(props.metric)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
          Top sources by {getBreakdownMetricTitleText(props.metric)}
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <For each={visibleRows()}>
            {(row, index) => {
              const isExpandable = row.items.length > 0;
              const isExpanded = () => props.expandedKeys.includes(row.key);
              const maxItemMetricValue = Math.max(
                1,
                ...row.items.map((item) =>
                  getBreakdownMetricValue(item, props.metric),
                ),
              );

              return (
                <div
                  class={`overflow-hidden rounded-2xl border bg-white shadow-sm shadow-gray-200/60 ${
                    isExpanded() ? "border-admin-from/30" : "border-white"
                  }`}
                >
                  <div class="px-4 py-3">
                    <div class="flex items-center justify-between gap-3 text-sm">
                      <div class="flex min-w-0 items-center gap-2">
                        <span
                          class="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: row.color }}
                        />
                        <span class="truncate font-semibold text-gray-900">
                          {index() + 1}. {row.label}
                        </span>
                      </div>
                      <span class="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                        {Math.round(row.share * 100)}%
                      </span>
                    </div>

                    <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        class="h-full rounded-full"
                        style={{
                          width: `${
                            (getBreakdownMetricValue(row, props.metric) /
                              maxMetricValue()) *
                            100
                          }%`,
                          background: row.color,
                        }}
                      />
                    </div>

                    <div class="mt-2 text-sm text-gray-600">
                      {formatBreakdownMetricValue(
                        getBreakdownMetricValue(row, props.metric),
                        props.metric,
                      )}
                    </div>
                    <Show when={props.metric !== "cases"}>
                      <div class="mt-1 text-sm text-gray-600">
                        {formatCaseCountLabel(row.count)}
                      </div>
                    </Show>
                    <Show when={props.metric !== "fyc"}>
                      <div class="mt-1 text-sm text-gray-600">
                        FYC {formatAmount(row.fyc)}
                      </div>
                    </Show>
                    <Show when={props.metric !== "afyp"}>
                      <div class="mt-1 text-sm text-gray-600">
                        AFYP {formatAmount(row.afyp)}
                      </div>
                    </Show>
                    <Show when={isExpandable}>
                      <div class="mt-3 flex justify-end">
                        <Button
                          type="button"
                          variant="adminOutline"
                          size="sm"
                          class={`min-w-[9.5rem] justify-center ${
                            isExpanded() ? "bg-admin-from/5" : "bg-white"
                          }`}
                          onClick={() => props.onToggle(row.key)}
                          aria-expanded={isExpanded()}
                        >
                          {isExpanded() ? "Hide breakdown" : "Show breakdown"}
                        </Button>
                      </div>
                    </Show>
                  </div>

                  <Show when={isExpandable && isExpanded()}>
                    <div class="border-t border-gray-100 bg-white px-4 py-4">
                      <div class="space-y-3">
                        <For each={row.items}>
                          {(item) => (
                            <div class="rounded-2xl border border-gray-100 px-4 py-3">
                              <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span class="font-semibold text-gray-900">
                                  {item.label}
                                </span>
                                <span class="text-gray-500">
                                  {Math.round(item.share * 100)}%
                                </span>
                              </div>

                              <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                                <div
                                  class="h-full rounded-full"
                                  style={{
                                    width: `${
                                      (getBreakdownMetricValue(
                                        item,
                                        props.metric,
                                      ) /
                                        maxItemMetricValue) *
                                      100
                                    }%`,
                                    background: item.color,
                                  }}
                                />
                              </div>

                              <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                                <span>{formatCaseCountLabel(item.count)}</span>
                                <span>FYC {formatAmount(item.fyc)}</span>
                                <span>AFYP {formatAmount(item.afyp)}</span>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};

type ProductBreakdownBarChartProps = {
  rows: BreakdownRow[];
  metric: BreakdownMetricKey;
};

const ProductBreakdownBarChart: Component<ProductBreakdownBarChartProps> = (
  props,
) => {
  const visibleRows = () => props.rows;
  const maxMetricValue = () =>
    Math.max(
      1,
      ...visibleRows().map((row) =>
        getBreakdownMetricValue(row, props.metric, { useUnits: true }),
      ),
    );

  return (
    <div class="mt-4 rounded-[24px] border border-white bg-white p-4 shadow-sm shadow-gray-200/70">
      <div class="flex items-center justify-between gap-3">
        <div class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
          Top products by {getBreakdownMetricTitleText(props.metric)}
        </div>
      </div>

      <div class="mt-4 space-y-4">
        <For each={visibleRows()}>
          {(row, index) => (
            <div class="grid gap-2">
              <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div class="flex min-w-0 items-center gap-2">
                  <span
                    class="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                  <span class="truncate font-semibold text-gray-900">
                    {index() + 1}. {row.label}
                  </span>
                </div>
                <div class="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                  <span>{Math.round(row.share * 100)}%</span>
                  <span>
                    {formatBreakdownMetricValue(
                      getBreakdownMetricValue(row, props.metric, {
                        useUnits: true,
                      }),
                      props.metric,
                    )}
                  </span>
                </div>
              </div>

              <div class="relative h-4 overflow-hidden rounded-full bg-gray-100">
                <div
                  class="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${
                      (getBreakdownMetricValue(row, props.metric, {
                        useUnits: true,
                      }) /
                        maxMetricValue()) *
                      100
                    }%`,
                    background: `linear-gradient(90deg, ${row.color}, ${row.color}cc)`,
                  }}
                />
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

function formatDateInputValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDateInputValue(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function getInitialDateRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const previousDay = addDays(today, -1);
  const firstOfPreviousDayMonth = new Date(
    previousDay.getFullYear(),
    previousDay.getMonth(),
    1,
  );
  firstOfPreviousDayMonth.setHours(0, 0, 0, 0);

  return {
    startDate: formatDateInputValue(firstOfPreviousDayMonth),
    endDate: formatDateInputValue(previousDay),
  };
}

function resolveDateRange(
  startDate: string,
  endDate: string,
): DateRangeSelection | null {
  const start = parseDateInputValue(startDate);
  const lastDay = parseDateInputValue(endDate);
  if (!start || !lastDay || lastDay < start) {
    return null;
  }

  return {
    startDate,
    endDate,
    start,
    lastDay,
  };
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCount(value: number) {
  if (Number.isInteger(value)) {
    return value.toLocaleString("en-US");
  }

  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatAmount(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function triggerPdfDownload(blob: Blob, filename: string) {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (typeof URL.revokeObjectURL === "function") {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  }
}

function countProductUnits(product: ClosingProduct): number {
  let total = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    total += qp.quantity || 0;
  }
  return total;
}

function calculateClosingCaseCount(items: ClosingProduct[]): number {
  let total = 0;
  for (const product of items || []) {
    if (product.isRider) {
      continue;
    }
    total += countProductUnits(product);
  }
  return total;
}

function getBreakdownColor(index: number) {
  return (
    BREAKDOWN_COLORS[index % BREAKDOWN_COLORS.length] || BREAKDOWN_COLORS[0]
  );
}

function resolveSourceLabel(sourceId: string, sourceLabel?: string) {
  const trimmedSourceId = (sourceId || "").trim();
  if (!trimmedSourceId) return "Unknown";

  return (sourceLabel || "").trim() || trimmedSourceId;
}

function resolveSourceItemLabel(
  sourceItemId?: string,
  sourceItemLabel?: string,
) {
  return (sourceItemLabel || "").trim() || (sourceItemId || "").trim();
}

function buildSourceBreakdown(closingsList: Closing[]): SourceBreakdownRow[] {
  const sourceMap = new Map<
    string,
    {
      label: string;
      count: number;
      fyc: number;
      afyp: number;
      items: Map<
        string,
        { key: string; label: string; count: number; fyc: number; afyp: number }
      >;
    }
  >();

  closingsList.forEach((closing) => {
    const key = (closing.sourceId || "").trim() || "unknown";
    const itemLabel = resolveSourceItemLabel(
      closing.sourceItemId,
      closing.sourceItemLabel,
    );
    const caseCount = calculateClosingCaseCount(closing.items || []);
    const fyc = calculateClosingFyc(closing.items || []);
    const afyp = calculateClosingAfyp(closing.items || []);
    let sourceEntry = sourceMap.get(key);

    if (!sourceEntry) {
      sourceEntry = {
        label: resolveSourceLabel(key, closing.sourceLabel),
        count: 0,
        fyc: 0,
        afyp: 0,
        items: new Map(),
      };
      sourceMap.set(key, sourceEntry);
    }

    sourceEntry.count += caseCount;
    sourceEntry.fyc += fyc;
    sourceEntry.afyp += afyp;

    if (!itemLabel) {
      return;
    }

    const itemKey = itemLabel.toLowerCase();
    const itemEntry = sourceEntry.items.get(itemKey) || {
      key: itemKey,
      label: itemLabel,
      count: 0,
      fyc: 0,
      afyp: 0,
    };
    itemEntry.count += caseCount;
    itemEntry.fyc += fyc;
    itemEntry.afyp += afyp;
    sourceEntry.items.set(itemKey, itemEntry);
  });

  const sortedEntries = Array.from(sourceMap.entries()).sort(
    (a, b) => b[1].count - a[1].count || b[1].fyc - a[1].fyc,
  );
  const totalCount = sortedEntries.reduce(
    (sum, [, entry]) => sum + entry.count,
    0,
  );

  return sortedEntries.map(([key, entry], index) => {
    const color = getBreakdownColor(index);
    const items = Array.from(entry.items.values())
      .sort((a, b) => b.count - a.count || b.fyc - a.fyc)
      .map((item) => ({
        ...item,
        share: entry.count > 0 ? item.count / entry.count : 0,
        color,
      }));

    return {
      key,
      label: entry.label,
      count: entry.count,
      fyc: entry.fyc,
      afyp: entry.afyp,
      share: totalCount > 0 ? entry.count / totalCount : 0,
      color,
      items,
    };
  });
}

function addProductBreakdownEntry(
  product: ClosingProduct,
  productMap: Map<
    string,
    {
      label: string;
      count: number;
      fyc: number;
      afyp: number;
      units: number;
    }
  >,
) {
  if (product.isRider) {
    for (const rider of product.riders || []) {
      addProductBreakdownEntry(rider, productMap);
    }
    return;
  }

  const key =
    (product.productId || "").trim() ||
    (product.shortName || "").trim() ||
    (product.fullName || "").trim() ||
    "unknown";
  const label =
    (product.shortName || "").trim() ||
    (product.fullName || "").trim() ||
    (product.productId || "").trim() ||
    "Unknown product";
  const entry = productMap.get(key) || {
    label,
    count: 0,
    fyc: 0,
    afyp: 0,
    units: 0,
  };

  entry.count += 1;
  entry.fyc += calculateProductSelfFyc(product);
  entry.afyp += calculateProductSelfAfyp(product);
  entry.units += countProductUnits(product);
  productMap.set(key, entry);

  for (const rider of product.riders || []) {
    addProductBreakdownEntry(rider, productMap);
  }
}

function buildProductBreakdown(closingsList: Closing[]): BreakdownRow[] {
  const productMap = new Map<
    string,
    {
      label: string;
      count: number;
      fyc: number;
      afyp: number;
      units: number;
    }
  >();

  closingsList.forEach((closing) => {
    for (const product of closing.items || []) {
      addProductBreakdownEntry(product, productMap);
    }
  });

  const sortedEntries = Array.from(productMap.entries()).sort(
    (a, b) => b[1].units - a[1].units || b[1].fyc - a[1].fyc,
  );
  const totalUnits = sortedEntries.reduce(
    (sum, [, entry]) => sum + (entry.units > 0 ? entry.units : entry.count),
    0,
  );

  return sortedEntries.map(([key, entry], index) => {
    const units = entry.units > 0 ? entry.units : entry.count;
    return {
      key,
      label: entry.label,
      count: entry.count,
      fyc: entry.fyc,
      afyp: entry.afyp,
      units,
      share: totalUnits > 0 ? units / totalUnits : 0,
      color: getBreakdownColor(index),
    };
  });
}

function resolveAgentKey(
  fscCode?: string | null,
  fallbackName?: string | null,
) {
  const trimmedCode = (fscCode || "").trim();
  if (trimmedCode) return trimmedCode;
  const trimmedName = (fallbackName || "").trim();
  return trimmedName ? `name:${trimmedName}` : "unknown";
}

function pickName(existing: string, next: string) {
  const safeExisting = existing?.trim();
  const safeNext = next?.trim();
  if (!safeExisting) return safeNext || existing;
  if (!safeNext) return existing;
  if (safeExisting.toLowerCase().startsWith("unknown")) return safeNext;
  return existing;
}

function getDisplayName(user: TeamUser | undefined, fallbackName: string) {
  const nickname = (user?.nickname || "").trim();
  if (nickname) return nickname;
  const fullName = (user?.fullName || "").trim();
  if (fullName) return fullName;
  return fallbackName || "Unknown";
}

type FilteredProductMetrics = {
  count: number;
  caseCount: number;
  fyc: number;
  fyp: number;
  afyp: number;
  afyc: number;
};

function parseProductKeywords(value?: string): string[] {
  return String(value || "")
    .split(",")
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
}

function calculateFilteredProductMetrics(
  items: ClosingProduct[],
  selectedProductTypeKeys: Set<string>,
  includedKeywords: string[],
  excludedKeywords: string[],
): FilteredProductMetrics {
  const totals: FilteredProductMetrics = {
    count: 0,
    caseCount: 0,
    fyc: 0,
    fyp: 0,
    afyp: 0,
    afyc: 0,
  };

  const visit = (
    product: ClosingProduct,
    inheritedFypMultiplier?: number,
    inheritedTypeKey?: string,
    inheritedFycRate?: number,
  ) => {
    const ownTypeKey = (product.type || "").trim();
    const effectiveTypeKey = inheritedTypeKey || ownTypeKey;
    const effectiveFypMultiplier =
      inheritedFypMultiplier ??
      (product.type?.toLowerCase() === "single" ? 0.1 : 1);
    const effectiveFycRate = product.fycRate || inheritedFycRate || 0;
    const matchesType =
      selectedProductTypeKeys.size === 0 ||
      (effectiveTypeKey !== "" && selectedProductTypeKeys.has(effectiveTypeKey));
    const productSearchText = [
      product.fullName,
      product.shortName,
      product.productId,
    ]
      .map((value) =>
        String(value || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean)
      .join(" ");
    const matchesIncludedKeywords =
      includedKeywords.length === 0 ||
      includedKeywords.some((keyword) => productSearchText.includes(keyword));
    const matchesKeywords =
      matchesIncludedKeywords &&
      (excludedKeywords.length === 0 ||
        excludedKeywords.every(
          (keyword) => !productSearchText.includes(keyword),
        ));

    if (matchesType && matchesKeywords) {
      totals.count += 1;
      if (inheritedFypMultiplier === undefined && !product.isRider) {
        for (const qp of product.quantitiesAndPremiums || []) {
          totals.caseCount += qp.quantity || 0;
        }
      }
      totals.fyc += calculateProductSelfFyc(product);
      totals.fyp += calculateProductSelfFyp(product);
      totals.afyp += calculateProductSelfAfyp(product, effectiveFypMultiplier);
      totals.afyc += calculateProductSelfAfyc(
        product,
        effectiveFypMultiplier,
        effectiveFycRate,
      );
    }

    (product.riders || []).forEach((rider) =>
      visit(rider, effectiveFypMultiplier, effectiveTypeKey, effectiveFycRate),
    );
  };

  (items || []).forEach((product) => visit(product));
  return totals;
}

function calculateSharedMetricShare(
  value: number,
  hasShared: boolean,
  hasSharedRecipient: boolean,
): number {
  return hasShared && hasSharedRecipient ? value / 2 : value;
}

function closingMatchesSourceFilters(
  closing: Closing,
  table: ReportTableLayout,
): boolean {
  const sourceIds = table.sources || [];
  const sourceItemIds = table.sourceItemIds || [];

  if (sourceIds.length === 0 && sourceItemIds.length === 0) {
    return true;
  }

  if (sourceIds.includes(closing.sourceId)) {
    return true;
  }

  const sourceItemId = (closing.sourceItemId || "").trim();
  return sourceItemId !== "" && sourceItemIds.includes(sourceItemId);
}

function buildRows(
  map: Map<string, { name: string; value: number }>,
): ReportRenderRow[] {
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => {
      if (b.value !== a.value) {
        return b.value - a.value;
      }

      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

function describeAgency(agency: Pick<TeamAgency, "code" | "name">) {
  const code = (agency.code || "").trim();
  const name = (agency.name || "").trim();
  return name ? `${name} (${code})` : code;
}

function resolveTableAgencies(
  table: ReportTableLayout,
  agencies: TeamAgency[],
): TeamAgency[] {
  const selectedCodes =
    table.includeAllAgencies
      ? agencies.map((agency) => agency.code)
      : table.includeAllNonLegacyAgencies
        ? agencies
            .filter((agency) => agency.isDeleted !== true && agency.isActive !== false)
            .map((agency) => agency.code)
        : !table.agencyCodes || table.agencyCodes.length === 0
          ? agencies.map((agency) => agency.code)
          : table.agencyCodes;
  const byCode = new Map(
    agencies
      .map((agency) => [(agency.code || "").trim(), agency] as const)
      .filter(([code]) => code !== ""),
  );
  const seen = new Set<string>();

  return selectedCodes
    .map((rawCode) => {
      const code = String(rawCode || "").trim();
      if (!code || seen.has(code)) return null;
      seen.add(code);
      return byCode.get(code) || { code, name: "" };
    })
    .filter((agency): agency is TeamAgency => agency !== null);
}

function applyAgencyBreakdownToTable(
  table: ReportTableLayout,
  agency: TeamAgency,
  index: number,
  singleTable: boolean,
): ReportTableLayout {
  const agencyLabel = describeAgency(agency);
  const id = table.id * 1000 + index + 1;

  if (singleTable) {
    return {
      ...table,
      id,
      agencyGroupLabel: agencyLabel,
      includeAllAgencies: false,
      agencyCodes: [agency.code],
      agencyBreakdown: false,
    };
  }

  return {
    ...table,
    id,
    agencyGroupLabel: agencyLabel,
    includeAllAgencies: false,
    agencyCodes: [agency.code],
    agencyBreakdown: false,
  };
}

function isAgencySummaryReport(report: ReportTemplate): boolean {
  return report.layoutMode === "agencySummary";
}

function isCombinedFscReport(report: ReportTemplate): boolean {
  return report.layoutMode
    ? report.layoutMode === "combinedFsc"
    : report.singleTable === true;
}

function isNonLegacyAgency(agency: TeamAgency | undefined): boolean {
  return !!agency && agency.isDeleted !== true && agency.isActive !== false;
}

function isLegacyAgency(agency: TeamAgency | undefined): boolean {
  return agency?.isDeleted === true || agency?.isActive === false;
}

function applyTemplate(template: string, date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return template
    .replaceAll("{YYYY}", year)
    .replaceAll("{MM}", month)
    .replaceAll("{DD}", day)
    .replaceAll("{YYYYMM}", `${year}${month}`)
    .replaceAll("{YYYYMMDD}", `${year}${month}${day}`);
}

const Reports: Component = () => {
  const location = useLocation();
  const adminOption = createMemo(() => adminOptionForPath(location.pathname)!);
  const navigate = useNavigate();
  const initialDateRange = getInitialDateRange();
  const [draftStartDate, setDraftStartDate] = createSignal(
    initialDateRange.startDate,
  );
  const [draftEndDate, setDraftEndDate] = createSignal(
    initialDateRange.endDate,
  );
  const [appliedRange, setAppliedRange] =
    createSignal<DateRangeSelection | null>(null);
  const [dateError, setDateError] = createSignal("");
  const [expandedSourceKeys, setExpandedSourceKeys] = createSignal<string[]>(
    [],
  );
  const [sourceBreakdownMetric, setSourceBreakdownMetric] =
    createSignal<BreakdownMetricKey>("cases");
  const [productBreakdownMetric, setProductBreakdownMetric] =
    createSignal<BreakdownMetricKey>("cases");
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [downloadingReportId, setDownloadingReportId] = createSignal<
    ReportTemplate["id"] | null
  >(null);

  const applySelectedRange = () => {
    const nextRange = resolveDateRange(draftStartDate(), draftEndDate());
    if (!nextRange) {
      setDateError(
        "Choose a valid start and end date. The end date must be on or after the start date.",
      );
      return;
    }

    setDateError("");
    setAppliedRange(nextRange);
  };

  const closingsParams = createMemo(() => {
    const range = appliedRange();
    if (!range) return null;
    return {
      startDate: range.startDate,
      endDate: range.endDate,
    };
  });

  const [closings] = createResource(closingsParams, (params) =>
    closingsService.getClosings(params),
  );

  const [teamData] = createResource(() => teamService.getTeamData());
  const [reportsData] = createResource(() => reportsService.getReports());
  const [sourceOptionsData] = createResource(() => sourcesService.getSources());
  const [closingsDateRange] = createResource(() =>
    closingsService.getClosingsDateRange(),
  );
  const [reportLayouts, setReportLayouts] = createSignal<ReportTemplate[]>([]);
  const sourceOptions = createMemo(() => {
    const options = sourceOptionsData();
    return options || [];
  });

  const minPickerDate = createMemo(() => {
    const raw = closingsDateRange()?.minDate;
    if (!raw) return undefined;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return undefined;
    return `${d.getFullYear()}-01-01`;
  });

  const maxPickerDate = createMemo(() => {
    const today = new Date();
    return `${today.getFullYear()}-12-31`;
  });
  const hasLoadedRange = createMemo(() => !!appliedRange());
  const isReportDataLoading = createMemo(
    () => hasLoadedRange() && (closings.loading || teamData.loading),
  );
  const activeRangeLabel = createMemo(() => {
    const range = appliedRange();
    if (!range) return "";
    return `${formatDateLabel(range.start)} - ${formatDateLabel(range.lastDay)}`;
  });

  createEffect(() => {
    setReportLayouts(reportsData() || []);
  });

  const teamByFsc = createMemo(() => {
    const map = new Map<string, TeamUser>();
    (teamData()?.users || []).forEach((user) => {
      const fscCode = (user.fscCode || "").trim();
      if (fscCode) {
        map.set(fscCode, user);
      }
    });
    return map;
  });
  const closingsList = createMemo(() => closings() || []);
  const rawSourceBreakdown = createMemo(() =>
    hasLoadedRange() ? buildSourceBreakdown(closingsList()) : [],
  );
  const sourceBreakdown = createMemo(() =>
    rankSourceBreakdownRows(rawSourceBreakdown(), sourceBreakdownMetric()),
  );
  const rawProductBreakdown = createMemo(() =>
    hasLoadedRange() ? buildProductBreakdown(closingsList()) : [],
  );
  const productBreakdown = createMemo(() =>
    rankProductBreakdownRows(rawProductBreakdown(), productBreakdownMetric()),
  );
  const summaryMetrics = createMemo(() => {
    if (!hasLoadedRange()) return null;
    const list = closingsList();
    return {
      cases: list.reduce(
        (sum, closing) => sum + calculateClosingCaseCount(closing.items || []),
        0,
      ),
      totalFyc: list.reduce(
        (sum, closing) => sum + calculateClosingFyc(closing.items || []),
        0,
      ),
      totalAfyp: list.reduce(
        (sum, closing) => sum + calculateClosingAfyp(closing.items || []),
        0,
      ),
      sources: rawSourceBreakdown().length,
      products: rawProductBreakdown().length,
    };
  });

  createEffect(() => {
    const rows = sourceBreakdown();
    const availableKeys = new Set(rows.map((row) => row.key));
    setExpandedSourceKeys((current) => {
      const next = current.filter((key) => availableKeys.has(key));
      return next.length === current.length ? current : next;
    });
  });

  const toggleSourceExpansion = (key: string) => {
    setExpandedSourceKeys((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key],
    );
  };

  const buildReportTables = (report: ReportTemplate): ReportRenderTable[] => {
    const closingsData = closingsList();
    const teamMap = teamByFsc();
    const reportYear =
      appliedRange()?.lastDay.getFullYear() || new Date().getFullYear();

    const advisors = (teamData()?.users || []).filter((user) => {
      const fscCode = (user.fscCode || "").trim();
      return fscCode && !isStaffUser(fscCode);
    });
    const agencyOptions = teamData()?.agencies || [];
    const agencyByCode = new Map(
      agencyOptions
        .map((agency) => [(agency.code || "").trim(), agency] as const)
        .filter(([code]) => code !== ""),
    );

    const isRookie = (user: TeamUser | undefined, rookieYears: number) => {
      if (!user?.contractYear) return false;
      const startYear = reportYear - rookieYears + 1;
      return user.contractYear >= startYear;
    };

    const isAgencyAllowed = (
      user: TeamUser | undefined,
      table: ReportTableLayout,
    ) => {
      if (!user) return false;
      if (table.includeAllAgencies) {
        return true;
      }
      if (table.includeAllNonLegacyAgencies) {
        return isNonLegacyAgency(agencyByCode.get(user.agencyCode || ""));
      }
      if (!table.agencyCodes || table.agencyCodes.length === 0) {
        return true;
      }
      return table.agencyCodes.includes(user.agencyCode || "");
    };

    const isAdvisorAllowedByRookieFilter = (
      user: TeamUser | undefined,
      rookieFilter: "all" | "rookies" | "nonRookies",
      rookieYears: number,
    ) => {
      if (rookieFilter === "all") return true;
      const rookie = isRookie(user, rookieYears);
      return rookieFilter === "rookies" ? rookie : !rookie;
    };

    const seedAll = (
      map: Map<string, { name: string; value: number }>,
      list: TeamUser[],
    ) => {
      list.forEach((user) => {
        const fscCode = (user.fscCode || "").trim();
        if (!fscCode) return;
        map.set(fscCode, {
          name: getDisplayName(user, fscCode),
          value: 0,
        });
      });
    };

    const addValue = (
      map: Map<string, { name: string; value: number }>,
      key: string,
      name: string,
      delta: number,
    ) => {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { name, value: delta });
      } else {
        existing.value += delta;
        existing.name = pickName(existing.name, name);
      }
    };

    const computeMetric = (
      closing: Closing,
      table: ReportTableLayout,
      filteredProducts: FilteredProductMetrics,
      hasProductFilters: boolean,
    ) => {
      const metricType = table.metric?.type || "countClosings";
      switch (metricType) {
        case "fyc":
          return filteredProducts.fyc;
        case "afyp":
          return filteredProducts.afyp;
        case "fyp":
          return filteredProducts.fyp;
        case "afyc":
          return filteredProducts.afyc;
        case "referrals":
          return hasProductFilters && filteredProducts.count === 0
            ? 0
            : closing.referrals || 0;
        case "countCases":
          return filteredProducts.caseCount;
        case "countClosings":
          return hasProductFilters ? (filteredProducts.count > 0 ? 1 : 0) : 1;
        default:
          return 0;
      }
    };

    const makeTable = (table: ReportTableLayout): ReportRenderTable => {
      const map = new Map<string, { name: string; value: number }>();
      const includeAll = table.includeAllAdvisors !== false;
      const rookieYears = table.rookieYears ?? 2;
      const rookieFilter = includeAll ? "all" : table.rookieFilter || "all";
      const selectedProductTypeKeys = new Set(table.productTypeKeys || []);
      const includedKeywords = parseProductKeywords(
        table.includeProductKeywords,
      );
      const excludedKeywords = parseProductKeywords(
        table.excludeProductKeywords,
      );
      const hasProductFilters =
        selectedProductTypeKeys.size > 0 ||
        includedKeywords.length > 0 ||
        excludedKeywords.length > 0;

      const shouldSeedRoster =
        includeAll ||
        table.rookieFilter === "rookies" ||
        table.rookieFilter === "nonRookies";

      if (shouldSeedRoster) {
        const roster = advisors.filter(
          (user) =>
            isAgencyAllowed(user, table) &&
            isAdvisorAllowedByRookieFilter(user, rookieFilter, rookieYears),
        );
        seedAll(map, roster);
      }

      closingsData.forEach((closing) => {
        if (!closingMatchesSourceFilters(closing, table)) {
          return;
        }

        const filteredProducts = calculateFilteredProductMetrics(
          closing.items || [],
          selectedProductTypeKeys,
          includedKeywords,
          excludedKeywords,
        );
        const value = computeMetric(
          closing,
          table,
          filteredProducts,
          hasProductFilters,
        );
        const primaryKey = resolveAgentKey(closing.fscCode, closing.fscName);
        const primaryUser = teamMap.get((closing.fscCode || "").trim());
        const primaryName = getDisplayName(
          primaryUser,
          closing.fscName || closing.fscCode || "Unknown",
        );

        const hasShared =
          typeof closing.isShared === "boolean"
            ? closing.isShared
            : !!(closing.sharedFscCode || closing.sharedFscName);
        const sharedKey = closing.sharedFscCode
          ? resolveAgentKey(closing.sharedFscCode, closing.sharedFscName)
          : "";
        const sharedUser = closing.sharedFscCode
          ? teamMap.get((closing.sharedFscCode || "").trim())
          : undefined;
        const sharedName = closing.sharedFscCode
          ? getDisplayName(
              sharedUser,
              closing.sharedFscName || closing.sharedFscCode || "Unknown",
            )
          : "";

        const primaryAgencyAllowed = isAgencyAllowed(primaryUser, table);
        const sharedAgencyAllowed = isAgencyAllowed(sharedUser, table);

        const primaryRookieAllowed = isAdvisorAllowedByRookieFilter(
          primaryUser,
          rookieFilter,
          rookieYears,
        );
        const sharedRookieAllowed = isAdvisorAllowedByRookieFilter(
          sharedUser,
          rookieFilter,
          rookieYears,
        );

        const primaryIncluded = primaryAgencyAllowed && primaryRookieAllowed;
        const sharedIncluded =
          hasShared && sharedKey && sharedAgencyAllowed && sharedRookieAllowed;
        const recipientCount =
          (primaryIncluded ? 1 : 0) + (sharedIncluded ? 1 : 0);

        if (recipientCount === 0) {
          return;
        }

        const sharedValue = calculateSharedMetricShare(
          value,
          hasShared,
          Boolean(sharedKey),
        );

        if (primaryIncluded) {
          addValue(map, primaryKey, primaryName, sharedValue);
        }
        if (sharedIncluded) {
          addValue(map, sharedKey, sharedName, sharedValue);
        }
      });

      return {
        ...table,
        includeFooterTotalRow: table.includeFooterTotalRow === true,
        rows: buildRows(map),
      };
    };

    const makeAgencySummaryTable = (
      table: ReportTableLayout,
    ): ReportRenderTable => {
      const map = new Map<string, { name: string; value: number }>();
      const selectedProductTypeKeys = new Set(table.productTypeKeys || []);
      const includedKeywords = parseProductKeywords(
        table.includeProductKeywords,
      );
      const excludedKeywords = parseProductKeywords(
        table.excludeProductKeywords,
      );
      const hasProductFilters =
        selectedProductTypeKeys.size > 0 ||
        includedKeywords.length > 0 ||
        excludedKeywords.length > 0;
      const allowedAgencyCodes = new Set(
        table.includeAllAgencies
          ? agencyOptions.map((agency) => agency.code)
          : table.includeAllNonLegacyAgencies
            ? agencyOptions
                .filter(isNonLegacyAgency)
                .map((agency) => agency.code)
            : !table.agencyCodes || table.agencyCodes.length === 0
              ? agencyOptions.map((agency) => agency.code)
          : table.agencyCodes,
      );

      allowedAgencyCodes.forEach((code) => {
        const trimmedCode = String(code || "").trim();
        if (!trimmedCode) return;
        const agency = agencyByCode.get(trimmedCode);
        addValue(
          map,
          trimmedCode,
          describeAgency(agency || { code: trimmedCode, name: "" }),
          0,
        );
      });

      closingsData.forEach((closing) => {
        if (!closingMatchesSourceFilters(closing, table)) {
          return;
        }

        const filteredProducts = calculateFilteredProductMetrics(
          closing.items || [],
          selectedProductTypeKeys,
          includedKeywords,
          excludedKeywords,
        );
        const value = computeMetric(
          closing,
          table,
          filteredProducts,
          hasProductFilters,
        );
        if (value === 0) return;

        const recipients: Array<{ code: string; name: string }> = [];
        const primaryUser = teamMap.get((closing.fscCode || "").trim());
        const primaryAgencyCode = (primaryUser?.agencyCode || "").trim();
        if (primaryAgencyCode && allowedAgencyCodes.has(primaryAgencyCode)) {
          const agency = agencyByCode.get(primaryAgencyCode);
          recipients.push({
            code: primaryAgencyCode,
            name: describeAgency(agency || { code: primaryAgencyCode, name: "" }),
          });
        }

        const hasShared =
          typeof closing.isShared === "boolean"
            ? closing.isShared
            : !!(closing.sharedFscCode || closing.sharedFscName);
        const sharedUser = closing.sharedFscCode
          ? teamMap.get((closing.sharedFscCode || "").trim())
          : undefined;
        const sharedAgencyCode = (sharedUser?.agencyCode || "").trim();
        if (
          hasShared &&
          sharedAgencyCode &&
          sharedAgencyCode !== primaryAgencyCode &&
          allowedAgencyCodes.has(sharedAgencyCode)
        ) {
          const agency = agencyByCode.get(sharedAgencyCode);
          recipients.push({
            code: sharedAgencyCode,
            name: describeAgency(agency || { code: sharedAgencyCode, name: "" }),
          });
        }

        if (recipients.length === 0) return;
        const sharedValue = calculateSharedMetricShare(
          value,
          hasShared,
          Boolean(sharedAgencyCode && sharedAgencyCode !== primaryAgencyCode),
        );
        recipients.forEach((recipient) =>
          addValue(map, recipient.code, recipient.name, sharedValue),
        );
      });

      return {
        ...table,
        includeFooterTotalRow: table.includeFooterTotalRow === true,
        rows: buildRows(map),
      };
    };

    if (isAgencySummaryReport(report)) {
      return report.tables.map(makeAgencySummaryTable);
    }

    const agencyBreakdownSource = report.agencyBreakdown
      ? report.tables[0]
      : report.tables.find(
      (table) => table.agencyBreakdown === true,
    );
    const expandedLayoutTables = agencyBreakdownSource
      ? resolveTableAgencies(agencyBreakdownSource, teamData()?.agencies || [])
          .flatMap((agency, agencyIndex) =>
            report.tables.map((table, tableIndex) =>
              applyAgencyBreakdownToTable(
                table,
                agency,
                agencyIndex * Math.max(1, report.tables.length) + tableIndex,
                isCombinedFscReport(report),
              ),
            ),
          )
      : report.tables.flatMap((table) => {
      if (!table.agencyBreakdown) {
        return [table];
      }

      const agencies = resolveTableAgencies(table, teamData()?.agencies || []);
      if (agencies.length === 0) {
        return [table];
      }

      return agencies.map((agency, index) =>
        applyAgencyBreakdownToTable(
          table,
          agency,
          index,
          isCombinedFscReport(report),
        ),
      );
    });

    let tables = expandedLayoutTables.map(makeTable);
    const maxRows = Math.max(1, ...tables.map((table) => table.rows.length));

    if (report.includeIndexTable && !isCombinedFscReport(report)) {
      const indexRows = Array.from({ length: maxRows }).map(() => ({
        name: "",
        value: 0,
      }));
      tables = [
        {
          id: "index-only",
          titleLines: ["", "", ""],
          valueLabel: "No",
          valueFormat: "count",
          rows: indexRows,
          showIndex: true,
          indexOnly: true,
          minValue: 0,
          highlightMin: false,
          metric: { type: "countClosings" },
        },
        ...tables,
      ];
    }

    return tables;
  };

  const formatReportFilename = (report: ReportTemplate) => {
    const lastDay = appliedRange()?.lastDay || new Date();
    const filenameBase = applyTemplate(
      report.filenameTemplate || String(report.id),
      lastDay,
    );
    return filenameBase.endsWith(".pdf") ? filenameBase : `${filenameBase}.pdf`;
  };

  const downloadReport = async (report: ReportTemplate) => {
    if (isDownloading()) return;
    const range = appliedRange();
    if (!range) return;
    if (closings.loading || teamData.loading) return;
    const previewWindow =
      typeof window !== "undefined" && isIPadDevice()
        ? window.open("", "_blank")
        : null;
    let previewUrl: string | null = null;
    setDownloadingReportId(report.id);
    setIsDownloading(true);
    try {
      if (previewWindow) {
        try {
          previewWindow.document.title = "Preparing report";
          previewWindow.document.body.innerHTML =
            '<div style="padding:24px;font:16px -apple-system,BlinkMacSystemFont,sans-serif;color:#374151;">Preparing report...</div>';
        } catch {
          // Ignore window priming failures and fall back below if needed.
        }
      }

      const tables = buildReportTables(report);
      const { start, lastDay } = range;
      const reportDate = lastDay;
      const maxRows = Math.max(1, ...tables.map((table) => table.rows.length));
      const startLabel = formatDateLabel(start);
      const endLabel = formatDateLabel(lastDay);
      const reportRangeLabel = `${startLabel} - ${endLabel}`;
      const filename = formatReportFilename(report);
      const pdfBlob = await reportsService.generateReportPdf({
        report,
        reportDate: reportDate.toISOString(),
        tables,
        maxRows,
        reportRangeLabel,
        filename,
      });
      if (previewWindow && !previewWindow.closed) {
        const namedPdf =
          typeof File === "function"
            ? new File([pdfBlob], filename, { type: "application/pdf" })
            : pdfBlob;
        previewUrl = URL.createObjectURL(namedPdf);
        openPdfPreviewPage(previewWindow, previewUrl, filename);
        window.setTimeout(() => {
          URL.revokeObjectURL(previewUrl!);
        }, 60_000);
      } else {
        triggerPdfDownload(pdfBlob, filename);
      }
    } catch (error) {
      if (previewWindow && !previewWindow.closed && previewUrl === null) {
        previewWindow.close();
      }
      throw error;
    } finally {
      setDownloadingReportId(null);
      setIsDownloading(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        title={adminOption().title}
        icon={<Dynamic component={adminOption().icon} class="h-5 w-5" />}
        subtitle={adminOption().description}
        onBack={() => navigate(-1)}
      />
      <PageBody>
        <div class="flex w-full flex-col gap-6">
          <div class="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
            <form
              class="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                applySelectedRange();
              }}
            >
              <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] lg:items-end">
                <div class="flex flex-col gap-1">
                  <label
                    for="extract-reports-start-date"
                    class="text-base font-semibold text-gray-700"
                  >
                    Start date
                  </label>
                  <DateField
                    id="extract-reports-start-date"
                    value={draftStartDate()}
                    onChange={setDraftStartDate}
                    min={minPickerDate()}
                    max={maxPickerDate()}
                    pickerOnly
                  />
                </div>

                <div class="hidden pb-2 text-center text-sm font-semibold uppercase tracking-[0.2em] text-gray-400 lg:block">
                  to
                </div>

                <div class="flex flex-col gap-1">
                  <label
                    for="extract-reports-end-date"
                    class="text-base font-semibold text-gray-700"
                  >
                    End date
                  </label>
                  <DateField
                    id="extract-reports-end-date"
                    value={draftEndDate()}
                    onChange={setDraftEndDate}
                    min={minPickerDate()}
                    max={maxPickerDate()}
                    pickerOnly
                  />
                </div>

                <div class="flex">
                  <Button
                    type="submit"
                    variant="admin"
                    size="lg"
                    class="w-full justify-center lg:ml-auto lg:w-auto"
                  >
                    Generate Reports
                  </Button>
                </div>
              </div>

              <div class="flex flex-col gap-1 text-sm">
                <Show when={dateError()}>
                  {(message) => (
                    <p role="alert" class="text-red-600">
                      {message()}
                    </p>
                  )}
                </Show>
              </div>
            </form>
          </div>

          <Show when={isReportDataLoading()}>
            <div class="py-6">
              <LoadingState label="Loading report data..." />
            </div>
          </Show>

          <Show when={hasLoadedRange() && !isReportDataLoading()}>
            <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-gray-900">
                    Available Reports
                  </h2>
                  <p class="text-base text-gray-500">
                    Download reports for {activeRangeLabel()}.
                  </p>
                </div>
              </div>

              <Show
                when={reportLayouts().length > 0}
                fallback={
                  <div class="mt-4 rounded-lg border border-dashed border-gray-200 p-6 text-center text-base text-gray-500">
                    No reports configured yet.
                  </div>
                }
              >
                <div class="mt-4 space-y-2">
                  <For each={reportLayouts()}>
                    {(report) => (
                      <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3">
                        <div class="text-base font-semibold text-gray-900">
                          {formatReportFilename(report)}
                        </div>
                        <IconButton
                          type="button"
                          variant="admin"
                          size="lg"
                          onClick={() => downloadReport(report)}
                          disabled={isDownloading()}
                          title="Download report"
                          aria-label="Download report"
                          aria-busy={
                            isDownloading() &&
                            downloadingReportId() === report.id
                          }
                        >
                          <Show
                            when={
                              isDownloading() &&
                              downloadingReportId() === report.id
                            }
                            fallback={<TbOutlineDownload class="h-4 w-4" />}
                          >
                            <Spinner class="h-4 w-4 text-current" />
                          </Show>
                        </IconButton>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-gray-900">
                    Visual Breakdown
                  </h2>
                  <p class="text-base text-gray-500">
                    Quick visual breakdown of cases for {activeRangeLabel()}.
                  </p>
                </div>

                <Show when={summaryMetrics()}>
                  {(summary) => (
                    <div class="flex flex-wrap gap-2 text-sm">
                      <div class="rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-700">
                        {formatCaseCountLabel(summary().cases)}
                      </div>
                      <div class="rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-700">
                        FYC {formatAmount(summary().totalFyc)}
                      </div>
                      <div class="rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-700">
                        AFYP {formatAmount(summary().totalAfyp)}
                      </div>
                      <div class="rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-700">
                        {formatCount(summary().products)} products
                      </div>
                    </div>
                  )}
                </Show>
              </div>

              <Show
                when={closingsList().length > 0}
                fallback={
                  <div class="mt-6 rounded-lg border border-dashed border-gray-200 p-6 text-center text-base text-gray-500">
                    No cases were found for this date range.
                  </div>
                }
              >
                <div class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section class="rounded-[24px] border border-gray-200 bg-gray-50/80 p-5">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 class="text-base font-semibold text-gray-900">
                          Source Breakdown
                        </h3>
                        <p class="text-sm text-gray-500">
                          Compare sources by{" "}
                          {getBreakdownMetricTitleText(sourceBreakdownMetric())}
                          . Expand a source to inspect its item breakdown.
                        </p>
                      </div>
                      <BreakdownMetricToggle
                        sectionLabel="Source breakdown"
                        value={sourceBreakdownMetric()}
                        onChange={setSourceBreakdownMetric}
                      />
                    </div>

                    <Show
                      when={sourceBreakdown().length > 0}
                      fallback={
                        <div class="mt-4 rounded-lg border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
                          No source data is available yet.
                        </div>
                      }
                    >
                      <SourceBreakdownDonut
                        rows={sourceBreakdown()}
                        metric={sourceBreakdownMetric()}
                        expandedKeys={expandedSourceKeys()}
                        onToggle={toggleSourceExpansion}
                      />
                    </Show>
                  </section>

                  <section class="rounded-[24px] border border-gray-200 bg-gray-50/80 p-5">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 class="text-base font-semibold text-gray-900">
                          Product Breakdown
                        </h3>
                        <p class="text-sm text-gray-500">
                          Product mix ranked by{" "}
                          {getBreakdownMetricTitleText(
                            productBreakdownMetric(),
                          )}{" "}
                          for the selected range.
                        </p>
                      </div>
                      <BreakdownMetricToggle
                        sectionLabel="Product breakdown"
                        value={productBreakdownMetric()}
                        onChange={setProductBreakdownMetric}
                      />
                    </div>

                    <Show
                      when={productBreakdown().length > 0}
                      fallback={
                        <div class="mt-4 rounded-lg border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
                          No product data is available yet.
                        </div>
                      }
                    >
                      <ProductBreakdownBarChart
                        rows={productBreakdown()}
                        metric={productBreakdownMetric()}
                      />
                    </Show>
                  </section>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </PageBody>
    </PageShell>
  );
};

export default Reports;
