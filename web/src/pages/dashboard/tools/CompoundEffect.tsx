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
import {
  TbOutlineCheck,
  TbOutlineShare2,
  TbOutlineTrendingUp,
} from "solid-icons/tb";
import { PageShell, PageHeader, PageBody } from "../../../components/ui";
import { formatCurrency, formatYears } from "../../../utils/helpers";
import { dashboardOptions } from "../dashboardOptions";
import { hasSharedToolQuery } from "./_sharedLink";

type ContributionFrequency = "monthly" | "yearly";

const [initialAmount, setInitialAmount] = createSignal(10000);
const [contribution, setContribution] = createSignal(500);
const [contributionFrequency, setContributionFrequency] =
  createSignal<ContributionFrequency>("monthly");
const [annualReturn, setAnnualReturn] = createSignal(8);
const [years, setYears] = createSignal(20);

const clamp = (val: number, min: number, max: number) =>
  Math.min(max, Math.max(min, val));

interface YearlyBreakdown {
  year: number;
  balance: number;
  totalContributions: number;
}

const computedValues = () => {
  const monthlyRate = annualReturn() / 100 / 12;
  const months = years() * 12;
  const monthlyContribution =
    contributionFrequency() === "monthly"
      ? contribution()
      : contribution() / 12;
  let balance = initialAmount();
  const yearlyBreakdown: YearlyBreakdown[] = [];

  for (let month = 1; month <= months; month++) {
    balance += monthlyContribution;
    balance = balance * (1 + monthlyRate);

    if (month % 12 === 0) {
      const year = month / 12;
      const totalContributions = initialAmount() + monthlyContribution * month;
      yearlyBreakdown.push({
        year,
        balance,
        totalContributions,
      });
    }
  }

  const finalAmount = balance;
  const totalContributions = initialAmount() + monthlyContribution * months;
  const totalGrowth = finalAmount - totalContributions;

  return {
    yearlyBreakdown,
    finalAmount,
    totalContributions,
    totalGrowth,
    monthlyContribution,
  };
};

const initFromUrlParams = () => {
  const params = new URL(window.location.href).searchParams;
  const getNumber = (key: string, setter: (v: number) => void) => {
    const value = params.get(key);
    if (value !== null && !Number.isNaN(Number(value))) {
      setter(Number(value));
    }
  };

  getNumber("initial", setInitialAmount);
  const contributionParam = params.get("contribution") ?? params.get("monthly");
  if (contributionParam && !Number.isNaN(Number(contributionParam))) {
    setContribution(Number(contributionParam));
  }
  getNumber("return", setAnnualReturn);
  getNumber("years", setYears);

  const freq = params.get("freq");
  if (freq === "yearly" || freq === "monthly") setContributionFrequency(freq);
};

const CompoundEffect: Component = () => {
  const navigate = useNavigate();
  const showBackButton = !hasSharedToolQuery([
    "years",
    "initial",
    "contribution",
    "monthly",
    "return",
    "freq",
  ]);
  onMount(initFromUrlParams);

  return (
    <PageShell>
      <PageHeader
        onBack={showBackButton ? () => navigate(-1) : undefined}
        icon={
          <Dynamic
            component={dashboardOptions.compoundEffect.icon}
            class="h-5 w-5"
          />
        }
        title={dashboardOptions.compoundEffect.title}
        subtitle={dashboardOptions.compoundEffect.description}
      />

      <PageBody><div class="pb-10">
        <_Inputs />
        <div class="relative mt-6">
          <div class="mb-6 md:mb-0 md:absolute md:top-6">
            <_ResultSummary />
          </div>
          <div class="mx-auto w-full">
            <_Chart />
          </div>
        </div>

        <div class="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h4 class="font-semibold text-blue-900">Regular Contributions</h4>
          <p class="mt-2 text-base text-blue-700">
            Consistent contributions significantly boost your returns through
            dollar-cost averaging and compound growth over time.
          </p>
        </div>

        <div class="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
          <h4 class="font-semibold text-green-900">Compound Returns</h4>
          <p class="mt-2 text-base text-green-700">
            Your money grows exponentially as you earn returns on both your
            initial investment and the accumulated returns. This is why
            starting early makes such a big difference.
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
    <span class={`inline-flex items-baseline font-bold ${props.accentClass ?? "text-primary"}`}>
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
          <_InlineInput id="initialAmount" value={initialAmount()} min={0} max={1000000} onChange={setInitialAmount} prefix="$" width="7ch" />{" "}
          to start with, and I will contribute additional{" "}
          <_InlineInput id="contribution" value={contribution()} min={0} max={contributionFrequency() === "monthly" ? 50000 : 600000} onChange={setContribution} prefix="$" width="7ch" />{" "}
          per <_FreqToggle />.
        </p>

        <p class="space-y-2">
          At{" "}
          <_InlineInput id="annualReturn" value={annualReturn()} min={1} max={15} onChange={setAnnualReturn} suffix="%" width="3ch" />{" "}
          projected annual rate of return, over{" "}
          <_InlineInput id="years" value={years()} min={1} max={100} onChange={setYears} />{" "}
          {years() === 1 ? "year" : "years"}.
        </p>
      </div>
    </div>
  );
};

