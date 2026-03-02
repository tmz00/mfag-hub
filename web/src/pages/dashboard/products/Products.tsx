import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { TbOutlinePackage } from "solid-icons/tb";
import {
  AccordionCard,
  PageShell,
  PageHeader,
  PageBody,
} from "../../../components/ui";
import ProductCatalogBrowser from "../../../components/ProductCatalogBrowser";
import { dashboardOptions } from "../dashboardOptions";
import {
  productsService,
  type BasePlan,
  type Rider,
  type ProductItem,
} from "../../../services/productsService";
import { teamService } from "../../../services/teamService";
import {
  classificationBadgeClass,
  riderCategoryBadgeClass,
} from "../../../utils/productBadges";
import {
  type TabKey,
  getOptionEntries,
  defaultFrequencies,
} from "../../admin/products/modals/types";

const typeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    regular: "Regular Premium",
    single: "Single Premium",
    pa: "Personal Accident",
    hsg: "Healthshield",
    pl: "Personal Line",
    other: "Other",
  };
  return labels[type.toLowerCase()] || type;
};

const parseAttachableRiders = (value?: string[]): string[] => value || [];

const getFrequencyList = (item: ProductItem): string[] => {
  if (item.frequencies && item.frequencies.length > 0) {
    return item.frequencies;
  }
  if ((item.type || "").toLowerCase() === "single") {
    return ["Single"];
  }
  return defaultFrequencies.filter((freq) => freq !== "Single");
};

const LoadingSkeleton: Component = () => (
  <div class="space-y-4">
    <For each={[1, 2, 3]}>
      {() => (
        <div class="animate-pulse">
          <div class="mb-3 h-5 w-40 rounded bg-gray-200" />
          <div class="space-y-2">
            <div class="h-12 rounded-lg bg-gray-100" />
            <div class="h-12 rounded-lg bg-gray-100" />
            <div class="h-12 rounded-lg bg-gray-100" />
          </div>
        </div>
      )}
    </For>
  </div>
);

// Module-level UI state (persists across route remounts, like Team page)
const [productsExpandedByTab, setProductsExpandedByTab] = createSignal<
  Record<TabKey, string | null>
>({
  basePlans: null,
  riders: null,
});
const [productsCurrentTab, setProductsCurrentTab] =
  createSignal<TabKey>("basePlans");
const [productsHighlightedItemKey, setProductsHighlightedItemKey] =
  createSignal<string | null>(null);

