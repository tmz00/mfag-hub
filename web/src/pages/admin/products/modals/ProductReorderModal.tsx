import {
  Component,
  Show,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import {
  TbOutlineChevronDown,
  TbOutlineStack,
  TbOutlinePuzzle,
} from "solid-icons/tb";

import { EditModal, LoadingState, ReorderList } from "../../../../components/ui";
import { getCaptchaAwareErrorMessage } from "../../../../services/authService";
import {
  productsService,
  type BasePlan,
  type Rider,
  type ProductCatalog,
} from "../../../../services/productsService";

const categoryLabel = (value?: string) => value || "Other";

type CategoryBucket<T> = {
  category: string;
  items: T[];
};

const getCategoryBuckets = <T extends BasePlan | Rider>(
  items: T[]
): CategoryBucket<T>[] => {
  const buckets: CategoryBucket<T>[] = [];
  const lookup = new Map<string, CategoryBucket<T>>();

  items.forEach((item) => {
    const category = categoryLabel(item.category);
    const bucket = lookup.get(category);
    if (bucket) {
      bucket.items.push(item);
    } else {
      const nextBucket = { category, items: [item] };
      lookup.set(category, nextBucket);
      buckets.push(nextBucket);
    }
  });

  return buckets;
};

const flattenBuckets = <T extends BasePlan | Rider>(
  buckets: CategoryBucket<T>[],
  order: string[]
): T[] => {
  const map = new Map(buckets.map((bucket) => [bucket.category, bucket.items]));
  const next: T[] = [];
  order.forEach((category) => {
    const items = map.get(category);
    if (items) next.push(...items);
  });
  return next;
};

type Props = {
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

const ProductReorderModal: Component<Props> = (props) => {
  const [catalog, setCatalog] = createSignal<ProductCatalog | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"basePlans" | "riders">(
    "basePlans"
  );
  const [baseOrder, setBaseOrder] = createSignal<string[]>([]);
  const [riderOrder, setRiderOrder] = createSignal<string[]>([]);
  const [baseBuckets, setBaseBuckets] = createSignal<
    CategoryBucket<BasePlan>[]
  >([]);
  const [riderBuckets, setRiderBuckets] = createSignal<CategoryBucket<Rider>[]>(
    []
  );
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const [error, setError] = createSignal("");
  const [initialBaseSnapshot, setInitialBaseSnapshot] = createSignal("");
  const [initialRiderSnapshot, setInitialRiderSnapshot] = createSignal("");

  const loadCatalog = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await productsService.getProducts(true);
      setCatalog(data);
      const base = getCategoryBuckets(data.basePlans || []);
      const rider = getCategoryBuckets(data.riders || []);
      setBaseBuckets(base);
      setRiderBuckets(rider);
      setBaseOrder(base.map((bucket) => bucket.category));
      setRiderOrder(rider.map((bucket) => bucket.category));
      setInitialBaseSnapshot(
        JSON.stringify({
          order: base.map((bucket) => bucket.category),
          items: base.map((bucket) =>
            bucket.items.map((item) => String(item.id || item.fullName || ""))
          ),
        })
      );
      setInitialRiderSnapshot(
        JSON.stringify({
          order: rider.map((bucket) => bucket.category),
          items: rider.map((bucket) =>
            bucket.items.map((item) => String(item.id || item.fullName || ""))
          ),
        })
      );
    } catch (err) {
      console.error("Failed to load products", err);
      setError(
        getCaptchaAwareErrorMessage(err, "Unable to load products catalog."),
      );
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void loadCatalog();
  });

  const activeOrder = createMemo(() =>
    activeTab() === "basePlans" ? baseOrder() : riderOrder()
  );

  const activeBuckets = createMemo(() =>
    activeTab() === "basePlans" ? baseBuckets() : riderBuckets()
  );

  const baseSnapshot = createMemo(() =>
    JSON.stringify({
      order: baseOrder(),
      items: baseOrder().map((category) => {
        const bucket = baseBuckets().find((item) => item.category === category);
        return (bucket?.items || []).map((item) =>
          String(item.id || item.fullName || "")
        );
      }),
    })
  );

  const riderSnapshot = createMemo(() =>
    JSON.stringify({
      order: riderOrder(),
      items: riderOrder().map((category) => {
        const bucket = riderBuckets().find((item) => item.category === category);
        return (bucket?.items || []).map((item) =>
          String(item.id || item.fullName || "")
        );
      }),
    })
  );

  const hasUnsavedChanges = createMemo(() => {
    if (!initialBaseSnapshot() || !initialRiderSnapshot()) return false;
    return (
      baseSnapshot() !== initialBaseSnapshot() ||
      riderSnapshot() !== initialRiderSnapshot()
    );
  });

  const moveCategory = (from: number, to: number) => {
    const order = [...activeOrder()];
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    if (activeTab() === "basePlans") {
      setBaseOrder(order);
    } else {
      setRiderOrder(order);
    }
  };

  const moveItem = (category: string, from: number, to: number) => {
    const buckets = [...activeBuckets()];
    const bucketIndex = buckets.findIndex(
      (bucket) => bucket.category === category
    );
    if (bucketIndex === -1) return;
    const items = [...buckets[bucketIndex].items];
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    buckets[bucketIndex] = { ...buckets[bucketIndex], items };
    if (activeTab() === "basePlans") {
      setBaseBuckets(buckets as CategoryBucket<BasePlan>[]);
    } else {
      setRiderBuckets(buckets as CategoryBucket<Rider>[]);
    }
  };

  const toggleExpanded = (category: string) => {
    const key = `${activeTab()}-${category}`;
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isExpanded = (category: string) => {
    const key = `${activeTab()}-${category}`;
    return Boolean(expanded()[key]);
  };

  const getBucket = (category: string) =>
    activeBuckets().find((item) => item.category === category);

  const handleSave = async () => {
    if (!catalog()) return;
    setSaving(true);
    setError("");
    try {
      const basePlans = flattenBuckets(baseBuckets(), baseOrder());
      const riders = flattenBuckets(riderBuckets(), riderOrder());
      const updated: ProductCatalog = {
        ...catalog()!,
        basePlans,
        riders,
      };
      await productsService.setProducts(updated, "Reorder Categories / Products");
      setCatalog(updated);
      props.onSaved();
    } catch (err) {
      console.error("Failed to save category order", err);
      const message = getCaptchaAwareErrorMessage(
        err,
        "Unable to save category ordering.",
      );
      setError(message);
      props.onError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal
      title="Reorder Categories/Products"
      onClose={props.onClose}
      onSave={handleSave}
      saving={() => saving()}
      saveDisabled={saving() || loading() || !hasUnsavedChanges()}
      hasUnsavedChanges={() => hasUnsavedChanges()}
    >
      <div class="mx-auto flex w-full flex-col">
        <div class="pb-6 text-base">
          Change the order of product categories/products by moving the items up
          or down.<br />
          <br />
          This affects how products are displayed in the closing
          submission form.
        </div>
        <div class="flex-1 space-y-2">
          <Show
            when={!loading()}
            fallback={
              <div class="py-4">
                <LoadingState label="Loading categories..." />
              </div>
            }
          >
            <Show
              when={!error()}
              fallback={
                <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-700">
                  {error()}
                </div>
              }
            >
              <div class="flex border-b border-gray-200">
                <button
                  type="button"
                  onClick={() => setActiveTab("basePlans")}
                  class={`relative flex flex-1 items-center justify-center gap-2 pb-3 text-base font-semibold transition ${
                    activeTab() === "basePlans"
                      ? "text-admin-from"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <TbOutlineStack class="h-4 w-4" />
                  <span>Base Plans</span>
                  <Show when={activeTab() === "basePlans"}>
                    <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-admin-from" />
                  </Show>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("riders")}
                  class={`relative flex flex-1 items-center justify-center gap-2 pb-3 text-base font-semibold transition ${
                    activeTab() === "riders"
                      ? "text-admin-from"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <TbOutlinePuzzle class="h-4 w-4" />
                  <span>Riders & Top-ups</span>
                  <Show when={activeTab() === "riders"}>
                    <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-admin-from" />
                  </Show>
                </button>
              </div>

              <div class="p-0">
                <ReorderList
                  items={activeOrder()}
                  itemKey={(category) => category}
                  onMove={moveCategory}
                  onItemClick={(category) => toggleExpanded(category)}
                  emptyMessage="No categories available."
                  renderLabel={(category) => (
                    <div class="flex items-center justify-between">
                      <div class="text-base font-medium text-gray-800">
                        {category}
                      </div>
                      <div class="pr-2">
                        <TbOutlineChevronDown
                          class={`h-4 w-4 text-gray-400 transition-transform ${isExpanded(category) ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>
                  )}
                  renderExpanded={(category) =>
                    isExpanded(category) ? (
                      <div class="border-t border-gray-100 bg-white">
                        <ReorderList
                          items={getBucket(category)?.items || []}
                          itemKey={(item) =>
                            String(item.id || item.fullName || "")
                          }
                          onMove={(from, to) => moveItem(category, from, to)}
                          emptyMessage="No items."
                          class="ml-4 border-l border-admin-from/30"
                          renderLabel={(item) => (
                            <div class="min-w-0">
                              <div class="whitespace-normal break-words text-sm font-medium text-gray-800">
                                {item.fullName || "Unnamed"}
                              </div>
                              <div class="text-sm text-gray-500">
                                {item.shortName || item.id}
                              </div>
                            </div>
                          )}
                        />
                      </div>
                    ) : undefined
                  }
                />
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </EditModal>
  );
};

export default ProductReorderModal;
