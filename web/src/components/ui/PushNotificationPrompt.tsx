import { Show, createSignal, onCleanup, onMount, type Component } from "solid-js";
import { authService } from "../../services/authService";
import { pushService } from "../../services/pushService";

type PushNotificationPromptProps = {
  disabled?: boolean;
  maxWidthClass?: string;
};

// sessionStorage key used to throttle Android permission-change reloads
const ANDROID_RELOAD_TS_KEY = "mfag_perm_reload_ts";

export const PushNotificationPrompt: Component<PushNotificationPromptProps> = (props) => {
  const [showPushPrompt, setShowPushPrompt] = createSignal(false);
  const [pushPermission, setPushPermission] = createSignal<NotificationPermission>(
    "default"
  );
  const [pushEnabling, setPushEnabling] = createSignal(false);

  const isMobileClient = (): boolean => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const isIOS =
      /iPhone|iPod/i.test(ua) ||
      /iPad/i.test(ua) ||
      (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    return isIOS || isAndroid;
  };

  const isAndroid = (): boolean => {
    if (typeof navigator === "undefined") return false;
    return /Android/i.test(navigator.userAgent || "");
  };

  const refreshPromptState = async (): Promise<void> => {
    if (props.disabled) {
      setShowPushPrompt(false);
      return;
    }
    if (!isMobileClient()) {
      setShowPushPrompt(false);
      return;
    }
    if (!authService.getCurrentUser()) {
      setShowPushPrompt(false);
      return;
    }
    if (!pushService.isSupported()) {
      setShowPushPrompt(false);
      return;
    }

    const permission = await pushService.getPermissionFresh();
    setPushPermission(permission);
    if (permission !== "granted") {
      setShowPushPrompt(true);
      return;
    }

    const hasSubscription = await pushService.hasBrowserSubscription();
    setShowPushPrompt(!hasSubscription);
  };

  const handleEnablePush = async (): Promise<void> => {
    setPushEnabling(true);
    try {
      await pushService.syncSubscription({ askPermission: true });
    } catch (error) {
      console.error("Failed to enable push notifications", error);
    } finally {
      setPushEnabling(false);
      await refreshPromptState();
    }
  };

  onMount(() => {
    let active = true;
    let foregroundRetryTimers: number[] = [];
    let permissionStatus: PermissionStatus | null = null;
    let visiblePollInterval: number | undefined;
    // Track whether the prompt was visible when we went to background (Android reload heuristic)
    let hiddenWhilePromptShowing = false;

    const safeRefresh = async () => {
      if (!active) return;
      await refreshPromptState();
    };

    const clearForegroundRetryTimers = () => {
      for (const timer of foregroundRetryTimers) {
        window.clearTimeout(timer);
      }
      foregroundRetryTimers = [];
    };

    const stopVisiblePoll = () => {
      if (visiblePollInterval !== undefined) {
        window.clearInterval(visiblePollInterval);
        visiblePollInterval = undefined;
      }
    };

    const startVisiblePoll = () => {
      stopVisiblePoll();
      visiblePollInterval = window.setInterval(() => {
        if (!active) return;
        if (document.visibilityState !== "visible") return;
        void safeRefresh();
      }, 2500);
    };

    const refreshOnForeground = () => {
      clearForegroundRetryTimers();
      const retryDelaysMs = [0, 400, 1200, 2800];
      for (const delay of retryDelaysMs) {
        const timer = window.setTimeout(() => {
          if (!active) return;
          void safeRefresh();
        }, delay);
        foregroundRetryTimers.push(timer);
      }
    };

    // On Android, Notification.permission stays stale after OS-level changes for the
    // entire lifetime of the page — no JS probe can read the real OS state. The only
    // reliable fix is a page reload. We trigger one (throttled) when the user returns
    // from the background while the permission prompt is showing (strong signal they
    // visited Settings to change something).
    const maybeReloadForAndroidPermission = (): boolean => {
      if (!isAndroid() || !hiddenWhilePromptShowing) return false;
      try {
        const last = Number(sessionStorage.getItem(ANDROID_RELOAD_TS_KEY) || 0);
        if (Date.now() - last < 20_000) return false; // throttle: once per 20 s
        sessionStorage.setItem(ANDROID_RELOAD_TS_KEY, String(Date.now()));
      } catch {
        // sessionStorage unavailable — skip throttle check
      }
      location.reload();
      return true;
    };

    void safeRefresh();

    const unsubscribe = authService.onAuthStateChanged(() => {
      void safeRefresh();
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Record whether the prompt was up so we know if a reload is worthwhile on return
        hiddenWhilePromptShowing = showPushPrompt();
      } else if (document.visibilityState === "visible") {
        if (maybeReloadForAndroidPermission()) return; // page will reload
        hiddenWhilePromptShowing = false;
        refreshOnForeground();
      }
    };
    const handlePermissionChange = () => refreshOnForeground();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refreshOnForeground);
    window.addEventListener("pageshow", refreshOnForeground);
    document.addEventListener("resume", handleVisibilityChange as EventListener);
    startVisiblePoll();

    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: "notifications" as PermissionName })
        .then((status) => {
          if (!active) return;
          permissionStatus = status;
          permissionStatus.addEventListener("change", handlePermissionChange);
        })
        .catch(() => undefined);
    }

    // Listen for pushsubscriptionchange broadcast from the service worker
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "pushsubscriptionchange") {
        void safeRefresh();
      }
    };
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleSwMessage);
    }

    onCleanup(() => {
      active = false;
      clearForegroundRetryTimers();
      stopVisiblePoll();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refreshOnForeground);
      window.removeEventListener("pageshow", refreshOnForeground);
      document.removeEventListener("resume", handleVisibilityChange as EventListener);
      permissionStatus?.removeEventListener("change", handlePermissionChange);
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleSwMessage);
      }
      unsubscribe && unsubscribe();
    });
  });

  const maxWidthClass = () => props.maxWidthClass || "max-w-7xl";
  const isBlocked = () => pushPermission() === "denied";

  return (
    <Show when={showPushPrompt()}>
      <div
        class={`mx-auto w-full ${maxWidthClass()} px-4 pt-3`}
        data-disable-pull-refresh="true"
      >
        <div
          class={`flex rounded-xl border border-primary/30 bg-linear-to-r from-primary-600 to-secondary-600 px-4 py-3 text-base text-white shadow-lg ${
            isBlocked()
              ? "flex-col items-center gap-3 text-center"
              : "items-center justify-between gap-4"
          }`}
        >
          <div class={`flex flex-col ${isBlocked() ? "items-center" : ""}`}>
            <span class="font-semibold text-white">Enable push notifications</span>
            <span class="text-sm text-white/85">
              Important updates may be missed if notifications are off.
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleEnablePush()}
            disabled={pushEnabling() || pushPermission() === "denied"}
            class={`items-center rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-primary hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60 ${
              isBlocked() ? "mx-auto" : ""
            }`}
          >
            {pushPermission() === "denied"
              ? "Blocked in device settings. Please enable manually."
              : pushEnabling()
                ? "Enabling..."
                : "Enable"}
          </button>
        </div>
      </div>
    </Show>
  );
};
