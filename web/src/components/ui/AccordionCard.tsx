import {
  Component,
  JSX,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { TbOutlineChevronDown } from "solid-icons/tb";

interface AccordionCardProps {
  open: boolean;
  onToggle: () => void;
  header: JSX.Element;
  children: JSX.Element;
  /** Show chevron icon. Default: true */
  showChevron?: boolean;
  /** Gradient class for the left bar. Default: "bg-linear-to-b from-primary to-secondary" */
  gradientClass?: string;
  /** Background class for the header button. Default: "bg-white/95 hover:bg-gray-50" */
  headerBgClass?: string;
  /** Sticky positioning class. Default: "sticky top-0 z-10" */
  stickyClass?: string;
  /** Extra class on root wrapper */
  class?: string;
  /** HTML id on root wrapper */
  id?: string;
}

export const AccordionCard: Component<AccordionCardProps> = (props) => {
  const gradient = () =>
    props.gradientClass ?? "bg-linear-to-b from-primary to-secondary";
  const headerBg = () => props.headerBgClass ?? "bg-white/95 hover:bg-gray-50";
  const sticky = () => props.stickyClass ?? "sticky top-0 z-10";
  const showChevron = () => props.showChevron ?? true;
  const [renderBody, setRenderBody] = createSignal(props.open);
  const [mounted, setMounted] = createSignal(false);
  let bodyRef: HTMLDivElement | undefined;
  let bodyInnerRef: HTMLDivElement | undefined;
  let rafA: number | undefined;
  let rafB: number | undefined;

  const clearRafs = () => {
    if (rafA !== undefined) cancelAnimationFrame(rafA);
    if (rafB !== undefined) cancelAnimationFrame(rafB);
    rafA = undefined;
    rafB = undefined;
  };

  const animateOpen = () => {
    if (!bodyRef || !bodyInnerRef) return;
    bodyRef.style.maxHeight = "0px";
    bodyRef.style.opacity = "0";
    bodyRef.style.overflow = "hidden";
    rafA = requestAnimationFrame(() => {
      rafB = requestAnimationFrame(() => {
        if (!bodyRef || !bodyInnerRef) return;
        bodyRef.style.maxHeight = `${bodyInnerRef.scrollHeight}px`;
        bodyRef.style.opacity = "1";
      });
    });
  };

  const animateClose = () => {
    if (!bodyRef || !bodyInnerRef) {
      setRenderBody(false);
      return;
    }
    bodyRef.style.maxHeight = `${bodyInnerRef.scrollHeight}px`;
    bodyRef.style.opacity = "1";
    bodyRef.style.overflow = "hidden";
    rafA = requestAnimationFrame(() => {
      if (!bodyRef) return;
      bodyRef.style.maxHeight = "0px";
      bodyRef.style.opacity = "0";
    });
  };

  createEffect(() => {
    const isOpen = props.open;
    if (!mounted()) {
      setRenderBody(isOpen);
      return;
    }
    clearRafs();
    if (isOpen) {
      setRenderBody(true);
      rafA = requestAnimationFrame(() => animateOpen());
      return;
    }
    animateClose();
  });

  onMount(() => setMounted(true));
  onCleanup(clearRafs);

  const handleBodyTransitionEnd = (event: TransitionEvent) => {
    if (!bodyRef) return;
    if (event.target !== bodyRef) return;
    if (event.propertyName !== "max-height") return;
    if (props.open) {
      bodyRef.style.maxHeight = "none";
      bodyRef.style.opacity = "1";
      bodyRef.style.overflow = "visible";
      return;
    }
    setRenderBody(false);
  };

  return (
    <div class={`rounded-lg ${props.class ?? ""}`} id={props.id}>
      <button
        type="button"
        onClick={() => props.onToggle()}
        class={`relative flex w-full cursor-pointer items-center justify-between gap-4 overflow-hidden border border-gray-200 px-4 py-3 text-left shadow-sm backdrop-blur-sm transition ${headerBg()} ${sticky()} ${
          props.open ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <div class={`absolute left-0 top-0 h-full w-1 ${gradient()}`} />
        <div class="min-w-0 flex-1">{props.header}</div>
        <Show when={showChevron()}>
          <TbOutlineChevronDown
            class={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${
              props.open ? "rotate-180" : ""
            }`}
          />
        </Show>
      </button>
      <Show when={renderBody()}>
        <div
          ref={(el) => {
            bodyRef = el;
            if (props.open) {
              if (mounted()) {
                // For opens after initial render, start collapsed so animation is smooth.
                bodyRef.style.maxHeight = "0px";
                bodyRef.style.opacity = "0";
                bodyRef.style.overflow = "hidden";
              } else {
                // Initial open state should render fully expanded without animation.
                bodyRef.style.maxHeight = "none";
                bodyRef.style.opacity = "1";
                bodyRef.style.overflow = "visible";
              }
            } else {
              bodyRef.style.maxHeight = "0px";
              bodyRef.style.opacity = "0";
              bodyRef.style.overflow = "hidden";
            }
          }}
          onTransitionEnd={(event) =>
            handleBodyTransitionEnd(event as TransitionEvent)
          }
          class="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
        >
          <div
            ref={bodyInnerRef}
            class="relative overflow-hidden rounded-b-lg border border-t-0 border-gray-200 bg-white"
          >
            <div class={`absolute left-0 top-0 h-full w-1 opacity-30 ${gradient()}`} />
            {props.children}
          </div>
        </div>
      </Show>
    </div>
  );
};
