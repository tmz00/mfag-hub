import {
  Route,
  Router,
  Navigate,
  useLocation,
  useNavigate,
  type RouteSectionProps,
} from "@solidjs/router";
import {
  ParentComponent,
  Component,
  Suspense,
  lazy,
  Show,
  createSignal,
  createEffect,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { Portal } from "solid-js/web";
import { registerSW } from "virtual:pwa-register";

import { teamService } from "./services/teamService";
import { authService } from "./services/authService";
import { pushService } from "./services/pushService";
import { Button, Spinner } from "./components/ui";
import Team from "./pages/dashboard/team/Team";
import Closings from "./pages/dashboard/closings/Closings";
import Products from "./pages/dashboard/products/Products";

const Login = lazy(() => import("./pages/auth/Login"));
const OtpSignIn = lazy(() => import("./pages/auth/OtpSignIn"));
const Install = lazy(() => import("./pages/Install"));
const Dashboard = lazy(() => import("./pages/dashboard/Dashboard"));
const CompleteProfile = lazy(() => import("./pages/auth/CompleteProfile"));
const Settings = lazy(() => import("./pages/dashboard/settings/Settings"));
const EditProfile = lazy(() => import("./pages/dashboard/settings/EditProfile"));
const ManageHandbook = lazy(() => import("./pages/admin/handbook/ManageHandbook"));
const HandbookView = lazy(
  () => import("./pages/dashboard/handbook/HandbookView"),
);
const HandbookSearch = lazy(
  () => import("./pages/dashboard/handbook/HandbookSearch"),
);
const ManageProducts = lazy(() => import("./pages/admin/products/ManageProducts"));
const BMI = lazy(() => import("./pages/dashboard/tools/BMI"));
const CompoundEffect = lazy(() => import("./pages/dashboard/tools/CompoundEffect"));
const DelayTax = lazy(() => import("./pages/dashboard/tools/DelayTax"));
const ManageTeam = lazy(() => import("./pages/admin/team/ManageTeam"));
const SubmitClosing = lazy(
  () => import("./pages/dashboard/closings/SubmitClosing/SubmitClosing"),
);
const PlanEditor = lazy(
  () => import("./pages/dashboard/closings/SubmitClosing/PlanEditor"),
);
const ManageSources = lazy(() => import("./pages/admin/sources/ManageSources"));
const Reports = lazy(() => import("./pages/admin/reports/GenerateReports"));
const ManageReports = lazy(() => import("./pages/admin/reports/ManageReportTemplates"));
const Admin = lazy(() => import("./pages/admin/Admin"));
const Notifications = lazy(() => import("./pages/dashboard/notifications/Notifications"));
const NotificationDetail = lazy(
  () => import("./pages/dashboard/notifications/NotificationDetail"),
);
const ManageNotifications = lazy(
  () => import("./pages/admin/notifications/ManageNotifications"),
);
const Backups = lazy(() => import("./pages/admin/backups/ManageBackups"));
const NotFound = lazy(() => import("./pages/NotFound"));

const isMobileDevice = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPod/.test(ua);
  const isIPadOS =
    /iPad/.test(ua) ||
    (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  return isIOS || isIPadOS || isAndroid;
};

const PageLoading: Component = () => (
  <div class="flex min-h-dvh items-center justify-center bg-linear-to-b from-gray-50 to-primary/5">
    <div class="flex flex-col items-center gap-3">
      <Spinner class="h-12 w-12 text-primary" />
      <div class="text-base font-semibold text-primary">Loading…</div>
    </div>
  </div>
);

const RouteLoadingFallback: Component<{ delayMs?: number }> = (props) => {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    const timer = window.setTimeout(() => setVisible(true), props.delayMs ?? 120);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <Show when={visible()}>
      <Portal>
        <div class="fixed inset-0 z-[90] flex items-center justify-center bg-linear-to-b from-gray-50 to-primary/5">
          <div class="flex flex-col items-center gap-3">
            <Spinner class="h-10 w-10 text-primary" />
            <div class="text-base font-semibold text-primary">Loading…</div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

const RouteTransitionRoot: Component<RouteSectionProps> = (props) => {
  const [isEntering, setIsEntering] = createSignal(false);
  let clearEnterTimer: number | undefined;

  onMount(() => {
    setIsEntering(true);
    clearEnterTimer = window.setTimeout(() => setIsEntering(false), 220);
  });

  createEffect(
    on(
      () =>
        `${props.location.pathname}${props.location.search}${props.location.hash}${props.location.key}`,
      () => {
        setIsEntering(false);
        requestAnimationFrame(() => setIsEntering(true));

        if (clearEnterTimer) window.clearTimeout(clearEnterTimer);
        clearEnterTimer = window.setTimeout(() => setIsEntering(false), 220);
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    if (clearEnterTimer) window.clearTimeout(clearEnterTimer);
  });

  return (
    <div class={`route-transition-shell ${isEntering() ? "route-transition-enter" : ""}`}>
      {props.children}
    </div>
  );
};

const HomeRedirect: Component<{ authed: () => boolean }> = (props) => {
  const navigate = useNavigate();

  onMount(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone;
    const isMobile = isMobileDevice();

    if (!props.authed() && (!isMobile || isStandalone)) {
      navigate("/login", { replace: true });
    }
  });

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Show when={props.authed()} fallback={<Install />}>
        <Protected>
          <Dashboard />
        </Protected>
      </Show>
    </Suspense>
  );
};

const Protected: ParentComponent<{ allowIncomplete?: boolean }> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = createSignal(false);
  const [authed, setAuthed] = createSignal(false);
  const [profileComplete, setProfileComplete] = createSignal(false);

  const getProfileStatus = async (uid: string) => {
    try {
      const data = await teamService.getUserProfile(uid);
      if (!data) return { complete: true, hasFsc: true };
      const fscCode = String(data.fscCode || "").trim();
      if (!fscCode) return { complete: true, hasFsc: true };
      const nickname = String(data.nickname || "").trim();
      const agencyCode = String(data.agencyCode || "").trim();
      const hasBirth = Boolean(data.birthYear && data.birthMonth && data.birthDay);
      const hasContract = Boolean(
        data.contractYear && data.contractMonth && data.contractDay,
      );
      return {
        complete: Boolean(nickname && agencyCode && hasBirth && hasContract),
        hasFsc: true,
      };
    } catch (err) {
      console.error("Profile completeness check failed", err);
      return { complete: true, hasFsc: true };
    }
  };

  onMount(() => {
    const unsub = authService.onAuthStateChanged(async (user) => {
      if (!user) {
        setAuthed(false);
        setProfileComplete(false);
        setReady(true);
        navigate("/", { replace: true });
        return;
      }

      setAuthed(true);
      const status = await getProfileStatus(user.uid);
      if (!status.hasFsc) {
        setAuthed(false);
        setProfileComplete(false);
        setReady(true);
        await authService.signOut();
        return;
      }

      setProfileComplete(status.complete);
      setReady(true);

      const onCompleteProfilePage = location.pathname === "/complete-profile";

      if (!status.complete && !props.allowIncomplete && !onCompleteProfilePage) {
        navigate("/complete-profile", { replace: true });
      }
      if (status.complete && onCompleteProfilePage && !props.allowIncomplete) {
        navigate("/", { replace: true });
      }
    });
    onCleanup(() => unsub && unsub());
  });

  return (
    <Show
      when={ready() && authed() && (props.allowIncomplete || profileComplete())}
    >
      {props.children}
    </Show>
  );
};

