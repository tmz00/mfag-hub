import {
  Component,
  For,
  JSX,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { PageBody, PageHeader, PageShell } from "../../../components/ui";
import { formatCurrency } from "../../../utils/helpers";
import { dashboardOptions } from "../dashboardOptions";
import { hasSharedToolQuery } from "./_sharedLink";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TabId = "overview" | "p24" | "c19";
type MetricKind = "count" | "premium";

type PersistencyStats = {
  persistencyPct: number;
  inforce: number;
  maxLapAtTarget: number;
  lapReductionRequired: number;
  reinstatementsRequired: number;
};

type ForecastStats = {
  averageExp: number;
  persistencyPct: number;
  maxLapAtTarget: number;
  lapReductionPerMonth: number;
  lapReductionThreeMonths: number;
  reinstatementsPerMonth: number;
  reinstatementsThreeMonths: number;
};

type TabDef = {
  id: Exclude<TabId, "overview">;
  shortName: string;
  fullName: string;
  kind: MetricKind;
  target: number;
  targetLabel?: string;
  tagline: string;
  affects: string[];
  formulaNote: () => JSX.Element;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SHARED_QUERY_KEYS = [
  "c19exp",
  "c19lap",
  "p24exp",
  "p24lap",
  "e19exp1",
  "e19exp2",
  "e19exp3",
  "e19lap",
  "e24exp1",
  "e24exp2",
  "e24exp3",
  "e24lap",
] as const;

const countFmt = new Intl.NumberFormat("en-SG", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (value: number, min = 0, max = Number.POSITIVE_INFINITY) =>
  Math.min(max, Math.max(min, value));

const formatPercent = (value: number) => `${clamp(value).toFixed(1)}%`;

const formatValue = (
  kind: MetricKind,
  value: number,
  options?: { roundUp?: boolean },
) => {
  const safeValue = clamp(value);
  if (kind === "premium") return formatCurrency(safeValue);
  const nextValue = options?.roundUp ? Math.ceil(safeValue) : safeValue;
  return countFmt.format(nextValue);
};

const parseParamNumber = (
  params: URLSearchParams,
  key: (typeof SHARED_QUERY_KEYS)[number],
) => {
  const value = params.get(key);
  if (value === null) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
};

const calculatePersistency = (
  expValue: number,
  lapValue: number,
  kind: MetricKind,
  target = 85,
): PersistencyStats => {
  const exp = clamp(expValue);
  const lap = clamp(lapValue);
  const maxLapAtTarget = exp * ((100 - target) / 100);

  if (exp <= 0) {
    const reinstatements = kind === "count" ? Math.ceil(lap) : lap;
    return {
      persistencyPct: 0,
      inforce: 0,
      maxLapAtTarget,
      lapReductionRequired: lap,
      reinstatementsRequired: reinstatements,
    };
  }

  const inforce = Math.max(0, exp - lap);
  const persistencyPct = ((exp - lap) / exp) * 100;
  const lapReductionRequired = Math.max(0, lap - maxLapAtTarget);
  const reinstatementsRequired =
    kind === "count" ? Math.ceil(lapReductionRequired) : lapReductionRequired;

  return {
    persistencyPct: clamp(persistencyPct),
    inforce,
    maxLapAtTarget,
    lapReductionRequired,
    reinstatementsRequired,
  };
};

const estimateNextThreeMonths = (
  expHistory: [number, number, number],
  currentLap: number,
  kind: MetricKind,
  target = 85,
): ForecastStats => {
  const averageExp =
    (clamp(expHistory[0]) + clamp(expHistory[1]) + clamp(expHistory[2])) / 3;
  const monthly = calculatePersistency(averageExp, currentLap, kind, target);

  return {
    averageExp,
    persistencyPct: monthly.persistencyPct,
    maxLapAtTarget: monthly.maxLapAtTarget,
    lapReductionPerMonth: monthly.lapReductionRequired,
    lapReductionThreeMonths: monthly.lapReductionRequired * 3,
    reinstatementsPerMonth: monthly.reinstatementsRequired,
    reinstatementsThreeMonths: monthly.reinstatementsRequired * 3,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Module-level tab state (resets on vi.resetModules() in tests)
// ─────────────────────────────────────────────────────────────────────────────

const [activeTab, setActiveTab] = createSignal<TabId>("overview");

// ─────────────────────────────────────────────────────────────────────────────
// Tab definitions
// ─────────────────────────────────────────────────────────────────────────────

const TABS: TabDef[] = [
  {
    id: "p24",
    shortName: "24-Month",
    fullName: "24-Month (Premium)",
    kind: "premium",
    target: 85,
    targetLabel: "75% every quarter, 85% by Dec",
    tagline:
      "Measures the quality of Regular Premium policies over a moving 24-month window on an annualised premium basis. Target is 75% every quarter, 85% by December. Excludes Healthshield policies.",
    affects: [
      "Appointment & Validation",
      "Clubs & Awards",
      "Convention",
      "Contract Maintenance",
    ],
    formulaNote: () => (
      <div class="space-y-2 text-base text-gray-700">
        <p>
          <span class="font-semibold">Formula:</span> Persistency = 100 − (LAP ÷
          EXP × 100)
        </p>
        <p>
          <span class="font-semibold">EXP (Exposure):</span> Total annualized
          premium incepted from the 3rd to 27th month from the due month,
          divided by 24. Calculated on a rolling past-12-month basis.
        </p>
        <p>
          <span class="font-semibold">LAP (Net Lapse):</span> Lapsed premium
          minus reinstated premium in the month, rolling past-12-month total.
        </p>
        <p class="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
          New policies have a 3-month waiting period before their premium
          contributes to EXP.
        </p>
        <p>
          <span class="font-semibold">Excludes:</span> Healthshield policies.
        </p>
        <p class="text-gray-500">
          Updated monthly on the 3rd of the following month.
        </p>
      </div>
    ),
  },
  {
    id: "c19",
    shortName: "LIMRA-19",
    fullName: "LIMRA-19 (Case Count)",
    kind: "count",
    target: 85,
    tagline:
      "Measures the quality of Regular Premium policies over a moving 19-month window on a case count basis. Excludes Healthshield policies.",
    affects: ["Career Benefit"],
    formulaNote: () => (
      <div class="space-y-2 text-base text-gray-700">
        <p>
          <span class="font-semibold">Formula:</span> Persistency = 100 − (LAP ÷
          EXP × 100)
        </p>
        <p>
          <span class="font-semibold">Measurement window:</span> Moving 19-month
          window of new business previously issued by the agent.
        </p>
        <p>
          <span class="font-semibold">EXP / LAP:</span> Past-12-month case count
          basis.
        </p>
        <p>
          <span class="font-semibold">Excludes:</span> Healthshield policies.
        </p>
        <p class="rounded border border-blue-200 bg-blue-50 p-2 text-blue-800">
          Applies once you have 19 or more months of Qualifying Period. Replaces
          LIMRA-13 for career persistency purposes.
        </p>
        <p class="text-gray-500">
          Updated monthly on the 3rd of the following month.
        </p>
      </div>
    ),
  },
];

type OverviewCard = {
  fullName: string;
  target: number;
  targetLabel?: string;
  tagline: string;
  affects: string[];
};

const OVERVIEW_ONLY_CARDS: OverviewCard[] = [
  {
    fullName: "PA Persistency (Premium)",
    target: 85,
    tagline:
      "Measures the quality of PA policies being renewed on a premium basis.",
    affects: ["PA Production Bonus"],
  },
  {
    fullName: "Single Premium",
    target: 50,
    targetLabel: "50%",
    tagline:
      "Measures the quality of Single Premium policies over a moving 18-month window on a premium basis.",
    affects: ["Convention"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

const NumberInput: Component<{
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}> = (props) => (
  <label for={props.id} class="flex flex-col gap-1 text-base text-gray-600">
    <span class="font-medium">{props.label}</span>
    <input
      id={props.id}
      type="number"
      inputMode="decimal"
      min={props.min ?? 0}
      step={props.step ?? 1}
      value={props.value}
      onInput={(e) => {
        const next = e.currentTarget.valueAsNumber;
        props.onChange(Number.isNaN(next) ? 0 : clamp(next, props.min ?? 0));
      }}
      class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
    />
  </label>
);

// ─────────────────────────────────────────────────────────────────────────────
// Tab bar
// ─────────────────────────────────────────────────────────────────────────────

const _TabBar: Component = () => (
  <div class="sticky top-0 z-10 -mx-4 overflow-x-auto border-b border-gray-200 bg-white/95 px-4 backdrop-blur-sm">
    <div class="flex min-w-max gap-1 py-2">
      <button
        type="button"
        onClick={() => setActiveTab("overview")}
        class={`cursor-pointer rounded-lg px-3 py-1.5 text-base font-medium transition-colors ${
          activeTab() === "overview"
            ? "bg-primary text-white"
            : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        Overview
      </button>
      <For each={TABS}>
        {(tab) => (
          <button
            type="button"
            onClick={() => setActiveTab(tab.id)}
            class={`cursor-pointer rounded-lg px-3 py-1.5 text-base font-medium transition-colors ${
              activeTab() === tab.id
                ? "bg-primary text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.shortName}
          </button>
        )}
      </For>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Overview tab
// ─────────────────────────────────────────────────────────────────────────────

const _CollapsibleSection: Component<{
  title: string;
  defaultOpen?: boolean;
  children: JSX.Element;
}> = (props) => {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);
  return (
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left"
      >
        <h2 class="font-condensed text-xl font-bold text-gray-900">
          {props.title}
        </h2>
        <span
          class="ml-2 text-gray-400 transition-transform"
          style={{ transform: open() ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▾
        </span>
      </button>
      <Show when={open()}>
        <div class="border-t border-gray-100 px-5 pb-5 pt-4">
          {props.children}
        </div>
      </Show>
    </div>
  );
};

const _OverviewTab: Component = () => (
  <div class="space-y-6">
    <div>
      <h2 class="font-condensed mb-3 text-xl font-bold text-gray-900">
        Persistency Types
      </h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <For each={TABS}>
          {(tab) => (
            <div class="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div class="mb-2 flex items-start justify-between gap-1">
                <h3 class="font-condensed text-lg font-semibold text-gray-900">
                  {tab.fullName}
                </h3>
                <span
                  class={`rounded-full px-2 py-0.5 text-sm text-center ${
                    tab.target === 85
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  Target: {tab.targetLabel ?? `${tab.target}%`}
                </span>
              </div>
              <p class="mb-3 text-base text-gray-500">{tab.tagline}</p>
              <div class="mb-3 flex flex-wrap items-center gap-1.5">
                <span class="text-base font-medium text-gray-600">
                  Affects:
                </span>
                <For each={tab.affects}>
                  {(affect) => (
                    <span class="rounded-md bg-primary/10 px-2 py-0.5 text-base font-medium text-primary">
                      {affect}
                    </span>
                  )}
                </For>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab(tab.id)}
                class="mt-auto w-full cursor-pointer rounded-lg border border-primary px-3 py-1.5 text-base font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Open Calculator →
              </button>
            </div>
          )}
        </For>
        <For each={OVERVIEW_ONLY_CARDS}>
          {(card) => (
            <div class="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm">
              <div class="mb-2 flex items-start justify-between gap-1">
                <h3 class="font-condensed text-lg font-semibold text-gray-900">
                  {card.fullName}
                </h3>
                <span
                  class={`rounded-full px-2 py-0.5 text-sm text-center ${
                    card.target === 85
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  Target: {card.targetLabel ?? `${card.target}%`}
                </span>
              </div>
              <p class="mb-3 text-base text-gray-500">{card.tagline}</p>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-base font-medium text-gray-600">
                  Affects:
                </span>
                <For each={card.affects}>
                  {(affect) => (
                    <span class="rounded-md bg-primary/10 px-2 py-0.5 text-base font-medium text-primary">
                      {affect}
                    </span>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>

    <_CollapsibleSection title="What is persistency?">
      <p class="text-base text-blue-800">
        Persistency measures how well your policies stay in-force. A high
        persistency rate means fewer lapses — directly impacting your bonuses,
        contract maintenance, convention eligibility and clubs &amp; awards.
      </p>
    </_CollapsibleSection>

    <_CollapsibleSection title="Understanding EXP and LAP">
      <p class="mb-4 text-gray-600">
        Persistency is calculated from just two numbers — EXP and LAP. That's
        it.
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-lg bg-gray-50 p-4">
          <p class="mb-1 font-semibold text-gray-900">EXP — Exposure</p>
          <p class="text-gray-600">
            EXP is the total count of policies (or total premium) being tracked
            during the measurement period. It's your starting base.
          </p>
        </div>
        <div class="rounded-lg bg-gray-50 p-4">
          <p class="mb-1 font-semibold text-gray-900">LAP — Net Lapse</p>
          <p class="text-gray-600">
            LAP counts the policies that lapsed or were surrendered during the
            period, minus any that were reinstated. It's{" "}
            <span class="font-medium">gross lapses minus reinstatements</span>.
          </p>
        </div>
      </div>
      <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p class="mb-1 font-semibold text-amber-900">
          Why new cases barely move persistency
        </p>
        <p class="text-amber-800">
          New cases only enter EXP after a 3-month waiting period, and even then
          each case is a small addition to a large pool accumulated over the
          full measurement window. Writing more new business grows EXP slowly —
          it will not rescue a low persistency quickly.
        </p>
      </div>
      <div class="mt-3 rounded-lg border border-green-200 bg-green-50 p-4">
        <p class="mb-1 font-semibold text-green-900">
          The fastest way to improve persistency
        </p>
        <p class="text-green-800">
          Reinstate lapsed cases. Every reinstatement directly reduces LAP,
          which immediately improves your persistency in the very next monthly
          report. It is the single most effective lever you have.
        </p>
      </div>
    </_CollapsibleSection>

    <_CollapsibleSection title="Which Type Applies To You?">
      <div class="overflow-hidden rounded-lg border border-gray-200">
        <table class="w-full text-base">
          <thead>
            <tr class="border-b border-gray-200 bg-gray-50">
              <th class="px-4 py-2.5 text-left font-medium text-gray-700">
                Months of Service
              </th>
              <th class="px-4 py-2.5 text-left font-medium text-gray-700">
                Persistency Type Used
              </th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-gray-100">
              <td class="px-4 py-2.5 text-gray-600">Less than 13 months</td>
              <td class="px-4 py-2.5 italic text-gray-500">Not yet measured</td>
            </tr>
            <tr class="border-b border-gray-100">
              <td class="px-4 py-2.5 text-gray-600">13 – 18 months</td>
              <td class="px-4 py-2.5 font-medium text-gray-900">
                LIMRA-13 (by premium)
              </td>
            </tr>
            <tr class="border-b border-gray-100">
              <td class="px-4 py-2.5 text-gray-600">19 – 23 months</td>
              <td class="px-4 py-2.5 font-medium text-gray-900">
                LIMRA-19 (by premium)
              </td>
            </tr>
            <tr class="border-b border-gray-100">
              <td class="px-4 py-2.5 text-gray-600">24 months and above</td>
              <td class="px-4 py-2.5 font-medium text-gray-900">
                24-Month (by premium)
              </td>
            </tr>
            <tr>
              <td class="px-4 py-2.5 italic text-gray-500" colSpan={2}>
                SP and PA persistency apply separately regardless of service
                length
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </_CollapsibleSection>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Calculator tab (shared for all 4 types)
// ─────────────────────────────────────────────────────────────────────────────

type CalculatorTabProps = {
  tab: TabDef;
  exp: number;
  lap: number;
  onExpChange: (v: number) => void;
  onLapChange: (v: number) => void;
  stats: PersistencyStats;
  exp1: number;
  exp2: number;
  exp3: number;
  fLap: number;
  onExp1Change: (v: number) => void;
  onExp2Change: (v: number) => void;
  onExp3Change: (v: number) => void;
  onFLapChange: (v: number) => void;
  forecast: ForecastStats;
};

const _CalculatorTab: Component<CalculatorTabProps> = (props) => {
  const atTarget = () => props.stats.persistencyPct >= props.tab.target;
  const fAtTarget = () => props.forecast.persistencyPct >= props.tab.target;
  const unit = () => (props.tab.kind === "count" ? "cases" : "premium");
  const step = () => (props.tab.kind === "count" ? 1 : 10);
  const pfx = props.tab.id;

  return (
    <div class="space-y-5">
      {/* Where to find numbers */}
      <details class="group rounded-xl border border-gray-200 bg-white shadow-sm">
        <summary class="flex cursor-pointer list-none items-center justify-between p-5">
          <p class="font-condensed text-lg font-semibold text-gray-900">
            Where to Find Your Numbers
          </p>
          <span class="rounded-full border border-gray-200 px-2 py-1 text-base text-gray-500 group-open:bg-gray-100">
            Expand
          </span>
        </summary>
        <div class="border-t border-gray-100 p-5">
          <p class="text-gray-700">
            Go to <span class="font-bold">iSmart</span>
            <span>
              {" "}
              (use web portal version https://ismart.aia.com.sg on iPad or
              Desktop for full view, not mobile app) →{" "}
              <span class="font-bold">
                Performance → Performance Tracking → Key Metrics → Persistency
                Overview
              </span>
            </span>{" "}
            to see your latest persistency.
          </p>
          <p class="mt-2 text-gray-700">
            Open each individual persistency screen and look under{" "}
            <span class="font-medium">Past 12 Months</span> for your EXP and LAP
            values.
          </p>
        </div>
      </details>

      {/* Monthly calculator */}
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 class="font-condensed mb-4 text-lg font-semibold text-gray-900">
          Monthly Calculator
        </h3>
        <p class="mb-3 text-base text-gray-500">
          Enter the rolling past-12-month EXP and LAP from your monthly report.
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <NumberInput
            id={`${pfx}-exp`}
            label={`Past-12M Exposure (EXP, ${unit()})`}
            value={props.exp}
            onChange={props.onExpChange}
            min={0}
            step={step()}
          />
          <NumberInput
            id={`${pfx}-lap`}
            label={`Past-12M Net Lapse (LAP, ${unit()})`}
            value={props.lap}
            onChange={props.onLapChange}
            min={0}
            step={step()}
          />
        </div>

        {/* Big result */}
        <div class="mt-5 flex flex-col items-center rounded-xl bg-gray-50 py-6">
          <p
            class={`text-6xl font-bold tracking-tight ${atTarget() ? "text-green-600" : "text-red-500"}`}
          >
            {formatPercent(props.stats.persistencyPct)}
          </p>
          <p
            class={`mt-1.5 text-base font-medium ${atTarget() ? "text-green-700" : "text-red-600"}`}
          >
            {atTarget()
              ? `At or above ${props.tab.target}% target`
              : `Below ${props.tab.target}% target — action needed`}
          </p>
        </div>

        {/* Stats grid */}
        <div class="mt-4 grid grid-cols-2 gap-2 text-base">
          <div class="rounded-lg bg-gray-50 p-3">
            <p class="mb-0.5 text-base text-gray-500">Inforce (EXP − LAP)</p>
            <p class="font-semibold text-gray-900">
              {formatValue(props.tab.kind, props.stats.inforce)}
            </p>
          </div>
          <div class="rounded-lg bg-gray-50 p-3">
            <p class="mb-0.5 text-base text-gray-500">
              Max LAP at {props.tab.target}%
            </p>
            <p class="font-semibold text-gray-900">
              {formatValue(props.tab.kind, props.stats.maxLapAtTarget)} {unit()}
            </p>
          </div>
          <Show when={!atTarget()}>
            <div class="rounded-lg bg-red-50 p-3">
              <p class="mb-0.5 text-base text-red-600">LAP Reduction Needed</p>
              <p class="font-semibold text-red-700">
                {formatValue(props.tab.kind, props.stats.lapReductionRequired)}{" "}
                {unit()}
              </p>
            </div>
            <div class="rounded-lg bg-green-50 p-3">
              <p class="mb-0.5 text-base text-green-600">
                Reinstatements Needed
              </p>
              <p class="font-semibold text-green-700">
                {formatValue(
                  props.tab.kind,
                  props.stats.reinstatementsRequired,
                  { roundUp: props.tab.kind === "count" },
                )}{" "}
                {unit()}
              </p>
            </div>
          </Show>
        </div>

        <Show when={!atTarget()}>
          <div class="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-base text-green-900">
            Prioritise reinstatements — each one lowers LAP and improves
            persistency immediately in the next monthly report.
          </div>
        </Show>
      </div>

      {/* 3-Month Forecast */}
      <details class="group rounded-xl border border-gray-200 bg-white shadow-sm">
        <summary class="flex cursor-pointer list-none items-center justify-between p-5">
          <div>
            <p class="font-condensed text-lg font-semibold text-gray-900">
              3-Month Forecast
            </p>
            <p class="text-base text-gray-500">
              Estimate next 3 months using past EXP and current LAP
            </p>
          </div>
          <span class="rounded-full border border-gray-200 px-2 py-1 text-base text-gray-500 group-open:bg-gray-100">
            Expand
          </span>
        </summary>
        <div class="space-y-4 border-t border-gray-100 p-5">
          <p class="text-base text-gray-500">
            Assumes next 3 months EXP equals the average of the past 3 months,
            with LAP held constant.
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <NumberInput
              id={`${pfx}-fexp1`}
              label="Past EXP — Month 1"
              value={props.exp1}
              onChange={props.onExp1Change}
              min={0}
              step={step()}
            />
            <NumberInput
              id={`${pfx}-fexp2`}
              label="Past EXP — Month 2"
              value={props.exp2}
              onChange={props.onExp2Change}
              min={0}
              step={step()}
            />
            <NumberInput
              id={`${pfx}-fexp3`}
              label="Past EXP — Month 3"
              value={props.exp3}
              onChange={props.onExp3Change}
              min={0}
              step={step()}
            />
            <NumberInput
              id={`${pfx}-flap`}
              label="Current LAP (upcoming month)"
              value={props.fLap}
              onChange={props.onFLapChange}
              min={0}
              step={step()}
            />
          </div>

          <div class="flex flex-col items-center rounded-xl bg-gray-50 py-5">
            <p
              class={`text-4xl font-bold ${fAtTarget() ? "text-green-600" : "text-red-500"}`}
            >
              {formatPercent(props.forecast.persistencyPct)}
            </p>
            <p class="mt-0.5 text-base text-gray-500">
              Projected persistency (next 3 months)
            </p>
          </div>

          <div class="grid grid-cols-2 gap-2 text-base">
            <div class="rounded-lg bg-gray-50 p-3">
              <p class="mb-0.5 text-base text-gray-500">Avg EXP (3 months)</p>
              <p class="font-semibold text-gray-900">
                {formatValue(props.tab.kind, props.forecast.averageExp)}{" "}
                {unit()}
              </p>
            </div>
            <div class="rounded-lg bg-gray-50 p-3">
              <p class="mb-0.5 text-base text-gray-500">
                Max LAP at {props.tab.target}%
              </p>
              <p class="font-semibold text-gray-900">
                {formatValue(props.tab.kind, props.forecast.maxLapAtTarget)}{" "}
                {unit()}
              </p>
            </div>
            <Show when={!fAtTarget()}>
              <div class="rounded-lg bg-red-50 p-3">
                <p class="mb-0.5 text-base text-red-600">
                  LAP Drop Needed (3 months)
                </p>
                <p class="font-semibold text-red-700">
                  {formatValue(
                    props.tab.kind,
                    props.forecast.lapReductionThreeMonths,
                  )}{" "}
                  {unit()}
                </p>
              </div>
              <div class="rounded-lg bg-green-50 p-3">
                <p class="mb-0.5 text-base text-green-600">
                  Reinstatements (3 months)
                </p>
                <p class="font-semibold text-green-700">
                  {formatValue(
                    props.tab.kind,
                    props.forecast.reinstatementsThreeMonths,
                    { roundUp: props.tab.kind === "count" },
                  )}{" "}
                  {unit()}
                </p>
              </div>
            </Show>
          </div>
        </div>
      </details>

      {/* Formula & Details */}
      <details class="group rounded-xl border border-gray-200 bg-white shadow-sm">
        <summary class="flex cursor-pointer list-none items-center justify-between p-5">
          <p class="font-condensed text-lg font-semibold text-gray-900">
            Formula &amp; Details
          </p>
          <span class="rounded-full border border-gray-200 px-2 py-1 text-base text-gray-500 group-open:bg-gray-100">
            Expand
          </span>
        </summary>
        <div class="border-t border-gray-100 p-5">
          {props.tab.formulaNote()}
        </div>
      </details>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const Persistency: Component = () => {
  const navigate = useNavigate();
  const showBackButton = !hasSharedToolQuery(SHARED_QUERY_KEYS);

  // 24-Month Premium
  const [p24Exp, setP24Exp] = createSignal(10000);
  const [p24Lap, setP24Lap] = createSignal(1500);
  const [e24Exp1, setE24Exp1] = createSignal(9000);
  const [e24Exp2, setE24Exp2] = createSignal(10000);
  const [e24Exp3, setE24Exp3] = createSignal(11000);
  const [e24Lap, setE24Lap] = createSignal(1800);

  // LIMRA-19
  const [c19Exp, setC19Exp] = createSignal(100);
  const [c19Lap, setC19Lap] = createSignal(15);
  const [e19Exp1, setE19Exp1] = createSignal(100);
  const [e19Exp2, setE19Exp2] = createSignal(110);
  const [e19Exp3, setE19Exp3] = createSignal(120);
  const [e19Lap, setE19Lap] = createSignal(18);

  // Computed stats
  const p24Stats = createMemo(() =>
    calculatePersistency(p24Exp(), p24Lap(), "premium", 85),
  );
  const c19Stats = createMemo(() =>
    calculatePersistency(c19Exp(), c19Lap(), "count", 85),
  );
  const e24Forecast = createMemo(() =>
    estimateNextThreeMonths(
      [e24Exp1(), e24Exp2(), e24Exp3()],
      e24Lap(),
      "premium",
      85,
    ),
  );
  const e19Forecast = createMemo(() =>
    estimateNextThreeMonths(
      [e19Exp1(), e19Exp2(), e19Exp3()],
      e19Lap(),
      "count",
      85,
    ),
  );
  const initFromUrlParams = () => {
    const params = new URL(window.location.href).searchParams;
    const applyParam = (
      key: (typeof SHARED_QUERY_KEYS)[number],
      setter: (value: number) => void,
    ) => {
      const parsed = parseParamNumber(params, key);
      if (parsed !== null) setter(clamp(parsed));
    };

    applyParam("c19exp", setC19Exp);
    applyParam("c19lap", setC19Lap);
    applyParam("p24exp", setP24Exp);
    applyParam("p24lap", setP24Lap);
    applyParam("e19exp1", setE19Exp1);
    applyParam("e19exp2", setE19Exp2);
    applyParam("e19exp3", setE19Exp3);
    applyParam("e19lap", setE19Lap);
    applyParam("e24exp1", setE24Exp1);
    applyParam("e24exp2", setE24Exp2);
    applyParam("e24exp3", setE24Exp3);
    applyParam("e24lap", setE24Lap);
  };

  onMount(initFromUrlParams);

  return (
    <PageShell>
      <PageHeader
        onBack={showBackButton ? () => navigate(-1) : undefined}
        icon={
          <Dynamic
            component={dashboardOptions.persistency.icon}
            class="h-5 w-5"
          />
        }
        title={dashboardOptions.persistency.title}
        subtitle={dashboardOptions.persistency.description}
      />

      <PageBody>
        <div class="space-y-4 pb-12">
          <_TabBar />

          <Switch>
            <Match when={activeTab() === "overview"}>
              <_OverviewTab />
            </Match>
            <Match when={activeTab() === "p24"}>
              <_CalculatorTab
                tab={TABS.find((t) => t.id === "p24")!}
                exp={p24Exp()}
                lap={p24Lap()}
                onExpChange={setP24Exp}
                onLapChange={setP24Lap}
                stats={p24Stats()}
                exp1={e24Exp1()}
                exp2={e24Exp2()}
                exp3={e24Exp3()}
                fLap={e24Lap()}
                onExp1Change={setE24Exp1}
                onExp2Change={setE24Exp2}
                onExp3Change={setE24Exp3}
                onFLapChange={setE24Lap}
                forecast={e24Forecast()}
              />
            </Match>
            <Match when={activeTab() === "c19"}>
              <_CalculatorTab
                tab={TABS.find((t) => t.id === "c19")!}
                exp={c19Exp()}
                lap={c19Lap()}
                onExpChange={setC19Exp}
                onLapChange={setC19Lap}
                stats={c19Stats()}
                exp1={e19Exp1()}
                exp2={e19Exp2()}
                exp3={e19Exp3()}
                fLap={e19Lap()}
                onExp1Change={setE19Exp1}
                onExp2Change={setE19Exp2}
                onExp3Change={setE19Exp3}
                onFLapChange={setE19Lap}
                forecast={e19Forecast()}
              />
            </Match>
          </Switch>
        </div>
      </PageBody>
    </PageShell>
  );
};

export default Persistency;
