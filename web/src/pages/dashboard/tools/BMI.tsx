import { Component, For, Show, createMemo, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineActivity,
  TbOutlineAlertTriangle,
  TbOutlineCheck,
  TbOutlineMinus,
  TbOutlinePlus,
  TbOutlineX,
} from "solid-icons/tb";
import { PageShell, PageHeader, PageBody } from "../../../components/ui";
import { dashboardOptions } from "../dashboardOptions";

const [height, setHeight] = createSignal(170);
const [weight, setWeight] = createSignal(70);
const [categoryScheme, setCategoryScheme] = createSignal<"who" | "asian">(
  "asian",
);

const clamp = (val: number, min: number, max: number) =>
  Math.min(max, Math.max(min, val));

const bmiValue = () => {
  if (height() <= 0 || weight() <= 0) return 0;
  const heightMeters = height() / 100;
  return weight() / Math.pow(heightMeters, 2);
};

type InsuranceStatus =
  | "ok"
  | "may-load"
  | "may-load-or-reject"
  | "may-reject"
  | "loading"
  | "rejected";

const aiaLifeStatus = (): InsuranceStatus => {
  if (bmiValue() < 18.5) return "may-load-or-reject";
  if (bmiValue() >= 30) return "may-load-or-reject";
  if (bmiValue() >= 27.5) return "may-load";
  return "ok";
};

const aiaHsgStatus = (): InsuranceStatus => {
  if (bmiValue() < 18.5) return "may-reject";
  if (bmiValue() >= 35) return "rejected";
  return "ok";
};

const singlifeStatus = (): InsuranceStatus => {
  if (bmiValue() < 18.5) return "may-load-or-reject";
  if (bmiValue() >= 40) return "rejected";
  if (bmiValue() >= 30) return "loading";
  return "ok";
};

const insuranceAlerts = () => {
  const plans: Array<{ name: string; status: InsuranceStatus }> = [
    { name: "AIA Life", status: aiaLifeStatus() },
    { name: "AIA HSG", status: aiaHsgStatus() },
    { name: "Singlife CS", status: singlifeStatus() },
  ];
  const alerts: { name: string; status: InsuranceStatus }[] = [];
  plans.forEach((plan) => {
    if (plan.status !== "ok") {
      alerts.push({
        name: plan.name,
        status: plan.status,
      });
    }
  });
  return alerts;
};

const BMI: Component = () => {
  const navigate = useNavigate();
  return (
    <PageShell>
      <PageHeader
        onBack={() => navigate(-1)}
        icon={
          <Dynamic component={dashboardOptions.bmi.icon} class="h-5 w-5" />
        }
        title={dashboardOptions.bmi.title}
        subtitle={dashboardOptions.bmi.description}
      />

      <PageBody>
        {/* Card 1: Calculator (inputs + result) */}
        <div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <_Inputs />
          <_ResultSummary />
        </div>

        {/* Insurance Underwriting — always visible, dynamic */}
        <_InsuranceNotes />

        {/* BMI Classification */}
        <div class="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h4 class="font-semibold text-gray-900">BMI Classification</h4>
          <div class="mt-3 mb-3 flex justify-center">
            <div class="inline-flex rounded-full border border-gray-200 bg-gray-100 p-0.5 text-sm">
              <button
                type="button"
                class={`rounded-full px-4 py-1 font-medium transition ${
                  categoryScheme() === "who"
                    ? "bg-white text-primary shadow-sm"
                    : "text-gray-500"
                }`}
                onClick={() => setCategoryScheme("who")}
              >
                WHO
              </button>
              <button
                type="button"
                class={`rounded-full px-4 py-1 font-medium transition ${
                  categoryScheme() === "asian"
                    ? "bg-white text-primary shadow-sm"
                    : "text-gray-500"
                }`}
                onClick={() => setCategoryScheme("asian")}
              >
                Asian (MOH)
              </button>
            </div>
          </div>
          <_Categories />
        </div>

        {/* About BMI */}
        <div class="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h4 class="font-semibold text-blue-900">About BMI</h4>
          <p class="mt-2 text-base text-blue-700">
            This calculator is to be used for adults aged 18 and above only. 
            BMI is not a reliable measure for children, pregnant women, or highly muscular 
            individuals.
          </p>
          <p class="mt-3 text-center text-base font-medium text-blue-800">
            BMI = weight (kg) &divide; height (m)<sup>2</sup>
          </p>
        </div>
      </PageBody>
    </PageShell>
  );
};

/*******************************
 *
 * BEGIN all subcomponents below
 *
 *******************************/

