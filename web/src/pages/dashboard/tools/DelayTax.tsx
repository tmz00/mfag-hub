import {
  Component,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { TbOutlineCheck, TbOutlineShare2 } from "solid-icons/tb";
import { PageShell, PageHeader, PageBody } from "../../../components/ui";
import { formatCurrency, formatYears } from "../../../utils/helpers";
import { dashboardOptions } from "../dashboardOptions";
import { hasSharedToolQuery } from "./_sharedLink";

type ContributionFrequency = "monthly" | "yearly";

const [initialInvestment, setInitialInvestment] = createSignal(10000);
const [contribution, setContribution] = createSignal(500);
const [contributionFrequency, setContributionFrequency] =
  createSignal<ContributionFrequency>("monthly");
const [annualReturn, setAnnualReturn] = createSignal(8);
const [investmentYears, setInvestmentYears] = createSignal(25);
const [yearsToWait, setYearsToWait] = createSignal(5);

const clamp = (val: number, min: number, max: number) =>
  Math.min(max, Math.max(min, val));

const computedValues = () => {
  const yearsUntilRetirement = investmentYears();

  if (yearsUntilRetirement <= 0 || yearsToWait() > yearsUntilRetirement) {
    return {
      startNowValue: 0,
      startLaterValue: 0,
      costOfWaiting: 0,
      yearsUntilRetirement,
      canRetire: false,
      startNowSeries: [] as number[],
      startLaterSeries: [] as number[],
      maxValue: 0,
    };
  }

  const yearlyRate = annualReturn() / 100;
  const annualContribution =
    contributionFrequency() === "monthly"
      ? contribution() * 12
      : contribution();

  const buildSeries = (waitYears: number) => {
    const startCapital = initialInvestment();
    let investBalance = waitYears === 0 ? startCapital : 0;
    const series: number[] = [startCapital];

    for (let year = 1; year <= yearsUntilRetirement; year++) {
      if (year === waitYears + 1 && waitYears > 0 && startCapital > 0) {
        investBalance += startCapital;
      }
      if (year > waitYears) {
        investBalance += annualContribution;
        investBalance *= 1 + yearlyRate;
        series.push(investBalance);
      } else {
        series.push(startCapital);
      }
    }
    return series;
  };

  const startNowSeries = buildSeries(0);
  const startLaterSeries = buildSeries(yearsToWait());
  const startNowValue = startNowSeries[startNowSeries.length - 1] ?? 0;
  const startLaterValue = startLaterSeries[startLaterSeries.length - 1] ?? 0;
  const costOfWaiting = startNowValue - startLaterValue;
  const maxValue = Math.max(...startNowSeries, ...startLaterSeries, 1);

  return {
    startNowValue,
    startLaterValue,
    costOfWaiting,
    yearsUntilRetirement,
    canRetire: true,
    startNowSeries,
    startLaterSeries,
    maxValue,
  };
};

const initFromUrlParams = () => {
  const params = new URL(window.location.href).searchParams;
  const setNumber = (key: string, setter: (value: number) => void) => {
    const value = params.get(key);
    if (value !== null && !Number.isNaN(Number(value))) {
      setter(Number(value));
    }
  };

  setNumber("years", (v) => setInvestmentYears(Math.max(2, Math.min(60, v))));
  const contributionParam = params.get("contribution") ?? params.get("monthly");
  if (contributionParam && !Number.isNaN(Number(contributionParam))) {
    setContribution(Math.max(0, Number(contributionParam)));
  }
  const initialParam = params.get("initial");
  if (initialParam && !Number.isNaN(Number(initialParam))) {
    setInitialInvestment(Math.max(0, Number(initialParam)));
  }
  setNumber("return", (v) => setAnnualReturn(Math.max(0.5, Math.min(25, v))));
  setNumber("wait", (v) =>
    setYearsToWait(Math.max(1, Math.min(40, v))),
  );
  const freq = params.get("freq");
  if (freq === "yearly" || freq === "monthly") setContributionFrequency(freq);
};

const DelayTax: Component = () => {
  const navigate = useNavigate();
  const showBackButton = !hasSharedToolQuery([
    "years",
    "initial",
    "contribution",
    "monthly",
    "return",
    "wait",
    "freq",
  ]);
  onMount(initFromUrlParams);

  return (
    <PageShell>
      <PageHeader
        onBack={showBackButton ? () => navigate(-1) : undefined}
        icon={
          <Dynamic component={dashboardOptions.delayTax.icon} class="h-5 w-5" />
        }
        title={dashboardOptions.delayTax.title}
        subtitle={dashboardOptions.delayTax.description}
      />

      <PageBody><div class="pb-10">
        <div class="space-y-6">
          <_Inputs />
          <_ResultSummary />
        </div>

        <div class="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h4 class="font-semibold text-blue-900">Why Time Matters</h4>
          <p class="mt-2 text-base text-blue-700">
            The power of compounding returns means that even small delays can
            have a significant impact on your long-term savings. Starting early
            gives your money more time to grow exponentially. This calculator
            demonstrates the real cost of procrastination in financial planning.
          </p>
        </div>
      </div></PageBody>

      <_ShareButton />
    </PageShell>
  );
};

/*******************************
 *
 * BEGIN all subcomponents below
 *
 *******************************/

const _InlineInput: Component<{
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  width?: string;
  accentClass?: string;
}> = (props) => {
  const [raw, setRaw] = createSignal(String(props.value));
  const syncRaw = () => setRaw(String(props.value));

  const displayWidth = () =>
    props.width ?? `${Math.max(2, String(props.value).length + 1)}ch`;

  return (
    <span
      class={`inline-flex items-baseline font-bold ${props.accentClass ?? "text-primary"}`}
    >
      {props.prefix && <span>{props.prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        id={props.id}
        value={raw()}
        onFocus={(e) => e.currentTarget.select()}
        onInput={(e) => {
          const text = e.currentTarget.value;
          setRaw(text);
          const num = Number(text);
          if (!Number.isNaN(num) && text !== "") {
            props.onChange(num);
          }
        }}
        onBlur={() => {
          const num = Number(raw());
          if (Number.isNaN(num) || raw() === "") {
            syncRaw();
          } else {
            const clamped = clamp(num, props.min, props.max);
            props.onChange(clamped);
            setRaw(String(clamped));
          }
        }}
        class={`border-b-2 border-current/30 bg-transparent px-0.5 text-center font-bold focus:border-current focus:outline-none ${props.accentClass ?? "text-primary"}`}
        style={{ width: displayWidth() }}
      />
      {props.suffix && <span>{props.suffix}</span>}
    </span>
  );
};

const _FreqToggle: Component = () => {
  const MONTHLY_MAX = 50000;
  const YEARLY_MAX = 600000;

  const toggle = () => {
    const next = contributionFrequency() === "monthly" ? "yearly" : "monthly";
    setContributionFrequency(next);
    const max = next === "monthly" ? MONTHLY_MAX : YEARLY_MAX;
    if (contribution() > max) setContribution(max);
  };

  return (
    <button
      type="button"
      class="border-b-2 border-primary/30 font-bold text-primary focus:border-primary focus:outline-none"
      onClick={toggle}
    >
      {contributionFrequency() === "monthly" ? "month" : "year"}
    </button>
  );
};

const _Inputs: Component = () => {
  return (
    <div class="rounded-lg border border-gray-100 bg-white/90 px-5 py-4 shadow-sm">
      <div class="space-y-6 text-base text-gray-700">
        <p class="space-y-2">
          I have{" "}
          <_InlineInput
            id="initialInvestment"
            value={initialInvestment()}
            min={0}
            max={10000000}
            onChange={setInitialInvestment}
            prefix="$"
            width="7ch"
          />{" "}
          to start with, and I can contribute additional{" "}
          <_InlineInput
            id="contribution"
            value={contribution()}
            min={0}
            max={contributionFrequency() === "monthly" ? 50000 : 600000}
            onChange={setContribution}
            prefix="$"
            width="7ch"
          />{" "}
          per <_FreqToggle />.
        </p>
        <p class="space-y-2">
          At{" "}
          <_InlineInput
            id="annualReturn"
            value={annualReturn()}
            min={0.5}
            max={15}
            onChange={setAnnualReturn}
            suffix="%"
            width="3ch"
          />{" "}
          projected annual rate of return, over{" "}
          <_InlineInput
            id="investmentYears"
            value={investmentYears()}
            min={2}
            max={60}
            onChange={setInvestmentYears}
            suffix=" years"
            width="4ch"
          />
          .
        </p>

        <p class="space-y-2 font-medium text-red-600">
          However, I want to wait{" "}
          <_InlineInput
            id="yearsToWait"
            value={yearsToWait()}
            min={1}
            max={25}
            onChange={setYearsToWait}
            accentClass="text-red-600"
          />{" "}
          {yearsToWait() === 1 ? "year" : "years"} before starting.
        </p>
      </div>
    </div>
  );
};

const _ResultSummary: Component = () => {
  const data = createMemo(() => computedValues());

  return (
    <Show
      when={data().canRetire}
      fallback={
        <div class="rounded bg-yellow-50/70 p-3 text-center text-base text-yellow-700">
          Investment years must be greater than wait years
        </div>
      }
    >
      <div class="md:hidden">
        <div class="mb-0 grid grid-cols-2">
          <div class="rounded-tl-lg border-2 border-green-200 bg-green-50 p-4 text-center">
            <div class="mb-2 flex items-center justify-center gap-2 text-base">
              <p class="font-semibold text-green-900">Start Now</p>
            </div>
            <p class="text-sm text-green-700">You could have</p>
            <p class="text-xl font-bold text-green-600">
              {formatCurrency(data().startNowValue)}
            </p>
            <p class="text-sm text-green-700">
              After {formatYears(investmentYears())}
            </p>
          </div>

          <div class="rounded-tr-lg border-2 border-yellow-200 bg-yellow-50 p-4 text-center">
            <div class="mb-2 flex items-center justify-center gap-2 text-base">
              <p class="text-base font-semibold text-yellow-900">
                Wait {formatYears(yearsToWait())}
              </p>
            </div>
            <p class="text-sm text-yellow-700">You could have</p>
            <p class="text-xl font-bold text-yellow-600">
              {formatCurrency(data().startLaterValue)}
            </p>
            <p class="text-sm text-yellow-700">
              After {formatYears(investmentYears())}
            </p>
          </div>
        </div>

        <div class="rounded-b-lg border-2 border-red-200 bg-linear-to-br from-red-50 to-red-100 p-6 text-center">
          <p class="mb-1 text-base font-medium text-red-700">
            Your {formatYears(yearsToWait())} Delay Tax
          </p>
          <p class="text-4xl font-bold text-red-600">
            {formatCurrency(data().costOfWaiting)}
          </p>
        </div>
      </div>

      <div class="relative">
        <_Chart />
        <div class="pointer-events-none absolute left-4 top-4 z-10 hidden w-[300px] md:block">
          <div class="mb-0 grid grid-cols-2">
            <div class="rounded-tl-lg border-2 border-green-200 bg-green-50 p-4 text-center">
              <div class="mb-2 flex items-center justify-center gap-2 text-base">
                <p class="font-semibold text-green-900">Start Now</p>
              </div>
              <p class="text-sm text-green-700">You could have</p>
              <p class="text-xl font-bold text-green-600">
                {formatCurrency(data().startNowValue)}
              </p>
              <p class="text-sm text-green-700">
                After {formatYears(investmentYears())}
              </p>
            </div>

            <div class="rounded-tr-lg border-2 border-yellow-200 bg-yellow-50 p-4 text-center">
              <div class="mb-2 flex items-center justify-center gap-2 text-base">
                <p class="text-base font-semibold text-yellow-900">
                  Wait {formatYears(yearsToWait())}
                </p>
              </div>
              <p class="text-sm text-yellow-700">You could have</p>
              <p class="text-xl font-bold text-yellow-600">
                {formatCurrency(data().startLaterValue)}
              </p>
              <p class="text-sm text-yellow-700">
                After {formatYears(investmentYears())}
              </p>
            </div>
          </div>

          <div class="rounded-b-lg border-2 border-red-200 bg-linear-to-br from-red-50 to-red-100 p-6 text-center">
            <p class="mb-1 text-base font-medium text-red-700">
              Your {formatYears(yearsToWait())} Delay Tax
            </p>
            <p class="text-4xl font-bold text-red-600">
              {formatCurrency(data().costOfWaiting)}
            </p>
          </div>
        </div>
      </div>
    </Show>
  );
};

const _Chart: Component = () => {
  const [chartContainerRef, setChartContainerRef] = createSignal<
    HTMLDivElement | undefined
  >();
  const [chartRef, setChartRef] = createSignal<SVGSVGElement | undefined>();
  const [hoverIndex, setHoverIndex] = createSignal<number | null>(null);
  const [chartWidthPx, setChartWidthPx] = createSignal(320);

  const chartData = createMemo(() => {
    const data = computedValues();
    if (!data.canRetire) {
      return {
        startNowPath: "",
        startLaterPath: "",
        diffPath: "",
        startNowSeries: [] as number[],
        startLaterSeries: [] as number[],
        width: 320,
        height: 180,
        paddingX: 0,
        paddingY: 0,
        chartWidth: 260,
        chartHeight: 148,
        maxValue: 0,
      };
    }

    const startNowSeries = data.startNowSeries;
    const startLaterSeries = data.startLaterSeries;
    const maxValue = data.maxValue;

    const width = Math.max(260, chartWidthPx());
    const height = Math.max(180, Math.round(width * 0.56));
    const paddingX = 0;
    const paddingY = 0;
    const chartWidth = width - paddingX * 2;
    const chartHeight = height - paddingY * 2;

    const toPoints = (series: number[]) => {
      if (series.length === 0) return [];
      return series.map((value, idx) => {
        const x =
          paddingX +
          (series.length === 1
            ? chartWidth / 2
            : (idx / (series.length - 1)) * chartWidth);
        const y = paddingY + (1 - value / maxValue) * chartHeight;
        return { x, y };
      });
    };

    const toPath = (points: { x: number; y: number }[]) =>
      points.length === 0
        ? ""
        : points
            .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`)
            .join(" ");

    const startNowPoints = toPoints(startNowSeries);
    const startLaterPoints = toPoints(startLaterSeries);

    const diffPath =
      startNowPoints.length === startLaterPoints.length &&
      startNowPoints.length > 1
        ? [
            ...startNowPoints.map(
              (p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`,
            ),
            ...[...startLaterPoints].reverse().map((p) => `L ${p.x} ${p.y}`),
            "Z",
          ].join(" ")
        : "";

    return {
      startNowPath: toPath(startNowPoints),
      startLaterPath: toPath(startLaterPoints),
      diffPath,
      startNowSeries,
      startLaterSeries,
      width,
      height,
      paddingX,
      paddingY,
      chartWidth,
      chartHeight,
      maxValue,
    };
  });

  const hoverState = createMemo(() => {
    const idx = hoverIndex();
    const data = chartData();
    const len = data.startNowSeries.length;
    if (idx === null || len === 0) return null;
    const clamped = Math.max(0, Math.min(len - 1, idx));
    const x =
      data.paddingX +
      (len === 1
        ? data.chartWidth / 2
        : (clamped / (len - 1)) * data.chartWidth);
    const max = data.maxValue || 1;
    const yNow =
      data.paddingY +
      (1 - data.startNowSeries[clamped] / max) * data.chartHeight;
    const yLater =
      data.paddingY +
      (1 - data.startLaterSeries[clamped] / max) * data.chartHeight;
    return {
      year: clamped,
      startNow: data.startNowSeries[clamped],
      startLater: data.startLaterSeries[clamped],
      x,
      yNow,
      yLater,
    };
  });

  const handlePointerPosition = (clientX: number, target: SVGSVGElement) => {
    const data = chartData();
    if (!data.startNowSeries.length) return;
    const rect = target.getBoundingClientRect();
    const relativeX = clientX - rect.left - data.paddingX;
    const ratio = relativeX / data.chartWidth;
    const idx = Math.round(ratio * (data.startNowSeries.length - 1));
    setHoverIndex(idx);
  };

  onMount(() => {
    const container = chartContainerRef();
    if (typeof ResizeObserver !== "undefined" && container) {
      setChartWidthPx(container.getBoundingClientRect().width);
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width) {
            setChartWidthPx(entry.contentRect.width);
          }
        }
      });
      resizeObserver.observe(container);
      onCleanup(() => resizeObserver.disconnect());
    }

    const handleOutsideTap = (e: PointerEvent) => {
      const svg = chartRef();
      if (svg && e.target instanceof Node && svg.contains(e.target)) return;
      setHoverIndex(null);
    };
    window.addEventListener("pointerdown", handleOutsideTap);
    onCleanup(() =>
      window.removeEventListener("pointerdown", handleOutsideTap),
    );
  });

  return (
    <div class="rounded-lg border border-gray-100 bg-white/90 p-4 shadow-sm">
      <div
        id="delay-tax-chart"
        class="overflow-hidden"
        aria-hidden="false"
        style={{
          transition: "max-height 300ms ease, opacity 300ms ease",
          "max-height": `${chartData().height + 160}px`,
          opacity: "1",
          "pointer-events": "auto",
        }}
      >
        <div ref={setChartContainerRef} class="mx-auto w-full max-w-[768px]">
          <Show
            when={chartData().startNowPath || chartData().startLaterPath}
            fallback={
              <p class="text-sm text-gray-600">
                Add valid ages to view the chart.
              </p>
            }
          >
            <svg
              width={chartData().width}
              height={chartData().height}
              viewBox={`0 0 ${chartData().width} ${chartData().height}`}
              class="w-full"
              ref={setChartRef}
              style={{ "touch-action": "pan-y pinch-zoom" }}
              onPointerDown={(e) =>
                handlePointerPosition(e.clientX, e.currentTarget)
              }
              onPointerMove={(e) => {
                if (e.pressure === 0 && e.pointerType === "mouse") return;
                handlePointerPosition(e.clientX, e.currentTarget);
              }}
            >
              <line
                x1={chartData().paddingX}
                x2={chartData().width - chartData().paddingX}
                y1={chartData().height - chartData().paddingY}
                y2={chartData().height - chartData().paddingY}
                stroke="#e5e7eb"
                stroke-width="1"
              />
              <line
                x1={chartData().paddingX}
                x2={chartData().paddingX}
                y1={chartData().paddingY}
                y2={chartData().height - chartData().paddingY}
                stroke="#e5e7eb"
                stroke-width="1"
              />

              {chartData().diffPath && (
                <path
                  d={chartData().diffPath}
                  fill="rgba(239,68,68,0.25)"
                  stroke="none"
                />
              )}

              {chartData().startLaterPath && (
                <path
                  d={chartData().startLaterPath}
                  fill="none"
                  stroke="#eab308"
                  stroke-width="2"
                />
              )}

              {chartData().startNowPath && (
                <path
                  d={chartData().startNowPath}
                  fill="none"
                  stroke="#22c55e"
                  stroke-width="2"
                />
              )}

              <Show when={hoverState()}>
                {(state) => (
                  <>
                    <line
                      x1={state().x}
                      x2={state().x}
                      y1={chartData().paddingY}
                      y2={chartData().height - chartData().paddingY}
                      stroke="#94a3b8"
                      stroke-dasharray="4 2"
                      stroke-width="1"
                    />
                    <circle
                      cx={state().x}
                      cy={state().yLater}
                      r="3"
                      fill="#f97316"
                    />
                    <circle
                      cx={state().x}
                      cy={state().yNow}
                      r="3"
                      fill="#22c55e"
                    />
                  </>
                )}
              </Show>
            </svg>
            <div class="flex items-center justify-between text-sm text-gray-600">
              <span>Year 0</span>
              <Show when={hoverState()}>
                {(state) => (
                  <span class="font-semibold">Year {state().year}</span>
                )}
              </Show>
              <span>Year {investmentYears()}</span>
            </div>
          </Show>

          <Show when={hoverState()}>
            {(state) => (
              <div class="px-6 text-center text-sm text-gray-700">
                <div class="items-center justify-between gap-1 font-semibold">
                  <span class="text-green-500">
                    Start Now ({formatCurrency(state().startNow)})
                  </span>{" "}
                  <br />
                  <span class="text-yellow-500">
                    Wait {formatYears(yearsToWait())} (
                    {formatCurrency(state().startLater)})
                  </span>
                  <br />
                  <span class="text-red-500">
                    Delay Tax (
                    {formatCurrency(state().startNow - state().startLater)})
                  </span>
                </div>
              </div>
            )}
          </Show>
          <div class="mt-4 text-center">
            <h4 class="text-base font-semibold text-gray-900">
              Growth Over Time
            </h4>
            <p class="text-sm text-black-500">
              Tap or drag on the chart to inspect values.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const _ShareButton: Component = () => {
  const [linkCopied, setLinkCopied] = createSignal(false);

  const generateShareLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("years", investmentYears().toString());
    url.searchParams.set("initial", initialInvestment().toString());
    url.searchParams.set("contribution", contribution().toString());
    url.searchParams.set("return", annualReturn().toString());
    url.searchParams.set("wait", yearsToWait().toString());
    url.searchParams.set("freq", contributionFrequency());

    const shareUrl = url.toString();

    try {
      if (navigator.share) {
        await navigator.share({
          url: shareUrl,
          title: "The Delay Tax",
          text: "See what waiting costs you - calculate the price of procrastination",
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={generateShareLink}
      class="fixed bottom-6 right-6 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all hover:bg-primary/90 hover:shadow-xl active:scale-95"
    >
      <Show when={linkCopied()} fallback={<TbOutlineShare2 class="h-6 w-6" />}>
        <TbOutlineCheck class="h-6 w-6" />
      </Show>
    </button>
  );
};

export default DelayTax;
