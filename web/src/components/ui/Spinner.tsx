import type { Component } from "solid-js";
import { TbOutlineLoader2 } from "solid-icons/tb";

type SpinnerProps = {
  class?: string;
  ariaLabel?: string;
};

export const Spinner: Component<SpinnerProps> = (props) => {
  return (
    <TbOutlineLoader2
      class={`animate-spin text-gray-400 ${props.class || "h-5 w-5"}`}
      role="status"
      aria-label={props.ariaLabel || "Loading"}
    />
  );
};