const _StepperInput: Component<{
  id: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}> = (props) => {
  const [raw, setRaw] = createSignal(String(props.value));

  // Sync raw text when the external signal changes (e.g. via stepper buttons)
  const syncRaw = () => setRaw(String(props.value));

  return (
    <div class="flex flex-col items-center gap-2">
      <label
        for={props.id}
        class="text-xs font-semibold uppercase tracking-widest text-gray-400"
      >
        {props.label} ({props.unit})
      </label>
      <div class="flex w-full items-center gap-3">
        <button
          type="button"
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition active:bg-primary/20"
          onClick={() => {
            const next = clamp(props.value - props.step, props.min, props.max);
            props.onChange(next);
            setRaw(String(next));
          }}
        >
          <TbOutlineMinus class="h-5 w-5" />
        </button>
        <div class="relative flex-1">
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
            class="w-full rounded-xl border-0 bg-gray-100 py-3 text-center text-2xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          type="button"
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition active:bg-primary/20"
          onClick={() => {
            const next = clamp(props.value + props.step, props.min, props.max);
            props.onChange(next);
            setRaw(String(next));
          }}
        >
          <TbOutlinePlus class="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

const _Inputs: Component = () => {
  return (
    <div class="mb-6 grid gap-6 md:grid-cols-2 md:gap-10">
      <_StepperInput
        id="height"
        label="Height"
        unit="cm"
        value={height()}
        min={100}
        max={250}
        step={1}
        onChange={setHeight}
      />
      <_StepperInput
        id="weight"
        label="Weight"
        unit="kg"
        value={weight()}
        min={30}
        max={200}
        step={1}
        onChange={setWeight}
      />
    </div>
  );
};

const _ResultSummary: Component = () => {
  const result = createMemo(() => {
    let category = "";
    let color = "";

    const value = bmiValue();
    if (categoryScheme() === "asian") {
      if (value < 18.5) {
        category = "Underweight";
        color = "text-blue-600";
      } else if (value < 23) {
        category = "Normal weight";
        color = "text-green-600";
      } else if (value < 27.5) {
        category = "Overweight (At Risk)";
        color = "text-yellow-600";
      } else {
        category = "Obese (High Risk)";
        color = "text-red-600";
      }
    } else {
      if (value < 18.5) {
        category = "Underweight";
        color = "text-blue-600";
      } else if (value < 25) {
        category = "Normal weight";
        color = "text-green-600";
      } else if (value < 30) {
        category = "Overweight";
        color = "text-yellow-600";
      } else {
        category = "Obese";
        color = "text-red-600";
      }
    }

    return { category, color };
  });

  return (
    <Show when={bmiValue() > 0}>
      <div class="mb-6 rounded-lg bg-linear-to-br from-primary/5 to-secondary/5 p-6 text-center">
        <div class="mb-1 flex items-center justify-center gap-2">
          <TbOutlineActivity class="h-6 w-6 text-primary" />
          <p class="text-base font-medium text-gray-600">Your BMI</p>
        </div>
        <p class="mb-1 text-5xl font-bold text-primary">
          {bmiValue().toFixed(1)}
        </p>
        <p class={`text-lg font-semibold ${result().color}`}>
          {result().category}
        </p>
        <Show when={insuranceAlerts().length > 0}>
          <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
            <For each={insuranceAlerts()}>
              {(alert) => (
                <span
                  class={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold ${statusConfig[alert.status].badgeCls}`}
                >
                  <Dynamic
                    component={
                      alert.status === "rejected"
                        ? TbOutlineX
                        : TbOutlineAlertTriangle
                    }
                    class="h-3.5 w-3.5"
                  />
                  {alert.name}: {statusConfig[alert.status].label}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
};

const _Categories: Component = () => {
  const categories = createMemo(() => {
    if (categoryScheme() === "asian") {
      return [
        { label: "Underweight", range: "< 18.5", color: "text-blue-600" },
        {
          label: "Normal weight",
          range: "18.5 - 22.9",
          color: "text-green-600",
        },
        {
          label: "Overweight",
          range: "23.0 - 27.4",
          color: "text-yellow-600",
        },
        { label: "Obese", range: "≥ 27.5", color: "text-red-600" },
      ];
    }
    return [
      { label: "Underweight", range: "< 18.5", color: "text-blue-600" },
      { label: "Normal weight", range: "18.5 - 24.9", color: "text-green-600" },
      { label: "Overweight", range: "25 - 29.9", color: "text-yellow-600" },
      { label: "Obese", range: "≥ 30", color: "text-red-600" },
    ];
  });

  return (
    <div class="grid gap-2 text-base">
      <For each={categories()}>
        {(category) => (
          <div class="flex items-center justify-between">
            <span class="text-gray-700">{category.label}</span>
            <span class={`font-medium ${category.color}`}>
              {category.range}
            </span>
          </div>
        )}
      </For>
    </div>
  );
};

const statusConfig: Record<
  InsuranceStatus,
  { label: string; badgeCls: string; borderCls: string; bgCls: string }
> = {
  ok: {
    label: "OK",
    badgeCls: "bg-green-100 text-green-700",
    borderCls: "border-green-200",
    bgCls: "bg-white",
  },
  "may-load": {
    label: "May load",
    badgeCls: "bg-yellow-100 text-yellow-700",
    borderCls: "border-yellow-300",
    bgCls: "bg-yellow-50/50",
  },
  "may-load-or-reject": {
    label: "May load / Reject",
    badgeCls: "bg-amber-100 text-amber-700",
    borderCls: "border-amber-300",
    bgCls: "bg-amber-50/50",
  },
  "may-reject": {
    label: "May reject",
    badgeCls: "bg-orange-100 text-orange-700",
    borderCls: "border-orange-300",
    bgCls: "bg-orange-50/50",
  },
  loading: {
    label: "Loading",
    badgeCls: "bg-orange-100 text-orange-700",
    borderCls: "border-orange-300",
    bgCls: "bg-orange-50/50",
  },
  rejected: {
    label: "Rejected",
    badgeCls: "bg-red-100 text-red-700",
    borderCls: "border-red-300",
    bgCls: "bg-red-50/50",
  },
};

const statusIcon = (status: InsuranceStatus) => {
  if (status === "ok") return TbOutlineCheck;
  if (status === "rejected") return TbOutlineX;
  return TbOutlineAlertTriangle;
};

const _InsuranceNotes: Component = () => {
  const StatusBadge: Component<{ status: InsuranceStatus }> = (p) => {
    const cfg = () => statusConfig[p.status];
    const Icon = () => statusIcon(p.status);
    return (
      <span
        class={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold ${cfg().badgeCls}`}
      >
        <Dynamic component={Icon()} class="h-3.5 w-3.5" />
        {cfg().label}
      </span>
    );
  };

  return (
    <Show when={bmiValue() > 0}>
      <div class="mt-4">
        <h3 class="mb-3 text-base font-semibold text-gray-900">
          Insurance Underwriting
        </h3>
        <div class="space-y-2">
          {/* AIA Life */}
          <div
            class={`rounded-lg border p-3 transition-colors ${statusConfig[aiaLifeStatus()].borderCls} ${statusConfig[aiaLifeStatus()].bgCls}`}
          >
            <div class="flex items-center justify-between">
              <p class="font-semibold text-gray-900">AIA Life</p>
              <StatusBadge status={aiaLifeStatus()} />
            </div>
            <div class="mt-2 space-y-1 text-sm text-gray-600">
              <p>
                BMI &lt; 18.5: <span class="font-medium">MAY</span> load or reject
              </p>
              <p>
                BMI ≥ 27.5: <span class="font-medium">MAY</span> have loading if there are 
                other risk factors
              </p>
              <p>
                BMI ≥ 30: <span class="font-medium">MAY</span> have loading or rejected
              </p>
            </div>
          </div>

          {/* AIA HSG */}
          <div
            class={`rounded-lg border p-3 transition-colors ${statusConfig[aiaHsgStatus()].borderCls} ${statusConfig[aiaHsgStatus()].bgCls}`}
          >
            <div class="flex items-center justify-between">
              <p class="font-semibold text-gray-900">AIA HSG</p>
              <StatusBadge status={aiaHsgStatus()} />
            </div>
            <div class="mt-2 text-sm text-gray-600">
              <p>
                BMI &lt; 18.5: <span class="font-medium">MAY</span> reject
              </p>
              <p>
                BMI ≥ 35: <span class="font-medium">WILL</span> be rejected
              </p>
            </div>
          </div>

          {/* Singlife Careshield */}
          <div
            class={`rounded-lg border p-3 transition-colors ${statusConfig[singlifeStatus()].borderCls} ${statusConfig[singlifeStatus()].bgCls}`}
          >
            <div class="flex items-center justify-between">
              <p class="font-semibold text-gray-900">Singlife Careshield</p>
              <StatusBadge status={singlifeStatus()} />
            </div>
            <div class="mt-2 space-y-1 text-sm text-gray-600">
              <p>
                BMI &lt; 18.5: <span class="font-medium">MAY</span> load or reject
              </p>
              <p>
                BMI ≥ 30: <span class="font-medium">WILL</span> have
                significant loading
              </p>
              <p>
                BMI ≥ 40: <span class="font-medium">WILL</span> be rejected
              </p>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default BMI;
