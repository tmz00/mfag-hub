import {
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";

import App from "./App";
import {
  getMaintenanceWindowState,
  maintenanceSchedule,
  type MaintenanceWindowState,
} from "./config/maintenance";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatWindowTime = (date: Date | null) =>
  date ? dateFormatter.format(date) : "Not scheduled";

const MaintenancePage: Component<{ state: MaintenanceWindowState }> = (
  props,
) => {
  return (
    <main class="relative min-h-dvh overflow-hidden bg-linear-to-br from-primary-950 via-primary-800 to-secondary-700 text-white">
      <div class="pointer-events-none absolute inset-0">
        <div class="absolute -left-16 top-10 h-56 w-56 rounded-full bg-secondary-300/20 blur-3xl sm:h-72 sm:w-72" />
        <div class="absolute right-[-3rem] top-1/4 h-64 w-64 rounded-full bg-white/12 blur-3xl sm:h-80 sm:w-80" />
        <div class="absolute bottom-[-4rem] left-1/3 h-72 w-72 rounded-full bg-secondary-200/12 blur-3xl sm:h-96 sm:w-96" />
      </div>

      <div class="relative flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <section class="w-full max-w-5xl p-6 sm:p-10">
          <div class="flex justify-center">
            <img
              src="/images/hub_banner.png"
              alt="MFAG Hub Banner"
              class="w-full max-w-[300px] sm:max-w-[480px]"
            />
          </div>
          <h1 class="text-2xl mt-8 text-center font-semibold leading-tight text-white">
            {maintenanceSchedule.title}
          </h1>

          <div class="mt-8">
            <p class="mt-5 text-center text-base leading-8 text-white/78">
              {maintenanceSchedule.message}
            </p>
          </div>

          <div class="mx-auto mt-8 flex w-full max-w-md justify-center">
            <div class="w-full rounded-3xl border border-white/14 bg-black/10 p-5 text-center text-sm text-white/80">
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                  Started
                </div>
                <div class="mt-2 text-base font-medium text-white">
                  {formatWindowTime(props.state.startsAt)}
                </div>
              </div>
              <div class="mt-4">
                <div class="text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                  Expected Return
                </div>
                <div class="mt-2 text-base font-medium text-white">
                  {formatWindowTime(props.state.endsAt)}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

const MaintenanceRoot: Component = () => {
  const [now, setNow] = createSignal(Date.now());
  const state = createMemo(() => getMaintenanceWindowState(now()));

  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <Show when={state().active} fallback={<App />}>
      <MaintenancePage state={state()} />
    </Show>
  );
};

export default MaintenanceRoot;
