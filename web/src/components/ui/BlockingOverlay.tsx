import { Component, Show } from "solid-js";
import { Spinner } from "./Spinner";

type BlockingOverlayProps = {
  open: boolean;
  title: string;
  message?: string;
  zIndexClass?: string;
};

export const BlockingOverlay: Component<BlockingOverlayProps> = (props) => {
  return (
    <Show when={props.open}>
      <div
        class={`fixed inset-0 flex items-center justify-center bg-black/40 px-4 ${
          props.zIndexClass || "z-[90]"
        }`}
      >
        <div class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
          <div class="flex items-center gap-3">
            <Spinner class="h-5 w-5 text-admin-from" />
            <h3 class="text-lg font-semibold text-gray-900">{props.title}</h3>
          </div>
          <Show when={props.message}>
            <p class="mt-3 text-base text-gray-600">{props.message}</p>
          </Show>
        </div>
      </div>
    </Show>
  );
};