const _ResultSummary: Component = () => {
  const data = createMemo(() => computedValues());

  const getPercentage = (amount: number) => {
    const total = data().finalAmount;
    if (total <= 0) return 0;
    return Math.min(100, Math.max(0, (amount / total) * 100));
  };

  return (
    <div class="h-full rounded-lg bg-primary-50 p-6 md:ml-5">
      <div class="mb-1 flex items-center justify-center gap-2">
        <TbOutlineTrendingUp class="h-6 w-6 text-primary" />
        <p class="text-base font-medium text-gray-600">
          Final Amount After {formatYears(years())}
        </p>
      </div>
      <p class="mb-4 text-center text-4xl font-bold text-primary">
        {formatCurrency(data().finalAmount)}
      </p>

      <div class="space-y-2">
        <div>
          <div class="mb-2 flex items-center justify-between text-base">
            <span class="text-gray-600">Total Contributions</span>
            <span class="font-semibold text-blue-600">
              {formatCurrency(data().totalContributions)}
            </span>
          </div>
          <div class="h-3 overflow-hidden rounded-full bg-gray-200">
            <div
              class="h-full bg-blue-500 transition-all duration-500"
              style={{
                width: `${getPercentage(data().totalContributions)}%`,
              }}
            />
          </div>
        </div>

        <div class="pt-2">
          <div class="mb-2 flex items-center justify-between text-base">
            <span class="text-gray-600">Compound Returns</span>
            <span class="font-semibold text-green-600">
              {formatCurrency(data().totalGrowth)}
            </span>
          </div>
          <div class="h-3 overflow-hidden rounded-full bg-gray-200">
            <div
              class="h-full bg-green-500 transition-all duration-500"
              style={{
                width: `${getPercentage(data().totalGrowth)}%`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const _Chart: Component = () => {
  const [chartContainerRef, setChartContainerRef] = createSignal<
    HTMLDivElement | undefined
  >();
  const [chartSvgRef, setChartSvgRef] = createSignal<
    SVGSVGElement | undefined
  >();
  const [hoverIndex, setHoverIndex] = createSignal<number | null>(null);
  const [chartWidthPx, setChartWidthPx] = createSignal(320);

  const chartData = createMemo(() => {
    const breakdown = computedValues().yearlyBreakdown;
    if (breakdown.length === 0) {
      const width = Math.max(260, chartWidthPx());
      const height = Math.max(180, Math.round(width * 0.56));
      const paddingX = 0;
      const paddingY = 0;
      return {
        path: "",
        principalPath: "",
        gainPath: "",
        points: [] as {
          x: number;
          y: number;
          principalY: number;
          year: number;
          balance: number;
          principal: number;
          growth: number;
        }[],
        width,
        height,
        paddingX,
        paddingY,
        chartWidth: width - paddingX * 2,
        chartHeight: height - paddingY * 2,
        maxValue: 0,
      };
    }

    const width = Math.max(260, chartWidthPx());
    const height = Math.max(180, Math.round(width * 0.56));
    const paddingX = 0;
    const paddingY = 0;
    const chartWidth = width - paddingX * 2;
    const chartHeight = height - paddingY * 2;
    const monthlyAmount = computedValues().monthlyContribution;
    const principalSeries = [
      initialAmount(),
      ...breakdown.map((b) => initialAmount() + monthlyAmount * 12 * b.year),
    ];
    const maxValue = Math.max(
      ...breakdown.map((b) => b.balance),
      ...principalSeries,
      1,
    );

    const points = [
      {
        x: paddingX,
        y: paddingY + chartHeight,
        principalY: paddingY + chartHeight,
        year: 0,
        balance: initialAmount(),
        principal: initialAmount(),
        growth: 0,
      },
      ...breakdown.map((b, idx) => {
        const x =
          paddingX +
          (breakdown.length === 1
            ? chartWidth
            : ((idx + 1) / breakdown.length) * chartWidth);
        const y = paddingY + (1 - b.balance / maxValue) * chartHeight;
        const principal = principalSeries[idx + 1];
        const principalY = paddingY + (1 - principal / maxValue) * chartHeight;
        return {
          x,
          y,
          principalY,
          year: b.year,
          balance: b.balance,
          principal,
          growth: b.balance - principal,
        };
      }),
    ];

    const path = points
      .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
    const principalPath = points
      .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.principalY}`)
      .join(" ");
    const gainPath =
      points.length > 1
        ? [
            ...points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`),
            ...[...points].reverse().map((p) => `L ${p.x} ${p.principalY}`),
            "Z",
          ].join(" ")
        : "";
    return {
      path,
      principalPath,
      gainPath,
      points,
      width,
      height,
      paddingX,
      paddingY,
      chartWidth,
      chartHeight,
      maxValue,
    };
  });

  const hoverPoint = createMemo(() => {
    const idx = hoverIndex();
    const points = chartData().points;
    if (idx === null || !points[idx]) return null;
    return points[idx];
  });

  const setHoverFromPointer = (e: PointerEvent, target: SVGSVGElement) => {
    const data = chartData();
    if (!data.points.length) return;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left - data.paddingX;
    const y = e.clientY - rect.top - data.paddingY;
    if (x < 0 || x > data.chartWidth || y < 0 || y > data.chartHeight) return;
    const ratio = x / data.chartWidth;
    const idx = Math.round(ratio * (data.points.length - 1));
    setHoverIndex(Math.max(0, Math.min(data.points.length - 1, idx)));
  };

  onMount(() => {
    const container = chartContainerRef();
    if (typeof ResizeObserver !== "undefined" && container) {
      setChartWidthPx(container.getBoundingClientRect().width || 320);
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
      const svg = chartSvgRef();
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
        id="compound-effect-chart"
        class="overflow-hidden"
        aria-hidden="false"
        style={{
          transition: "max-height 300ms ease, opacity 300ms ease",
          "max-height": `${chartData().height + 160}px`,
          opacity: "1",
          "pointer-events": "auto",
        }}
      >
        <div
          ref={setChartContainerRef}
          class="mx-auto w-full max-w-[768px]"
        >
          <Show
            when={chartData().path}
            fallback={
              <p class="text-base text-gray-600">
                Adjust inputs to generate a projection.
              </p>
            }
          >
            <svg
              width={chartData().width}
              height={chartData().height}
              viewBox={`0 0 ${chartData().width} ${chartData().height}`}
              class="w-full"
              ref={setChartSvgRef}
              style={{ "touch-action": "pan-y pinch-zoom" }}
              onPointerDown={(e) => {
                setHoverFromPointer(e, e.currentTarget);
              }}
              onPointerMove={(e) => {
                if (e.pressure === 0 && e.pointerType === "mouse") return;
                setHoverFromPointer(e, e.currentTarget);
              }}
            >
              {chartData().principalPath && (
                <path
                  d={`${chartData().principalPath} L ${
                    chartData().width - chartData().paddingX
                  } ${chartData().height - chartData().paddingY} L ${
                    chartData().paddingX
                  } ${chartData().height - chartData().paddingY} Z`}
                  fill="rgba(59,130,246,0.25)"
                  stroke="none"
                />
              )}

              {chartData().gainPath && (
                <path
                  d={chartData().gainPath}
                  fill="rgba(34,197,94,0.2)"
                  stroke="none"
                />
              )}

              <path
                d={chartData().path}
                fill="none"
                stroke="#16a34a"
                stroke-width="2"
              />

              <Show when={hoverPoint()}>
                {(pt) => (
                  <>
                    <line
                      x1={pt().x}
                      x2={pt().x}
                      y1={chartData().paddingY}
                      y2={chartData().height - chartData().paddingY}
                      stroke="#94a3b8"
                      stroke-dasharray="4 2"
                      stroke-width="1"
                    />
                    <circle cx={pt().x} cy={pt().y} r="3" fill="#16a34a" />
                  </>
                )}
              </Show>
            </svg>
          </Show>
          <div class="flex items-center justify-between text-center text-sm text-gray-600">
            <span>Year 0</span>
            <Show when={hoverPoint()}>
              {(pt) => (
                <span class="font-semibold">
                  Year {pt().year}:
                  <span class="text-primary">
                    &nbsp;{formatCurrency(pt().balance)}
                  </span>
                </span>
              )}
            </Show>

            <span>Year {years()}</span>
          </div>
          <Show when={hoverPoint()}>
            {(pt) => (
              <div class="px-6 text-center text-sm text-gray-700">
                <div class="items-center justify-between gap-1">
                  <span class="font-semibold text-blue-600">
                    Principal: {formatCurrency(pt().principal)}
                  </span>
                  <br />
                  <span class="font-semibold text-green-600">
                    Returns: {formatCurrency(pt().growth)}
                  </span>
                </div>
              </div>
            )}
          </Show>
          <div class="mt-4 text-center">
            <h4 class="text-base font-semibold text-gray-900">
              Year-by-Year Growth
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
    url.searchParams.set("initial", initialAmount().toString());
    url.searchParams.set("contribution", contribution().toString());
    url.searchParams.set("return", annualReturn().toString());
    url.searchParams.set("years", years().toString());
    url.searchParams.set("freq", contributionFrequency());

    const shareUrl = url.toString();

    try {
      if (navigator.share) {
        await navigator.share({
          url: shareUrl,
          title: "The Compound Effect",
          text: "See how your wealth can grow with compound returns",
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

export default CompoundEffect;
