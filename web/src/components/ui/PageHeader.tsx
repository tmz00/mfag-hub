import { TbOutlineArrowLeft } from "solid-icons/tb";
import type { Component, JSX } from "solid-js";
import { Show, onMount, onCleanup } from "solid-js";

export type PageHeaderVariant = "default" | "admin" | "dashboard" | "plain";

type PageHeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
  icon?: JSX.Element;
  actions?: JSX.Element;
  footer?: JSX.Element;
  backLabel?: string;
  /** Back handler */
  onBack?: () => void;
  variant?: PageHeaderVariant;
  themeColorVariant?: PageHeaderVariant;
  gradient?: string;
  paddingClass?: string;
  maxWidthClass?: string;
  class?: string;
};

// CSS variable names for theme colors (matching gradient start colors)
const THEME_COLOR_VARS: Record<PageHeaderVariant, string> = {
  default: "--color-primary-500",
  admin: "--color-admin-from",
  dashboard: "--color-primary-100",
  plain: "--color-primary",
};

const DEFAULT_THEME_COLOR_VAR = "--color-primary";

const getCssColor = (varName: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
};

export const PageHeader: Component<PageHeaderProps> = (props) => {
  let rootRef: HTMLDivElement | undefined;
  let previousThemeColor: string | null = null;

  // Update iOS/iPad status bar theme color
  onMount(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const variant = props.themeColorVariant || props.variant || "default";
    const colorVar = THEME_COLOR_VARS[variant] || DEFAULT_THEME_COLOR_VAR;
    const themeColor = getCssColor(colorVar, "#178e9e");

    if (meta) {
      previousThemeColor = meta.getAttribute("content");
      meta.setAttribute("content", themeColor);
    }
  });

  onCleanup(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const restoredColor =
        previousThemeColor?.trim() || getCssColor(DEFAULT_THEME_COLOR_VAR, "#178e9e");
      meta.setAttribute("content", restoredColor);
    }
  });

  const isDashboard = () => props.variant === "dashboard";
  const isAdmin = () => props.variant === "admin";
  const isPlain = () => props.variant === "plain";
  const isSticky = () => isAdmin();

  // White text with dark outline for colored headers
  const textOutline = "[text-shadow:0_1px_3px_rgba(0,0,0,0.5)]";

  const textColor = () => {
    if (isPlain()) return "text-gray-900";
    if (isDashboard()) return "text-gray-700";
    return `text-white ${textOutline}`;
  };

  const subtitleColor = () => {
    if (isPlain()) return "text-gray-600";
    if (isDashboard()) return "text-gray-600";
    return `text-white/90 ${textOutline}`;
  };

  const backButtonColor = () => {
    if (isPlain()) return "text-gray-600 hover:bg-black/10";
    if (isDashboard()) return "text-gray-600 hover:bg-black/10";
    if (isAdmin()) return "text-white hover:bg-white/25";
    return "text-white hover:bg-white/25";
  };

  const backButton = () => {
    if (props.onBack) {
      return (
        <button
          type="button"
          onClick={props.onBack}
          aria-label={props.backLabel || "Back"}
          class={`inline-flex cursor-pointer items-center justify-center rounded-full transition ${backButtonColor()} h-5 w-5`}
        >
          <TbOutlineArrowLeft class="h-5 w-5" />
        </button>
      );
    }

    return null;
  };

  const gradient = () => {
    if (props.gradient) return props.gradient;
    if (props.variant === "plain") {
      return "bg-white";
    } else if (props.variant === "admin") {
      return "bg-linear-to-b from-[var(--color-admin-from)] to-[var(--color-admin-to)]";
    } else if (props.variant === "dashboard") {
      return "bg-linear-to-b from-primary-100 to-secondary-100";
    }
    return "bg-primary-500";
  };

  const paddingClass = props.paddingClass || "px-4 py-4";
  const maxWidthClass = props.maxWidthClass || "max-w-7xl";

  return (
    <>
      <div
        ref={rootRef}
        class={`${isSticky() ? "sticky top-0 z-50 backdrop-blur" : "z-40"} isolate overflow-hidden border-b border-black/10 shadow-sm ${gradient()} ${props.class || ""}`}
      >
        <div
          class="pointer-events-none absolute inset-0 opacity-10"
          aria-hidden="true"
        />
        <div class={`mx-auto ${maxWidthClass} ${textColor()} ${paddingClass}`}>
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <Show when={backButton()}>
                {backButton()}
              </Show>
              <div class="pl-2">
                <div class="flex items-center gap-2 text-xl font-bold">
                  <Show when={props.icon}>
                    <span class="flex h-5 w-5 items-center justify-center">
                      {props.icon}
                    </span>
                  </Show>
                  <Show when={props.title}>
                    <h1 class="font-condensed text-2xl">{props.title}</h1>
                  </Show>
                </div>
                <Show when={props.subtitle}>
                  <div class={`mt-0.5 font-condensed text-lg ${subtitleColor()}`}>
                    {props.subtitle}
                  </div>
                </Show>
                <Show when={isAdmin()}>
                  <div class={`mt-1 text-sm italic text-white/90 ${textOutline} md:hidden`}>
                    Best viewed in iPad/desktop
                  </div>
                </Show>
              </div>
            </div>
            <Show when={props.actions}>
              <div class="flex items-center gap-2">{props.actions}</div>
            </Show>
          </div>
          <Show when={props.footer}>
            <div class="mt-4">{props.footer}</div>
          </Show>
        </div>
      </div>

    </>
  );
};
