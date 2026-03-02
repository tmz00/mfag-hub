import { Component, Show, createSignal, onCleanup, onMount } from "solid-js";
import { useBeforeLeave } from "@solidjs/router";
import { Button } from "./Button";
import { VsSave } from "solid-icons/vs";
import { ConfirmModal } from "./ConfirmModal";
import { PageHeader } from "./PageHeader";
import { createScrollLock } from "./createScrollLock";
import { Spinner } from "./Spinner";

type EditModalProps = {
  title: string;
  onClose: () => void;
  onSave?: () => void;
  saving?: () => boolean;
  saveDisabled?: boolean;
  saveVariant?:
    | "primary"
    | "primaryOutline"
    | "secondary"
    | "admin"
    | "adminOutline"
    | "danger"
    | "dangerSolid"
    | "ghost";
  saveLabel?: string;
  savingLabel?: string;
  maxWidthClass?: string;
  bodyClass?: string;
  footerLeft?: any;
  footerSticky?: boolean;
  children: any;
  /** Function that returns true if there are unsaved changes */
  hasUnsavedChanges?: () => boolean;
  /** Custom prompt text for unsaved changes confirmation */
  discardPrompt?: string;
  /** Push a dummy browser history entry and close on Back */
  manageHistoryEntry?: boolean;
  /** Hide back button in the header */
  hideBackButton?: boolean;
};

export const EditModal: Component<EditModalProps> = (props) => {
  createScrollLock(() => true);

  const maxWidthClass = () => props.maxWidthClass || "max-w-7xl";
  const bodyClass = () => props.bodyClass || "pb-6 pt-4 px-4";
  const saveLabel = () => props.saveLabel || "Save";
  const saveVariant = () => props.saveVariant || "admin";
  const savingLabel = () => props.savingLabel || "Saving...";
  const saving = () => (props.saving ? props.saving() : false);
  const discardPrompt = () =>
    props.discardPrompt || "You have unsaved changes that will be lost.";

  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [allowNextLeave, setAllowNextLeave] = createSignal(false);
  let hasHistoryEntry = false;
  let closedByPopstate = false;
  let suppressPopstateClose = false;
  let navigatedAway = false;
  let historyEntryToken: string | null = null;
  let onPopState: (() => void) | undefined;
  let resolveConfirm: ((value: boolean) => void) | null = null;

  const confirmDiscard = () => {
    setConfirmOpen(true);
    return new Promise<boolean>((r) => {
      resolveConfirm = r;
    });
  };

  const onConfirmDiscard = () => {
    setConfirmOpen(false);
    resolveConfirm?.(true);
    resolveConfirm = null;
  };

  const onCancelDiscard = () => {
    setConfirmOpen(false);
    resolveConfirm?.(false);
    resolveConfirm = null;
  };

  const handleClose = async () => {
    if (props.hasUnsavedChanges?.() && !(await confirmDiscard())) {
      return;
    }
    setAllowNextLeave(true);
    if (props.manageHistoryEntry && hasHistoryEntry && !closedByPopstate) {
      const state = window.history.state as
        | { __editModalToken?: string }
        | null;
      if (state?.__editModalToken === historyEntryToken) {
        suppressPopstateClose = true;
        window.history.back();
      }
    }
    props.onClose();
  };

  useBeforeLeave((event) => {
    if (allowNextLeave()) {
      navigatedAway = true;
      setAllowNextLeave(false);
      return;
    }
    if (!props.hasUnsavedChanges?.()) {
      navigatedAway = true;
      return;
    }
    event.preventDefault();
    setTimeout(() => {
      confirmDiscard().then((confirmed) => {
        if (!confirmed) return;
        navigatedAway = true;
        event.retry(true);
      });
    }, 100);
  });

  const hasFooter = () => Boolean(props.onSave);
  const hasFooterLeft = () => Boolean(props.footerLeft);
  const footerSticky = () => props.footerSticky === true;
  const [headerHeight, setHeaderHeight] = createSignal(0);
  const [footerHeight, setFooterHeight] = createSignal(0);
  let headerRef: HTMLDivElement | undefined;
  let footerRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const updateHeights = () => {
    setHeaderHeight(headerRef?.offsetHeight || 0);
    setFooterHeight(footerRef?.offsetHeight || 0);
  };

  onMount(() => {
    onPopState = () => {
      if (!props.manageHistoryEntry || !hasHistoryEntry) return;
      if (suppressPopstateClose) return;
      const state = window.history.state as
        | { __editModalToken?: string }
        | null;
      if (state?.__editModalToken === historyEntryToken) return;
      closedByPopstate = true;
      props.onClose();
    };

    if (props.manageHistoryEntry) {
      historyEntryToken = `edit-modal-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      hasHistoryEntry = true;
      window.history.pushState(
        {
          ...(window.history.state || {}),
          __editModalToken: historyEntryToken,
        },
        "",
      );
      window.addEventListener("popstate", onPopState);
    }

    updateHeights();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateHeights);
      if (headerRef) resizeObserver.observe(headerRef);
      if (footerRef) resizeObserver.observe(footerRef);
    }
    window.addEventListener("resize", updateHeights);
  });

  onCleanup(() => {
    if (props.manageHistoryEntry) {
      if (onPopState) {
        window.removeEventListener("popstate", onPopState);
      }
      if (hasHistoryEntry && !closedByPopstate && !suppressPopstateClose && !navigatedAway) {
        const state = window.history.state as
          | { __editModalToken?: string }
          | null;
        if (state?.__editModalToken === historyEntryToken) {
          suppressPopstateClose = true;
          window.history.back();
        }
      }
    }

    resizeObserver?.disconnect();
    resizeObserver = undefined;
    window.removeEventListener("resize", updateHeights);
  });

  return (
    <div
      data-disable-pull-refresh="true"
      class="fixed inset-0 z-50 flex min-h-dvh flex-col bg-white"
      style={{
        "--edit-modal-header-height": `${headerHeight()}px`,
        "--edit-modal-footer-height": `${footerHeight()}px`,
      }}
    >
      <div ref={headerRef}>
        <PageHeader
          variant="plain"
          onBack={props.hideBackButton ? undefined : handleClose}
          subtitle={props.title}
          class="sticky top-0 z-10"
          maxWidthClass={maxWidthClass()}
        />
      </div>

      <div
        data-scroll-lock-allow-touch="true"
        class={`flex-1 overflow-y-auto px-4 bg-gray-50 ${bodyClass()}`}
      >
        <div class={`mx-auto flex min-h-full w-full flex-col ${maxWidthClass()}`}>
          {props.children}

          <Show when={hasFooter()}>
            <div
              ref={footerRef}
              class={`pt-6 pb-4 ${footerSticky() ? "sticky bottom-0 bg-gray-50" : ""}`}
            >
              <div class="flex w-full items-center justify-center gap-2">
                <Show when={hasFooterLeft()}>
                  <div class="flex items-center">{props.footerLeft}</div>
                </Show>
                <Button
                  variant={saveVariant()}
                  onClick={props.onSave}
                  disabled={props.saveDisabled}
                  size="lg"
                >
                  <Show when={saving()}>
                    <Spinner class="h-4 w-4 text-current" />
                  </Show>
                  {saving() ? savingLabel() : saveLabel()}
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen()}
        title="Unsaved changes"
        message={discardPrompt()}
        confirmLabel="Leave"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={onConfirmDiscard}
        onCancel={onCancelDiscard}
      />
    </div>
  );
};
