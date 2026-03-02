import { Component, createSignal } from "solid-js";
import { useBeforeLeave } from "@solidjs/router";
import { ConfirmModal } from "./ConfirmModal";

/**
 * Creates a navigation guard that intercepts browser back/forward buttons
 * and shows a custom confirm modal when there are unsaved changes.
 *
 * Usage:
 *   const { GuardModal, guardNavigate, skipGuard } = createNavigationGuard(() => hasUnsavedChanges());
 *
 *   // Cancel/back:
 *   const handleCancel = () => guardNavigate(() => navigate(-1));
 *
 *   // After save:
 *   skipGuard(); navigate(-1);
 *
 *   // JSX:
 *   <GuardModal />
 */
export function createNavigationGuard(hasUnsavedChanges: () => boolean) {
  const [open, setOpen] = createSignal(false);
  let resolve: ((value: boolean) => void) | null = null;
  let skipped = false;

  const confirmDiscard = () => {
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

  const skipGuard = () => {
    skipped = true;
  };

  const guardNavigate = async (fn: () => void) => {
    if (!hasUnsavedChanges() || (await confirmDiscard())) {
      skipped = true;
      fn();
    }
  };

  useBeforeLeave((event) => {
    if (skipped || !hasUnsavedChanges()) return;
    event.preventDefault();
    setTimeout(() => {
      confirmDiscard().then((confirmed) => {
        if (!confirmed) return;
        skipped = true;
        event.retry(true);
      });
    }, 100);
  });

  const GuardModal: Component = () => (
    <ConfirmModal
      open={open()}
      title="Unsaved changes"
      message="You have unsaved changes that will be lost."
      confirmLabel="Leave"
      cancelLabel="Keep editing"
      variant="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );

  return { GuardModal, guardNavigate, skipGuard };
}
