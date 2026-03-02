import { createSignal, type Component, type JSX } from "solid-js";
import { TbOutlineRefresh } from "solid-icons/tb";
import { checkForAppUpdateAndReload } from "../../utils/appUpdate";

type PageShellProps = {
  backgroundClass?: string;
  children: JSX.Element;
};

export const PageShell: Component<PageShellProps> = (props) => {
  const bg = props.backgroundClass || "bg-gray-50";
  const [pullDistance, setPullDistance] = createSignal(0);
  const [refreshing, setRefreshing] = createSignal(false);
  let touchStartY: number | null = null;
  let isPullTracking = false;

  const canStartPull = () => {
    if (refreshing()) return false;
    if (typeof window === "undefined") return false;
    return window.scrollY <= 0;
  };

  const shouldSkipPullRefresh = (event: TouchEvent) => {
    const target = event.target as Element | null;
    return Boolean(target?.closest("[data-disable-pull-refresh='true']"));
  };

  const onTouchStart: JSX.EventHandler<HTMLDivElement, TouchEvent> = (event) => {
    if (event.touches.length !== 1) return;
    if (shouldSkipPullRefresh(event)) return;
    if (!canStartPull()) return;
    touchStartY = event.touches[0]?.clientY ?? null;
    isPullTracking = touchStartY !== null;
  };

  const onTouchMove: JSX.EventHandler<HTMLDivElement, TouchEvent> = (event) => {
    if (shouldSkipPullRefresh(event)) {
      isPullTracking = false;
      touchStartY = null;
      setPullDistance(0);
      return;
    }
    if (!isPullTracking || touchStartY === null) return;
    const currentY = event.touches[0]?.clientY;
    if (currentY === undefined) return;
    const delta = currentY - touchStartY;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }

    const damped = Math.min(120, delta * 0.45);
    setPullDistance(damped);
    event.preventDefault();
  };

  const endPull = () => {
    if (!isPullTracking) return;
    isPullTracking = false;
    touchStartY = null;

    if (pullDistance() >= 72) {
      setRefreshing(true);
      setPullDistance(72);
      window.setTimeout(() => {
        void checkForAppUpdateAndReload();
      }, 300);
      return;
    }

    setPullDistance(0);
  };

  const progress = () => Math.min(1, pullDistance() / 72);

  return (
    <div
      class={`min-h-dvh ${bg} relative`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endPull}
      onTouchCancel={endPull}
    >
      <div
        class="pointer-events-none absolute left-1/2 z-50"
        style={{
          top: "max(10px, env(safe-area-inset-top))",
          transform: `translate(-50%, ${Math.max(0, pullDistance() * 0.38)}px)`,
          opacity: refreshing() ? "1" : `${Math.min(1, progress() * 1.5)}`,
          transition:
            pullDistance() === 0 && !refreshing()
              ? "transform 180ms ease, opacity 180ms ease"
              : refreshing()
                ? "transform 120ms ease"
                : "none",
        }}
      >
        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5">
          <TbOutlineRefresh
            class={`h-5 w-5 text-gray-500 ${refreshing() ? "animate-spin" : ""}`}
            style={
              refreshing()
                ? undefined
                : { transform: `rotate(${-35 + progress() * 110}deg)` }
            }
          />
        </div>
      </div>

      {props.children}
    </div>
  );
};
