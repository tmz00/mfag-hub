import type { Component } from "solid-js";
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { TbOutlineArrowUp } from "solid-icons/tb";
import { Button } from "./Button";

type BackToTopFabProps = {
  threshold?: number;
  bottomClass?: string;
  rightClass?: string;
  class?: string;
  label?: string;
};

export const BackToTopFab: Component<BackToTopFabProps> = (props) => {
  const [visible, setVisible] = createSignal(false);
  const threshold = () => props.threshold ?? 280;
  const bottomClass = () => props.bottomClass ?? "bottom-4";
  const rightClass = () => props.rightClass ?? "right-4";
  const label = () => props.label ?? "Back to Top";

  onMount(() => {
    const onScroll = () => {
      setVisible(window.scrollY > threshold());
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => {
      window.removeEventListener("scroll", onScroll);
    });
  });

  return (
    <Show when={visible()}>
      <Button
        variant="primary"
        size="sm"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        class={`fixed ${rightClass()} ${bottomClass()} z-50 ${props.class ?? ""}`}
      >
        <TbOutlineArrowUp class="h-4 w-4" />
        {label()}
      </Button>
    </Show>
  );
};
