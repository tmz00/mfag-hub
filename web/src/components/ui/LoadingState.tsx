import type { Component } from "solid-js";
import { Spinner } from "./Spinner";

type LoadingStateProps = {
  label?: string;
  class?: string;
  spinnerClass?: string;
};

export const LoadingState: Component<LoadingStateProps> = (props) => {
  return (
    <div
      class={`flex items-center justify-center gap-2 text-base text-gray-600 ${props.class || ""}`}
    >
      <Spinner class={props.spinnerClass || "h-5 w-5 text-gray-400"} />
      <span>{props.label || "Loading..."}</span>
    </div>
  );
};
