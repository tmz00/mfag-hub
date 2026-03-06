import {
  Component,
  For,
  Show,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
} from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { TbOutlineSearch } from "solid-icons/tb";

import { authService } from "../../services/authService";
import { getHandbookEntries } from "../../services/handbookContentService";
import { notificationsService } from "../../services/notificationsService";
import {
  IconButton,
  LoadingState,
  PageBody,
  PageHeader,
  PageShell,
} from "../../components/ui";
import { HandbookCategoryGrid } from "../../components/HandbookCategoryGrid";
import { dashboardOptions } from "./dashboardOptions";

type HandbookCategory = {
  id: string;
  name?: string;
  imagePath?: string;
  imageUrl?: string;
  sortIndex?: number;
  topicCount?: number;
  itemCount?: number;
};

let dashboardScrollY = 0;
let hasDashboardScrollY = false;
const preloadHandbookSearch = () => {
  void import("./handbook/HandbookSearch");
};
const getHandbookSearchHref = () => {
  if (typeof window === "undefined") {
    return "/handbook/search?returnTo=%2F";
  }

  const returnTo =
    `${window.location.pathname}${window.location.search}${window.location.hash}` ||
    "/";
  return `/handbook/search?returnTo=${encodeURIComponent(returnTo)}`;
};

