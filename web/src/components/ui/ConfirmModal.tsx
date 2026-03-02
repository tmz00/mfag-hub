import { Component, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { createScrollLock } from "./createScrollLock";
import { Spinner } from "./Spinner";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message?: any;
  confirmLabel?: string;
  cancelLabel?: string;
  hideCancel?: boolean;
  variant?: "danger" | "default" | "admin";
  confirmLoading?: boolean;
  confirmLoadingLabel?: string;
  disableCancelWhileLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmModal: Component<ConfirmModalProps> = (props) => {
  createScrollLock(() => props.open);

  const confirmLabel = () => props.confirmLabel || "Confirm";
  const cancelLabel = () => props.cancelLabel || "Cancel";
  const isDanger = () => props.variant === "danger";
  const hideCancel = () => props.hideCancel === true;
  const confirmLoading = () => props.confirmLoading === true;
  const confirmLoadingLabel = () => props.confirmLoadingLabel || "Working...";
  const disableCancelWhileLoading = () =>
    props.disableCancelWhileLoading !== false;
  const [selectedAction, setSelectedAction] = createSignal<
    "cancel" | "confirm"
  >("confirm");
  let cancelButtonRef: HTMLButtonElement | undefined;
  let confirmButtonRef: HTMLButtonElement | undefined;

  createEffect(() => {
    if (!props.open) return;
    setSelectedAction(hideCancel() ? "confirm" : "cancel");
  });

  createEffect(() => {
    if (!props.open) return;
    const action = selectedAction();
    if (action === "cancel" && cancelButtonRef) {
      cancelButtonRef.focus();
      return;
    }
    if (confirmButtonRef) {
      confirmButtonRef.focus();
    }
  });

  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (hideCancel()) return;
        if (confirmLoading() && disableCancelWhileLoading()) return;
        event.preventDefault();
        event.stopPropagation();
        props.onCancel();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (hideCancel()) {
          setSelectedAction("confirm");
        } else {
          setSelectedAction((prev) =>
            prev === "confirm" ? "cancel" : "confirm",
          );
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "Enter") {
        if (confirmLoading()) return;
        event.preventDefault();
        event.stopPropagation();
        if (selectedAction() === "cancel" && !hideCancel()) {
          props.onCancel();
          return;
        }
        props.onConfirm();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown, true);
    });
  });

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div class="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
          <h3 class="text-lg font-semibold text-slate-900">{props.title}</h3>
          <Show when={props.message}>
            <p class="mt-2 text-base text-slate-600">{props.message}</p>
          </Show>
          <div class="mt-5 flex justify-end gap-3">
            <Show when={!hideCancel()}>
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => {
                  if (confirmLoading() && disableCancelWhileLoading()) return;
                  setSelectedAction("cancel");
                  props.onCancel();
                }}
                disabled={confirmLoading() && disableCancelWhileLoading()}
                class="cursor-pointer rounded-xl border border-slate-300 px-4 py-2 text-base font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelLabel()}
              </button>
            </Show>
            <button
              ref={confirmButtonRef}
              type="button"
              onClick={() => {
                if (confirmLoading()) return;
                setSelectedAction("confirm");
                props.onConfirm();
              }}
              disabled={confirmLoading()}
              class={`cursor-pointer rounded-xl px-4 py-2 text-base font-semibold text-white transition ${
                isDanger()
                  ? "bg-red-600 hover:bg-red-700"
                  : props.variant === "admin"
                    ? "bg-admin-from hover:bg-admin-to"
                    : "bg-primary hover:bg-primary/90"
              } disabled:cursor-not-allowed disabled:opacity-80`}
            >
              <span class="inline-flex items-center gap-2">
                <Show when={confirmLoading()}>
                  <Spinner class="h-4 w-4 text-current" />
                </Show>
                {confirmLoading() ? confirmLoadingLabel() : confirmLabel()}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

// Built-in presets keyed by title
const confirmPresets: Record<string, {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "danger" | "default" | "admin";
}> = {
  "Unsaved changes": {
    message: "You have unsaved changes that will be lost.",
    confirmLabel: "Leave",
    cancelLabel: "Keep editing",
    variant: "danger",
  },
};

/**
 * Creates a signal-based confirm helper.
 * Returns [modal JSX getter, confirm function].
 *
 * Titles that match a built-in preset (e.g. "Unsaved changes") will
 * auto-fill message, confirmLabel, cancelLabel, and variant — you only
 * need to pass `{ title }`. Explicit values always override the preset.
 *
 * Usage:
 *   const [DiscardModal, confirmDiscard] = createConfirm({
 *     title: "Unsaved changes",
 *   });
 *
 *   // In handler:
 *   const confirmed = await confirmDiscard();
 *   if (confirmed) { ... }
 *
 *   // In JSX:
 *   <DiscardModal />
 */
export function createConfirm(input: {
  title: string;
  message?: any;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default" | "admin";
  hideCancel?: boolean;
}) {
  const preset = confirmPresets[input.title];
  const defaults = {
    title: input.title,
    message: input.message ?? preset?.message,
    confirmLabel: input.confirmLabel ?? preset?.confirmLabel,
    cancelLabel: input.cancelLabel ?? preset?.cancelLabel,
    variant: input.variant ?? preset?.variant,
    hideCancel: input.hideCancel ?? false,
  };

  const [open, setOpen] = createSignal(false);
  const [activeTitle, setActiveTitle] = createSignal(defaults.title);
  const [activeMessage, setActiveMessage] = createSignal<any>(defaults.message);
  let resolve: ((value: boolean) => void) | null = null;

  const confirm = (overrides?: { title?: string; message?: any }) => {
    setActiveTitle(overrides?.title ?? defaults.title);
    setActiveMessage(overrides?.message ?? defaults.message);
    setOpen(true);
    return new Promise<boolean>((r) => {
      resolve = r;
    });
  };

  const onConfirm = () => {
    setOpen(false);
    resolve?.(true);
    resolve = null;
  };

  const onCancel = () => {
    setOpen(false);
    resolve?.(false);
    resolve = null;
  };

  const Modal: Component = () => (
    <ConfirmModal
      open={open()}
      title={activeTitle()}
      message={activeMessage()}
      confirmLabel={defaults.confirmLabel}
      cancelLabel={defaults.cancelLabel}
      variant={defaults.variant}
      hideCancel={defaults.hideCancel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );

  return [Modal, confirm] as const;
}