const Products: Component = () => {
  const navigate = useNavigate();
  const [pendingRiderId, setPendingRiderId] = createSignal<string | null>(null);
  const [pendingBasePlanId, setPendingBasePlanId] = createSignal<string | null>(
    null,
  );
  let pendingScrollTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingOpenTimer: ReturnType<typeof setTimeout> | undefined;
  const [canManage, setCanManage] = createSignal(false);
  const [products, { refetch }] = createResource(
    () => productsService.getProducts(),
    {
      initialValue: {
        basePlans: [],
        riders: [],
      },
    },
  );
  // Track the active tab from the browser so we can react to pendingRiderId
  const toggleItem = (key: string, tab: TabKey) => {
    if (pendingScrollTimer) clearTimeout(pendingScrollTimer);
    if (pendingOpenTimer) clearTimeout(pendingOpenTimer);

    const current = productsExpandedByTab()[tab];
    if (current === key) {
      setProductsExpandedByTab((prev) => ({ ...prev, [tab]: null }));
      return;
    }

    if (!current) {
      setProductsExpandedByTab((prev) => ({ ...prev, [tab]: key }));
      return;
    }

    // 1) Close current card first.
    setProductsExpandedByTab((prev) => ({ ...prev, [tab]: null }));

    // 2) Then scroll to target card top.
    pendingScrollTimer = setTimeout(() => {
      const target =
        Array.from(
          document.querySelectorAll<HTMLElement>("[data-item-key]"),
        ).find((el) => el.dataset.itemKey === key) || null;
      if (!target) return;
      scrollCardTitleIntoView(target);

      // 3) Then expand target card.
      pendingOpenTimer = setTimeout(() => {
        setProductsExpandedByTab((prev) => ({ ...prev, [tab]: key }));
      }, 220);
    }, 280);
  };

  const highlightTarget = (itemKey: string) => {
    setProductsHighlightedItemKey(itemKey);
  };

  onCleanup(() => {
    if (pendingScrollTimer) clearTimeout(pendingScrollTimer);
    if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
  });

  const basePlans = createMemo<BasePlan[]>(() => products()?.basePlans || []);
  const ridersList = createMemo<Rider[]>(() => products()?.riders || []);

  const riderById = createMemo(() => {
    const map = new Map<string, Rider>();
    ridersList().forEach((rider) => {
      if (!map.has(rider.id)) {
        map.set(rider.id, rider);
      }
    });
    return map;
  });

  const getAttachableRiders = (plan: BasePlan): Rider[] => {
    const riderIds = parseAttachableRiders(plan.attachableRiders);
    return riderIds
      .map((id) => riderById().get(String(id)))
      .filter((r): r is Rider => Boolean(r));
  };

  const basePlansByRiderId = createMemo(() => {
    const map = new Map<string, BasePlan[]>();
    basePlans().forEach((plan) => {
      const riderIds = parseAttachableRiders(plan.attachableRiders);
      riderIds.forEach((riderId) => {
        const key = String(riderId);
        const list = map.get(key) || [];
        list.push(plan);
        map.set(key, list);
      });
    });
    return map;
  });

  const errorMessage = createMemo(() => {
    const err = products.error;
    if (!err) return "";
    if (err instanceof Error) return err.message;
    return String(err);
  });

  const handleRefresh = async () => {
    await productsService.getProducts(true);
    refetch();
  };

  onMount(async () => {
    try {
      const { accessLevel, isAdmin } =
        await teamService.getCurrentUserAccessLevel();
      const access = accessLevel.toLowerCase();
      setCanManage(isAdmin || access === "editor");
    } catch {
      setCanManage(false);
    }
  });

  // Custom search filter for richer matching (type labels, GST, frequencies, options)
  const searchFilter = (items: ProductItem[], query: string) => {
    return items.filter((item) => {
      const tokens = [
        item.fullName || "",
        item.shortName || "",
        item.type || "",
        item.type ? typeLabel(item.type) : "",
        item.gst === "Y" ? "GST" : "",
        ...(item.frequencies || []),
        ...(item.options || []).flatMap((option) => [
          option.label || "",
          option.fycRate ? `${option.fycRate}%` : "",
        ]),
      ];
      return tokens.some((token) => token.toLowerCase().includes(query));
    });
  };

  const focusRider = (riderId: string) => {
    setPendingRiderId(riderId);
    // The browser will switch to riders tab via initialTab change on next render
    // We need to force a re-render of the browser — handled by the effect below
    setProductsCurrentTab("riders");
  };

  const focusBasePlan = (planId: string) => {
    setPendingBasePlanId(planId);
    setProductsCurrentTab("basePlans");
  };

  const getCatalogStickyBottom = () => {
    const sticky = document.querySelector<HTMLElement>(
      "[data-product-catalog-sticky='true']",
    );
    if (!sticky) return 0;
    const rect = sticky.getBoundingClientRect();
    return Math.max(0, rect.bottom);
  };

  const scrollCardTitleIntoView = (cardRoot: HTMLElement) => {
    const titleAnchor =
      (cardRoot.querySelector(
        "[data-card-title-anchor='true']",
      ) as HTMLElement | null) || cardRoot;
    const stickyBottom = getCatalogStickyBottom();
    const targetTop =
      window.scrollY +
      titleAnchor.getBoundingClientRect().top -
      stickyBottom -
      66;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  };

  createEffect(() => {
    const riderId = pendingRiderId();
    if (!riderId || productsCurrentTab() !== "riders") return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = document.querySelector(
          `[data-rider-id="${riderId}"]`,
        ) as HTMLElement | null;
        if (!target) return;
        const key = target.dataset.itemKey;
        if (key) {
          setProductsExpandedByTab((prev) => ({ ...prev, riders: key }));
          highlightTarget(key);
        }
        scrollCardTitleIntoView(target);
        setPendingRiderId(null);
      });
    });
  });

  createEffect(() => {
    const planId = pendingBasePlanId();
    if (!planId || productsCurrentTab() !== "basePlans") return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = document.querySelector(
          `[data-base-plan-id="${planId}"]`,
        ) as HTMLElement | null;
        if (!target) return;
        const key = target.dataset.itemKey;
        if (key) {
          setProductsExpandedByTab((prev) => ({ ...prev, basePlans: key }));
          highlightTarget(key);
        }
        scrollCardTitleIntoView(target);
        setPendingBasePlanId(null);
      });
    });
  });

  const getItemKey = (
    item: ProductItem,
    localIndex: number,
    category: string,
  ) => `${category}-${item.id}-${localIndex}`;

  const renderItem = (
    item: ProductItem,
    localIndex: number,
    tab: TabKey,
    highlight: (text: string) => JSX.Element,
  ): JSX.Element => {
    // We need a stable category from groupByCategory's perspective
    const category = item.category || "Other";
    const itemKey = getItemKey(item, localIndex, category);
    const isExpanded = () => productsExpandedByTab()[tab] === itemKey;
    const isHighlighted = () => isExpanded();
    const optionEntries = () => getOptionEntries(item);
    const attachableRiders = () =>
      tab === "basePlans" ? getAttachableRiders(item as BasePlan) : [];
    const attachedBasePlans = () =>
      tab === "riders" ? basePlansByRiderId().get(String(item.id)) || [] : [];

    return (
      <div
        data-item-key={itemKey}
        data-rider-id={tab === "riders" ? String(item.id) : undefined}
        data-base-plan-id={tab === "basePlans" ? String(item.id) : undefined}
        class="mb-3 rounded-lg transition-all duration-300"
      >
        <AccordionCard
          open={isExpanded()}
          onToggle={() => toggleItem(itemKey, tab)}
          stickyClass="sticky top-[var(--catalog-item-sticky-top)] z-10"
          headerBgClass={
            isHighlighted() ? "bg-primary/12 hover:bg-primary/16" : undefined
          }
          header={
            <div class="flex flex-wrap items-center gap-2">
              <span
                data-card-title-anchor="true"
                class="text-base font-medium text-gray-900"
              >
                {highlight(item.fullName || "Unnamed Product")}
              </span>
              <Show when={item.shortName}>
                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-600">
                  {highlight(item.shortName || "")}
                </span>
              </Show>
              <Show when={item.type}>
                <span
                  class={`rounded px-1.5 py-0.5 text-sm font-medium ${classificationBadgeClass(
                    item.type!,
                  )}`}
                >
                  {highlight(item.type || "")}
                </span>
              </Show>
              <Show when={item.gst === "Y"}>
                <span class="rounded bg-yellow-50 px-1.5 py-0.5 text-sm font-medium text-yellow-700">
                  {highlight("GST")}
                </span>
              </Show>
            </div>
          }
        >
          <div class="px-4 pb-3 pt-3">
            {/* FYC Rates */}
            <Show when={optionEntries().length > 0 || item.fycRate}>
              <div>
                <Show
                  when={
                    optionEntries().length > 1 ||
                    Boolean(optionEntries()[0]?.[0])
                  }
                  fallback={
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-gray-500">FYC:</span>
                      <span class="text-base font-semibold text-primary">
                        {(optionEntries()[0]?.[1] || item.fycRate) === "-1" ? (
                          <span class="text-sm font-normal italic text-gray-400">
                            follows base plan
                          </span>
                        ) : (optionEntries()[0]?.[1] || item.fycRate) ===
                          "0" ? (
                          <span class="text-gray-500">0%</span>
                        ) : (
                          `${optionEntries()[0]?.[1] || item.fycRate}%`
                        )}
                      </span>
                    </div>
                  }
                >
                  <div class="overflow-hidden rounded border border-gray-200 bg-gray-100">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="border-b border-gray-200 bg-gray-100 text-left text-gray-600">
                          <th class="px-2 py-1.5 font-semibold">
                            {item.optionTitle || "Condition"}
                          </th>
                          <th class="px-2 py-1.5 text-right font-semibold">
                            FYC
                          </th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-100 bg-white">
                        <For each={optionEntries()}>
                          {(entry) => (
                            <tr>
                              <td class="px-2 py-1 text-gray-700">
                                {highlight(entry[0] || "Standard")}
                              </td>
                              <td class="px-2 py-1 text-right font-semibold text-primary">
                                {entry[1] === "-1" ? (
                                  <span class="font-normal italic text-gray-400">
                                    follows base
                                  </span>
                                ) : (
                                  `${entry[1]}%`
                                )}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Notes */}
            <Show when={item.notes}>
              <p class="mt-2 text-sm text-gray-500">
                {highlight(item.notes || "")}
              </p>
            </Show>

            {/* Frequencies */}
            <div class="mt-3">
              <div class="mb-1 text-sm font-semibold uppercase text-gray-400">
                Accepted Premium Frequencies
              </div>
              <div class="flex flex-wrap gap-1">
                <For each={getFrequencyList(item)}>
                  {(freq) => (
                    <span class="rounded bg-gray-100 px-1.5 py-0.5 text-sm font-medium text-gray-600">
                      {highlight(freq)}
                    </span>
                  )}
                </For>
              </div>
            </div>

            {/* Attachable Riders */}
            <Show when={attachableRiders().length > 0}>
              <div class="mt-3">
                <div class="mb-1 text-sm font-semibold uppercase text-gray-400">
                  Attachable Riders
                </div>
                <div class="flex flex-wrap gap-1">
                  <For each={attachableRiders()}>
                    {(rider) => (
                      <button
                        type="button"
                        onClick={() => focusRider(String(rider.id))}
                        class={`rounded px-1.5 py-0.5 text-sm font-medium ${riderCategoryBadgeClass(
                          rider.category || "",
                        )}`}
                        title={rider.fullName}
                      >
                        <span class="text-left">
                          {rider.fullName || rider.shortName || rider.id}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={attachedBasePlans().length > 0}>
              <div class="mt-3">
                <div class="mb-1 text-sm font-semibold uppercase text-gray-400">
                  Attachable to Base Plans
                </div>
                <div class="flex flex-wrap gap-1">
                  <For each={attachedBasePlans()}>
                    {(plan) => (
                      <button
                        type="button"
                        onClick={() => focusBasePlan(String(plan.id))}
                        class="rounded bg-primary-50 px-1.5 py-0.5 text-sm font-medium text-primary"
                        title={plan.fullName}
                      >
                        <span class="text-left">
                          {plan.fullName || plan.shortName || plan.id}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </AccordionCard>
      </div>
    );
  };

  return (
    <PageShell>
      <PageHeader
        onBack={() => navigate(-1)}
        icon={
          <Dynamic component={dashboardOptions.products.icon} class="h-5 w-5" />
        }
        title={dashboardOptions.products.title}
        subtitle={dashboardOptions.products.description}
      />

      <PageBody>
        <div class="space-y-4">
          <Show
            when={!products.error}
            fallback={
              <div class="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center shadow-sm">
                <div class="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <TbOutlinePackage class="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <p class="text-base font-semibold text-red-700">
                    Unable to load products
                  </p>
                  <Show when={errorMessage()}>
                    <p class="mt-1 text-sm text-red-600">{errorMessage()}</p>
                  </Show>
                </div>
                <button
                  type="button"
                  onClick={handleRefresh}
                  class="mt-2 rounded-full bg-red-100 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-200"
                >
                  Try Again
                </button>
              </div>
            }
          >
            <ProductCatalogBrowser
              basePlans={basePlans()}
              riders={ridersList()}
              accentColor="primary"
              initialTab={productsCurrentTab()}
              onTabChange={setProductsCurrentTab}
              searchFilter={searchFilter}
              renderItem={renderItem}
              loading={products.loading}
              loadingFallback={<LoadingSkeleton />}
            />
          </Show>
        </div>
      </PageBody>
    </PageShell>
  );
};

export default Products;
