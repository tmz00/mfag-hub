import {
  Component,
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js";
import {
  TbOutlineSearch,
  TbOutlineStack,
  TbOutlinePuzzle,
  TbOutlinePackageOff,
  TbOutlineChevronDown,
} from "solid-icons/tb";
import type { BasePlan, Rider, ProductItem } from "../services/productsService";
import {
  groupByCategory,
  highlightText,
  type TabKey,
} from "../pages/admin/products/modals/types";
import { Dynamic } from "solid-js/web";
import { BackToTopFab } from "./ui/BackToTopFab";
import { LoadingState } from "./ui";

type ProductCatalogBrowserProps = {
  basePlans: BasePlan[];
  riders: Rider[];
  renderItem: (
    item: ProductItem,
    index: number,
    tab: TabKey,
    highlight: (text: string) => JSX.Element,
  ) => JSX.Element;
  accentColor?: "primary" | "admin";
  initialTab?: TabKey;
  extraFooter?: JSX.Element;
  stickyTopOffset?: number;
  /** Additional filter applied to products before search (e.g. limit riders to attachable IDs) */
  filterProducts?: (items: ProductItem[], tab: TabKey) => ProductItem[];
  /** Custom search filter — when provided, replaces the default name/shortName matching */
  searchFilter?: (items: ProductItem[], query: string) => ProductItem[];
  /** Hide the tab bar (lock to initialTab) */
  showTabs?: boolean;
  /** Notifies parent when active tab changes */
  onTabChange?: (tab: TabKey) => void;
  /** Show helper line + clear button in search-empty state. Default: true */
  showSearchEmptyActions?: boolean;
  /** Show loading state in content area while keeping tabs/search visible */
  loading?: boolean;
  /** Custom loading fallback for content area */
  loadingFallback?: JSX.Element;
};

const accentClasses = {
  primary: {
    tabActive: "text-primary",
    tabUnderline: "bg-primary",
    focusRing: "focus:border-primary focus:ring-1 focus:ring-primary/40",
    searchWrap: "border-gray-700/40 bg-white",
    searchIcon: "text-gray-700",
    searchInput:
      "border-gray-700/40 bg-white text-gray-800 placeholder:text-gray-400",
    jumpHover: "hover:bg-primary/5",
    jumpActive: "font-semibold text-primary",
    categoryBg: "bg-primary-500",
  },
  admin: {
    tabActive: "text-admin-from",
    tabUnderline: "bg-admin-from",
    focusRing:
      "focus:border-admin-from focus:bg-white focus:ring-1 focus:ring-admin-from/40",
    searchWrap: "border-gray-700/40 bg-white",
    searchIcon: "text-gray-700",
    searchInput:
      "border-gray-700/40 bg-white text-gray-800 placeholder:text-gray-400",
    jumpHover: "hover:bg-admin-from/5",
    jumpActive: "font-semibold text-admin-from",
    categoryBg: "bg-admin-from",
  },
};

const ProductCatalogBrowser: Component<ProductCatalogBrowserProps> = (
  props,
) => {
  const accent = () => accentClasses[props.accentColor || "primary"];
  const [activeTab, setActiveTab] = createSignal<TabKey>(
    props.initialTab || "basePlans",
  );
  const [searchTerm, setSearchTerm] = createSignal("");
  const [categoryJumpMenu, setCategoryJumpMenu] = createSignal<string | null>(
    null,
  );
  const [stickyHeight, setStickyHeight] = createSignal(0);
  const [lastAnimatedTab, setLastAnimatedTab] = createSignal<TabKey | null>(
    null,
  );
  const [tabIndicatorStyle, setTabIndicatorStyle] = createSignal({
    left: 0,
    width: 0,
  });
  let hasInitializedSearchEffect = false;
  let stickyRef: HTMLDivElement | undefined;
  let tabsRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const tabButtonRefs: Partial<Record<TabKey, HTMLButtonElement>> = {};

  const updateHeight = () => {
    if (!stickyRef) return;
    const nextHeight = stickyRef.offsetHeight;
    setStickyHeight(Number.isFinite(nextHeight) ? nextHeight : 0);
  };

  const updateTabIndicator = () => {
    if (!tabsRef) return;
    const activeButton = tabButtonRefs[activeTab()];
    if (!activeButton) {
      const tabWidth = tabsRef.clientWidth / 2;
      if (!Number.isFinite(tabWidth) || tabWidth <= 0) return;
      setTabIndicatorStyle({
        left: activeTab() === "riders" ? tabWidth : 0,
        width: tabWidth,
      });
      return;
    }

    const parentRect = tabsRef.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const left = buttonRect.left - parentRect.left;
    setTabIndicatorStyle({
      left,
      width: buttonRect.width,
    });
  };

  onMount(() => {
    // Delay initial measurement so the DOM has layout
    requestAnimationFrame(updateHeight);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateHeight();
        updateTabIndicator();
      });
      if (stickyRef) resizeObserver.observe(stickyRef);
      if (tabsRef) resizeObserver.observe(tabsRef);
    }
    window.addEventListener("resize", updateHeight);
    window.addEventListener("resize", updateTabIndicator);
    requestAnimationFrame(updateTabIndicator);
    onCleanup(() => {
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("resize", updateTabIndicator);
      resizeObserver?.disconnect();
      resizeObserver = undefined;
    });
  });

  createEffect(() => {
    const requestedTab = props.initialTab;
    if (!requestedTab) return;
    if (activeTab() !== requestedTab) {
      setActiveTab(requestedTab);
      clearFilters();
    }
  });

  createEffect(() => {
    activeTab();
    requestAnimationFrame(updateTabIndicator);
  });

  createEffect(() => {
    searchTerm();
    if (!hasInitializedSearchEffect) {
      hasInitializedSearchEffect = true;
      return;
    }
    const getFirstResultElement = () =>
      (contentRef?.querySelector("section, [data-item-key]") as HTMLElement | null) ||
      null;
    const getScrollableAncestor = (el: HTMLElement | undefined) => {
      let current: HTMLElement | null = el || null;
      while (current) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          current.scrollHeight > current.clientHeight
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    };
    requestAnimationFrame(() => {
      const firstResult = getFirstResultElement();
      if (firstResult) {
        firstResult.scrollIntoView({ block: "start", behavior: "auto" });
        return;
      }
      const scroller = getScrollableAncestor(contentRef);
      if (scroller) {
        scroller.scrollTo({ top: 0, behavior: "auto" });
      }
    });
  });

  createEffect(() => {
    const tab = activeTab();
    const prev = lastAnimatedTab();
    if (prev === null) {
      setLastAnimatedTab(tab);
      return;
    }
    if (prev === tab || !contentRef) return;

    const direction = prev === "basePlans" && tab === "riders" ? 1 : -1;
    contentRef.animate(
      [
        { transform: `translateX(${direction * 18}px)`, opacity: 0.82 },
        { transform: "translateX(0px)", opacity: 1 },
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
    setLastAnimatedTab(tab);
  });

  const allProducts = createMemo<ProductItem[]>(() => {
    const tab = activeTab();
    let items: ProductItem[] =
      tab === "riders" ? props.riders : props.basePlans;
    if (props.filterProducts) {
      items = props.filterProducts(items, tab);
    }
    return items;
  });

  const filteredProducts = createMemo(() => {
    const query = searchTerm().toLowerCase().trim();
    if (!query) return allProducts();
    if (props.searchFilter) return props.searchFilter(allProducts(), query);
    return allProducts().filter((item) => {
      const fullName = (item.fullName || "").toLowerCase();
      const shortName = (item.shortName || "").toLowerCase();
      return fullName.includes(query) || shortName.includes(query);
    });
  });

  const groupedProducts = createMemo(() => groupByCategory(filteredProducts()));

  const clearFilters = () => {
    setSearchTerm("");
    setCategoryJumpMenu(null);
  };

  const hasActiveFilters = () => searchTerm().trim().length > 0;

  const highlight = (text: string) => highlightText(text, searchTerm());

  const getCategoryId = (category: string) =>
    `catalog-group-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const tabs = [
    {
      key: "basePlans" as TabKey,
      label: "Base Plans",
      icon: TbOutlineStack,
    },
    {
      key: "riders" as TabKey,
      label: "Riders & Top-ups",
      icon: TbOutlinePuzzle,
    },
  ];
  const stickyBaseTop = () => props.stickyTopOffset ?? 0;
  const stickyCategoryTop = () => stickyBaseTop() + stickyHeight();
  const itemStickyTop = () => stickyCategoryTop() + 41;
  const categoryJumpLift = -14;
  const sectionScrollMarginTop = (isFirst: boolean) =>
    stickyCategoryTop() - categoryJumpLift - (isFirst ? 0 : 36);
  const stickyHeaderClass = () =>
    "sticky top-0 z-30 bg-gray-50 -mx-4 px-4 py-3";
  const sectionListClass = () => "space-y-0";
  const sectionClass = () => "pt-6 first:pt-0";

  return (
    <div class="pb-10">
      {/* Sticky header: Tabs + Search */}
      <div
        ref={(el) => {
          stickyRef = el;
          requestAnimationFrame(updateHeight);
        }}
        data-product-catalog-sticky="true"
        class={stickyHeaderClass()}
        style={
          props.stickyTopOffset != null
            ? { top: `${props.stickyTopOffset}px` }
            : undefined
        }
      >
        <Show when={props.showTabs !== false}>
          <div
            ref={(el) => {
              tabsRef = el;
              requestAnimationFrame(updateHeight);
              requestAnimationFrame(updateTabIndicator);
            }}
            class="relative flex border-b border-primary-100 mb-4"
          >
            <For each={tabs}>
              {(tab) => (
                <button
                  ref={(el) => {
                    tabButtonRefs[tab.key] = el;
                    if (activeTab() === tab.key) {
                      requestAnimationFrame(updateTabIndicator);
                    }
                  }}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key);
                    props.onTabChange?.(tab.key);
                    clearFilters();
                  }}
                  class={`relative text-lg font-condensed flex flex-1 items-center justify-center gap-2 pb-3 font-semibold transition ${
                    activeTab() === tab.key
                      ? accent().tabActive
                      : "text-gray-500 hover:text-gray-700 cursor-pointer"
                  }`}
                >
                  <Dynamic component={tab.icon} class="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              )}
            </For>
            <span
              class={`pointer-events-none absolute bottom-0 h-0.5 rounded-full transition-all duration-250 ease-out ${accent().tabUnderline}`}
              style={{
                left: `${tabIndicatorStyle().left}px`,
                width: `${tabIndicatorStyle().width}px`,
              }}
            />
          </div>
        </Show>
        <div class={`rounded-lg border ${accent().searchWrap}`}>
          <label class="relative block">
            <span
              class={`pointer-events-none absolute inset-y-0 left-3 flex items-center ${accent().searchIcon}`}
            >
              <TbOutlineSearch class="h-4 w-4" />
            </span>
            <input
              type="search"
              placeholder={`Search ${activeTab() === "riders" ? "riders & top-ups" : "base plans"}...`}
              value={searchTerm()}
              onInput={(e) => setSearchTerm(e.currentTarget.value)}
              class={`w-full rounded-lg pt-3 pb-3 pl-9 pr-4 text-base focus:outline-none focus:ring-0 ${accent().searchInput} `}
            />
          </label>
        </div>
      </div>

      {/* Content */}
      <Show
        when={!props.loading}
        fallback={
          props.loadingFallback || (
            <div class="py-6">
              <LoadingState label="Loading products..." />
            </div>
          )
        }
      >
        <Show
          when={groupedProducts().length > 0}
        fallback={
          <div class="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <TbOutlinePackageOff class="h-6 w-6 text-gray-400" />
            </div>
              <p class="text-base font-semibold text-gray-700">
                {hasActiveFilters()
                  ? "No matching products"
                  : "No products found"}
              </p>
              <Show when={!hasActiveFilters() || props.showSearchEmptyActions !== false}>
                <p class="mt-1 text-base text-gray-500">
                  {hasActiveFilters()
                    ? "Try adjusting your search"
                    : `No ${activeTab() === "riders" ? "riders" : "base plans"} available`}
                </p>
              </Show>
            <Show when={hasActiveFilters() && props.showSearchEmptyActions !== false}>
              <button
                type="button"
                onClick={clearFilters}
                class="mt-2 rounded-full bg-gray-100 px-4 py-2 text-base font-semibold text-gray-700 transition hover:bg-gray-200"
              >
                Clear Filters
              </button>
            </Show>
          </div>
        }
      >
        <div
          ref={contentRef}
          class={sectionListClass()}
          style={{ "--catalog-item-sticky-top": `${itemStickyTop()}px` }}
        >
          <For each={groupedProducts()}>
            {(group, groupIndex) => (
              <section
                id={getCategoryId(group.category)}
                class={sectionClass()}
                style={{
                  "scroll-margin-top": `${sectionScrollMarginTop(groupIndex() === 0)}px`,
                }}
              >
                {/* Category Header */}
                <div
                  class={`sticky z-20 border-b border-gray-200 ${accent().categoryBg}`}
                  style={{ top: `${stickyCategoryTop()}px` }}
                >
                  <button
                    type="button"
                    class="flex w-full items-center justify-between px-3 py-2 text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCategoryJumpMenu(
                        categoryJumpMenu() === group.category
                          ? null
                          : group.category,
                      );
                    }}
                  >
                    <div class="flex items-center gap-2">
                      <Show
                        when={activeTab() === "riders"}
                        fallback={<TbOutlineStack class="h-4 w-4 text-white" />}
                      >
                        <TbOutlinePuzzle class="h-4 w-4 text-white" />
                      </Show>
                      <h3 class="text-lg font-semibold font-condensed text-white">
                        {highlight(group.category)}
                      </h3>
                      <span class="text-white font-condensed">
                        ({group.items.length})
                      </span>
                    </div>
                    <TbOutlineChevronDown
                      class={`h-4 w-4 text-white transition-transform duration-200 ${
                        categoryJumpMenu() === group.category
                          ? "rotate-180"
                          : ""
                      }`}
                    />
                  </button>
                  <Show when={categoryJumpMenu() === group.category}>
                    <div class="border border-gray-700 rounded-lg shadow-2xl bg-white">
                      <For each={groupedProducts()}>
                        {(g) => (
                          <button
                            type="button"
                            class={`w-full px-3 py-1.5 text-left text-base transition ${accent().jumpHover} ${
                              g.category === group.category
                                ? accent().jumpActive
                                : "text-gray-700"
                            }`}
                            onClick={() => {
                              setCategoryJumpMenu(null);
                              document
                                .getElementById(getCategoryId(g.category))
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                            }}
                          >
                            {g.category} ({g.items.length})
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                {/* Product Items */}
                <div>
                  <For each={group.items}>
                    {(item, localIndex) =>
                      props.renderItem(
                        item,
                        localIndex(),
                        activeTab(),
                        highlight,
                      )
                    }
                  </For>
                </div>
              </section>
            )}
          </For>
        </div>
        </Show>
      </Show>

      {/* Extra footer (e.g. "Not in list") */}
      <Show when={props.extraFooter}>{props.extraFooter}</Show>

      <BackToTopFab />
    </div>
  );
};

export default ProductCatalogBrowser;