type PushGateReason =
  | "permission-default"
  | "permission-denied"
  | "subscription-missing"
  | "verification-failed";

const App: Component = () => {
  const [authReady, setAuthReady] = createSignal(false);
  const [authed, setAuthed] = createSignal(false);
  const [needRefresh, setNeedRefresh] = createSignal(false);
  const [isUpdating, setIsUpdating] = createSignal(false);
  const [pushGateOpen, setPushGateOpen] = createSignal(false);
  const [pushGateResolved, setPushGateResolved] = createSignal(true);
  const [pushGateChecking, setPushGateChecking] = createSignal(false);
  const [pushGateActionBusy, setPushGateActionBusy] = createSignal(false);
  const [pushGateReason, setPushGateReason] = createSignal<PushGateReason | null>(
    null,
  );
  const [pushGateMessage, setPushGateMessage] = createSignal("");
  const [updateServiceWorker, setUpdateServiceWorker] = createSignal<
    ((reloadPage?: boolean) => Promise<void>) | null
  >(null);
  let updateCheckInterval: number | undefined;
  let pushGateCheckRun = 0;
  const openPushGate = (reason: PushGateReason, message: string) => {
    setPushGateReason(reason);
    setPushGateMessage(message);
    setPushGateOpen(true);
  };

  const closePushGate = () => {
    setPushGateOpen(false);
    setPushGateReason(null);
    setPushGateMessage("");
  };

  const evaluatePushCompliance = async (options?: {
    askPermission?: boolean;
    blockUi?: boolean;
  }) => {
    const runId = ++pushGateCheckRun;
    const blockUi = Boolean(options?.blockUi);
    const showCheckingState = blockUi || Boolean(options?.askPermission);
    const user = authService.getCurrentUser();
    if (!user) {
      if (runId === pushGateCheckRun) {
        closePushGate();
        setPushGateChecking(false);
        setPushGateResolved(true);
      }
      return true;
    }

    // Desktop users are not required to enable push notifications.
    if (!isMobileDevice()) {
      if (runId === pushGateCheckRun) {
        closePushGate();
        setPushGateChecking(false);
        setPushGateResolved(true);
      }
      return true;
    }

    if (blockUi) {
      setPushGateResolved(false);
    }

    if (showCheckingState) {
      setPushGateChecking(true);
    }
    let promptedSync = false;

    try {
      if (!pushService.isSupported()) {
        if (runId === pushGateCheckRun) {
          closePushGate();
          setPushGateResolved(true);
        }
        return true;
      }

      if (options?.askPermission) {
        promptedSync = await pushService.syncSubscription({ askPermission: true });
      }

      const permission = await pushService.getPermissionFresh();
      if (permission === "default") {
        if (runId === pushGateCheckRun) {
          openPushGate(
            "permission-default",
            "Push notifications are mandatory for this app. Tap Enable Notifications to continue. If you changed this in device settings, close and reopen the app."
          );
        }
        return false;
      }

      if (permission === "denied") {
        if (runId === pushGateCheckRun) {
          openPushGate(
            "permission-denied",
            "Notifications are blocked in device settings. Enable notifications, then close and reopen the app."
          );
        }
        return false;
      }

      const synced =
        promptedSync || (await pushService.syncSubscription({ askPermission: false }));
      const hasSubscription = synced || (await pushService.hasBrowserSubscription());
      if (!hasSubscription) {
        if (runId === pushGateCheckRun) {
          openPushGate(
            "subscription-missing",
            "This device is not subscribed to notifications yet. Enable notifications and close/reopen the app."
          );
        }
        return false;
      }

      if (runId === pushGateCheckRun) {
        closePushGate();
      }
      return true;
    } catch (error) {
      console.error("Push compliance check failed", error);
      if (runId === pushGateCheckRun) {
        openPushGate(
          "verification-failed",
          "Unable to verify notification status right now. Check your connection and close/reopen the app."
        );
      }
      return false;
    } finally {
      if (runId === pushGateCheckRun) {
        if (showCheckingState) {
          setPushGateChecking(false);
        }
        setPushGateResolved(true);
      }
    }
  };

  const handlePushGateEnable = async () => {
    setPushGateActionBusy(true);
    try {
      await evaluatePushCompliance({ askPermission: true });
    } finally {
      setPushGateActionBusy(false);
    }
  };

  onMount(() => {
    let swRegistration: ServiceWorkerRegistration | undefined;
    let pushForegroundRetryTimers: number[] = [];
    let lastForegroundRecheckAt = 0;

    const checkForUpdate = () => {
      swRegistration?.update().catch(() => undefined);
    };

    const clearPushForegroundRetryTimers = () => {
      for (const timer of pushForegroundRetryTimers) {
        window.clearTimeout(timer);
      }
      pushForegroundRetryTimers = [];
    };

    const schedulePushComplianceRecheck = () => {
      clearPushForegroundRetryTimers();

      if (!isMobileDevice()) return;
      if (!authService.getCurrentUser()) return;

      // Single delayed recheck avoids visible dialog flicker on iOS foreground events.
      const timer = window.setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        void evaluatePushCompliance({ blockUi: false });
      }, 700);
      pushForegroundRetryTimers.push(timer);
    };

    const triggerForegroundRecheck = () => {
      const now = Date.now();
      // iPad/iOS can emit visibilitychange + focus + pageshow in quick succession.
      if (now - lastForegroundRecheckAt < 1200) return;
      lastForegroundRecheckAt = now;
      checkForUpdate();
      schedulePushComplianceRecheck();
    };

    // Check for updates when user returns to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerForegroundRecheck();
      }
    };

    const handleForeground = () => {
      triggerForegroundRecheck();
    };

    // Check for updates when network reconnects
    const handleOnline = () => {
      triggerForegroundRecheck();
    };

    const updateSW = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (updateCheckInterval) window.clearInterval(updateCheckInterval);
        if (!registration) return;
        swRegistration = registration;

        // Check periodically
        updateCheckInterval = window.setInterval(
          checkForUpdate,
          60 * 60 * 1000,
        );
      },
    });
    setUpdateServiceWorker(() => updateSW);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleForeground);
    window.addEventListener("pageshow", handleForeground);
    window.addEventListener("online", handleOnline);

    const unsub = authService.onAuthStateChanged((user) => {
      setAuthed(!!user);
      setAuthReady(true);
      if (user) {
        if (isMobileDevice()) {
          // On iPad/iOS, push APIs can lag right after OTP sign-in in production.
          // Do the first check in the background so login is not held behind a
          // fullscreen loading state while the service worker finishes warming up.
          void evaluatePushCompliance({ blockUi: false });
        } else {
          closePushGate();
          setPushGateChecking(false);
          setPushGateResolved(true);
        }
      } else {
        closePushGate();
        setPushGateResolved(true);
      }
    });
    onCleanup(() => {
      if (updateCheckInterval) window.clearInterval(updateCheckInterval);
      clearPushForegroundRetryTimers();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleForeground);
      window.removeEventListener("pageshow", handleForeground);
      window.removeEventListener("online", handleOnline);
      unsub && unsub();
    });
  });

  return (
    <Show when={authReady()} fallback={<PageLoading />}>
      <Show
        when={
          !(
            authed() &&
            isMobileDevice() &&
            pushService.isSupported() &&
            (!pushGateResolved() || pushGateOpen())
          )
        }
        fallback={
          <Show when={pushGateResolved()} fallback={<PageLoading />}>
            <div class="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 px-4">
              <div class="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
                <h2 class="text-xl font-semibold text-gray-900">
                  Push Notifications Required
                </h2>
                <Show
                  when={pushGateChecking()}
                  fallback={
                    <>
                      <p class="mt-3 text-base text-gray-700">{pushGateMessage()}</p>
                      <Show when={pushGateReason() === "permission-default"}>
                        <button
                          type="button"
                          onClick={() => void handlePushGateEnable()}
                          disabled={pushGateActionBusy()}
                          class="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-base font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Enable Notifications
                        </button>
                      </Show>
                      <button
                        type="button"
                        onClick={() => void authService.signOut()}
                        disabled={pushGateActionBusy()}
                        class="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-base font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Sign Out
                      </button>
                    </>
                  }
                >
                  <div class="mt-6 flex justify-center">
                    <Spinner class="h-9 w-9 text-primary" />
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        }
      >
      <Router root={RouteTransitionRoot}>
        <Route path="/" component={() => <HomeRedirect authed={authed} />} />
        <Route
          path="/login"
          component={() =>
            authed() ? (
              <Navigate href="/" />
            ) : (
              <Suspense fallback={<RouteLoadingFallback />}>
                <Login />
              </Suspense>
            )
          }
        />
        <Route
          path="/auth/otp"
          component={() => (
            <Suspense fallback={<RouteLoadingFallback />}>
              <OtpSignIn />
            </Suspense>
          )}
        />
        <Route
          path="/complete-profile"
          component={() => (
            <Protected allowIncomplete>
              <Suspense fallback={<RouteLoadingFallback />}>
                <CompleteProfile />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/settings"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <Settings />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/settings/edit-profile"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <EditProfile />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/admin/handbook"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <ManageHandbook />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/handbook/:categoryId"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <HandbookView />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/handbook/search"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <HandbookSearch />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/team"
          component={() => (
            <Protected>
              <Team />
            </Protected>
          )}
        />
        <Route
          path="/admin/team"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <ManageTeam />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/closings"
          component={() => (
            <Protected>
              <Closings />
            </Protected>
          )}
        />
        <Route
          path="/admin/reports"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <Reports />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/admin/report-templates"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <ManageReports />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/closings/submit"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <SubmitClosing />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/closings/submit/plan"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <PlanEditor />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/admin/sources"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <ManageSources />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/admin"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <Admin />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/admin/backups"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <Backups />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/notifications"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <Notifications />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/notifications/:id"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <NotificationDetail />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/admin/notifications"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <ManageNotifications />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/products"
          component={() => (
            <Protected>
              <Products />
            </Protected>
          )}
        />
        <Route
          path="/admin/products"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <ManageProducts />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/tools/bmi"
          component={() => (
            <Protected>
              <Suspense fallback={<RouteLoadingFallback />}>
                <BMI />
              </Suspense>
            </Protected>
          )}
        />
        <Route
          path="/tools/delay-tax"
          component={() => (
            <Suspense fallback={<RouteLoadingFallback />}>
              <DelayTax />
            </Suspense>
          )}
        />
        <Route
          path="/tools/compound-effect"
          component={() => (
            <Suspense fallback={<RouteLoadingFallback />}>
              <CompoundEffect />
            </Suspense>
          )}
        />
        <Route
          path="*404"
          component={() => (
            <Suspense fallback={<RouteLoadingFallback />}>
              <NotFound />
            </Suspense>
          )}
        />
      </Router>

      <Show when={needRefresh()}>
        <div class="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div class="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-primary/30 bg-linear-to-r from-primary-600 to-secondary-600 px-4 py-3 text-base text-white shadow-lg sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div class="flex flex-col">
              <span class="font-semibold text-white">Update available</span>
              <span class="text-base text-white/80">
                A new version is ready. Please update the app.
              </span>
            </div>
            <div class="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setNeedRefresh(false)}
                class="!rounded-lg border border-white/40 !text-white hover:!bg-white/10 hover:!text-white"
              >
                Later
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                class="!rounded-lg !bg-white !text-primary hover:!bg-white/90 hover:!text-primary"
                onClick={async () => {
                  setIsUpdating(true);
                  try {
                    await updateServiceWorker()?.(true);
                  } catch {
                    setIsUpdating(false);
                  }
                }}
              >
                Update
              </Button>
            </div>
          </div>
        </div>
      </Show>
      </Show>
      <Show when={isUpdating()}>
        <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div class="flex flex-col items-center gap-3 rounded-2xl bg-white/95 px-6 py-5 shadow-xl">
            <Spinner class="h-10 w-10 text-primary" />
            <div class="text-base font-semibold text-primary">Updating…</div>
          </div>
        </div>
      </Show>
    </Show>
  );
};

export default App;