const Dashboard: Component = () => {
  const navigate = useNavigate();

  const toolKeys = [
    "bmi",
    "delayTax",
    "compoundEffect",
  ] as const;
  const quickAccessKeys = ["closings", "team", "products", "admin"] as const;

  const [handbookCategories, setHandbookCategories] = createSignal<
    HandbookCategory[]
  >([]);
  const [handbookError, setHandbookError] = createSignal("");
  const [handbookLoading, setHandbookLoading] = createSignal(true);
  const [pendingRestoreScrollY, setPendingRestoreScrollY] = createSignal<
    number | null
  >(null);
  const [canAccessAdmin, setCanAccessAdmin] = createSignal(false);
  const [unreadNotifications, setUnreadNotifications] = createSignal(0);

  onMount(() => {
    if (hasDashboardScrollY) {
      setPendingRestoreScrollY(dashboardScrollY);
    }

    preloadHandbookSearch();
    loadHandbookCategories();
    let unsubNotifications: (() => void) | null = null;

    const unsub = authService.onAuthStateChanged((user) => {
      if (!user) {
        setCanAccessAdmin(false);
        setUnreadNotifications(0);
        if (unsubNotifications) {
          unsubNotifications();
          unsubNotifications = null;
        }
        return;
      }
      loadAdminAccess();

      // Subscribe to unread notifications count
      unsubNotifications = notificationsService.subscribeToUnreadCount(
        user.uid,
        (count) => setUnreadNotifications(count),
      );
    });

    onCleanup(() => {
      unsub && unsub();
      unsubNotifications && unsubNotifications();
    });
  });

  onMount(() => {
    let saveTimer: number | undefined;
    const saveScroll = () => {
      if (saveTimer !== undefined) return;
      saveTimer = window.setTimeout(() => {
        saveTimer = undefined;
        dashboardScrollY = Math.max(0, window.scrollY || 0);
        hasDashboardScrollY = true;
      }, 120);
    };

    window.addEventListener("scroll", saveScroll, { passive: true });

    onCleanup(() => {
      window.removeEventListener("scroll", saveScroll);
      if (saveTimer !== undefined) {
        window.clearTimeout(saveTimer);
      }
      dashboardScrollY = Math.max(0, window.scrollY || 0);
      hasDashboardScrollY = true;
    });
  });

  createEffect(() => {
    const targetY = pendingRestoreScrollY();
    if (targetY === null) return;
    if (handbookLoading()) return;

    let attempt = 0;
    const maxAttempts = 24;
    let timer: number | undefined;

    const restoreScroll = () => {
      const maxScrollable = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const clampedY = Math.min(targetY, maxScrollable);
      window.scrollTo({ top: clampedY, behavior: "auto" });

      const delta = Math.abs((window.scrollY || 0) - clampedY);
      if (delta <= 4 || attempt >= maxAttempts) {
        setPendingRestoreScrollY(null);
        return;
      }

      attempt += 1;
      timer = window.setTimeout(restoreScroll, 80);
    };

    timer = window.setTimeout(restoreScroll, 0);
    onCleanup(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
  });

  const loadAdminAccess = async () => {
    const user = authService.getCurrentUser();
    const access = String(user?.accessLevel || "").toLowerCase();
    setCanAccessAdmin(access === "admin" || access === "editor");
  };

  const loadHandbookCategories = async () => {
    try {
      setHandbookLoading(true);
      const parsed = await getHandbookEntries();
      if (!Array.isArray(parsed)) {
        setHandbookCategories([]);
        return;
      }

      const resolvedCategories = await Promise.all(
        parsed.map(async (entry: any, index: number) => {
          const imageUrl = entry?.imageUrl;
          return {
            id: String(index),
            name: entry?.category || "",
            imageUrl,
          } as HandbookCategory;
        }),
      );

      setHandbookCategories(resolvedCategories.filter(Boolean));
    } catch (e) {
      console.error("Failed to load handbook", e);
      setHandbookError("Unable to load handbook categories");
    } finally {
      setHandbookLoading(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        variant="dashboard"
        title={
          <img
            src="/images/hub_banner.png"
            alt="MFAG Hub Banner"
            class="max-w-45 -top-0.5 relative"
          />
        }
        actions={
          <div class="flex items-center">
            <IconButton
              onClick={() => navigate(dashboardOptions.notifications.href)}
              size="xl"
            >
              <Dynamic component={dashboardOptions.notifications.icon} />
              <Show when={unreadNotifications() > 0}>
                <span class="absolute right-14 top-4 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-sm font-bold text-white">
                  {unreadNotifications() > 99 ? "99+" : unreadNotifications()}
                </span>
              </Show>
            </IconButton>
            <IconButton
              onClick={() => navigate(dashboardOptions.settings.href)}
              size="xl"
            >
              <Dynamic component={dashboardOptions.settings.icon} />
            </IconButton>
          </div>
        }
      />

      <PageBody>
        <div class="space-y-10">
          {/* Quick Access */}
          <div class="flex items-center justify-center gap-3 xs:gap-4 sm:gap-12 md:gap-16">
            <For each={quickAccessKeys}>
              {(key) => {
                const option = dashboardOptions[key];
                const isAdminOption = key === "admin";
                const gradient = isAdminOption
                  ? "from-admin-from to-admin-to"
                  : "from-primary to-secondary";
                const hoverText = isAdminOption
                  ? "group-hover:text-admin-from"
                  : "group-hover:text-primary";
                return (
                  <Show when={!isAdminOption || canAccessAdmin()}>
                    <A
                      href={option.href}
                      class="group flex flex-col items-center gap-3 transition-all active:scale-95"
                    >
                      <div
                        class={`flex h-13 w-13 items-center justify-center rounded-full bg-linear-to-br ${gradient} shadow-lg transition-all group-hover:scale-110 group-hover:shadow-xl sm:h-16 sm:w-16`}
                      >
                        <Dynamic
                          component={option.icon}
                          class="h-7 w-7 text-white"
                        />
                      </div>
                      <h3
                        class={`font-condensed font-semibold text-lg ${hoverText}`}
                      >
                        {option.title}
                      </h3>
                    </A>
                  </Show>
                );
              }}
            </For>
          </div>

          {/* Tools */}
          <div class="space-y-4">
            <div class="flex items-center gap-2">
              <div class="h-0.5 w-6 rounded-full bg-linear-to-r from-primary to-secondary"></div>
              <h2 class="font-condensed font-bold text-xl">TOOLS</h2>
            </div>
            <div class="grid grid-cols-2 gap-3 md:items-center">
              <For each={toolKeys}>
                {(key) => {
                  const tool = dashboardOptions[key];

                  return (
                    <A
                      href={tool.href}
                      class="group relative flex h-full items-center overflow-hidden rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-all hover:border-transparent hover:shadow-md active:scale-[0.98]"
                    >
                      <div class="absolute left-0 top-0 h-full w-1 bg-linear-to-b from-primary to-secondary transition-all group-hover:w-1.5"></div>

                      <div class="flex w-full items-center gap-3">
                        <div class="group-hover:scale-110 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary to-secondary opacity-90 transition-all group-hover:opacity-100">
                          <Dynamic
                            component={tool.icon}
                            class="h-6 w-6 text-white"
                          />
                        </div>
                        <div class="min-w-0 flex-1">
                          <h3 class="font-condensed font-semibold text-lg group-hover:text-primary">
                            {tool.title}
                          </h3>
                          <p class="text-gray-600">{tool.description}</p>
                        </div>
                      </div>
                    </A>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Handbook */}
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <div class="h-0.5 w-6 rounded-full bg-linear-to-r from-primary to-secondary"></div>
              <div class="flex items-center gap-2">
                <h2 class="font-condensed font-bold text-xl">HANDBOOK</h2>
              </div>
            </div>
            <Show
              when={!handbookLoading()}
              fallback={
                <LoadingState
                  label="Loading handbook..."
                  class="justify-start text-gray-500"
                />
              }
            >
              <Show
                when={!handbookError()}
                fallback={
                  <p class="text-base text-red-600">{handbookError()}</p>
                }
              >
                <div class="space-y-3">
                  <div class="sticky top-0 z-20 -mx-2 bg-gray-50/95 px-2 py-1 backdrop-blur-sm">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div class="relative w-full">
                        <button
                          type="button"
                          onPointerDown={preloadHandbookSearch}
                          onTouchStart={preloadHandbookSearch}
                          onMouseEnter={preloadHandbookSearch}
                          onFocus={preloadHandbookSearch}
                          onClick={() => navigate(getHandbookSearchHref())}
                          class="flex w-full items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left text-base text-gray-500 shadow-inner transition hover:bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
                        >
                          <span>Search handbook…</span>
                          <TbOutlineSearch class="h-4 w-4 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <HandbookCategoryGrid
                    items={handbookCategories().map((cat) => ({
                      id: cat.id,
                      label: cat.name || "Untitled",
                      imageUrl: cat.imageUrl,
                    }))}
                    emptyMessage="No categories yet."
                    hrefForId={(id) => `/handbook/${id}`}
                    viewTransitionNameForId={(id) => `handbook-card-${id}`}
                  />
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
};

export default Dashboard;
