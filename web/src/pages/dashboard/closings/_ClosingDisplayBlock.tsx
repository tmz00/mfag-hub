import { Component, For, Show, type JSX } from "solid-js";
import type { ClosingDisplayModel } from "./_closingDisplay";

type Props = {
  model: ClosingDisplayModel;
  rightAction?: JSX.Element;
};

const ClosingDisplayBlock: Component<Props> = (props) => {
  return (
    <div class="space-y-1">
      <div class="flex items-center justify-between gap-3">
        <div class="font-bold text-gray-900 text-base">{props.model.headerLine}</div>
        <Show when={props.rightAction}>{props.rightAction}</Show>
      </div>

      <For each={props.model.productLines}>
        {(line) => <div class="text-sm text-gray-700 pl-3">{line}</div>}
      </For>

      <div class="text-sm text-gray-600 pl-3 space-y-0.5">
        <div>{props.model.afypLine}</div>
        <Show when={props.model.sourceLine}>
          <div>{props.model.sourceLine}</div>
        </Show>
        <Show when={props.model.referralsLine}>
          <div class="flex items-center justify-between gap-3">
            <span>{props.model.referralsLine}</span>
            <Show when={props.model.timeLabel}>
              <span class="italic text-gray-500">{props.model.timeLabel}</span>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default ClosingDisplayBlock;
