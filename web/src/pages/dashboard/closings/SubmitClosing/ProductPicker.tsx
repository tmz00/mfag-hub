import {
  Component,
  createMemo,
  createResource,
  Show,
  type JSX,
} from "solid-js";
import {
  TbOutlinePlus,
  TbOutlineStack,
} from "solid-icons/tb";
import ProductCatalogBrowser from "../../../../components/ProductCatalogBrowser";
import {
  productsService,
  type BasePlan,
  type Rider,
  type ProductItem,
} from "../../../../services/productsService";
import type { TabKey } from "../../../admin/products/modals/types";
import { EditModal, Spinner } from "../../../../components/ui";
import { useNavigate } from "@solidjs/router";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (product: SelectedProduct) => void;
  mode: "basePlan" | "rider" | "replace" | "riderStandalone";
  attachableRiderIds?: string[];
};

export type SelectedProduct = {
  isRider?: boolean;
  productId: string;
  fullName: string;
  shortName: string;
  attachedSuffix?: string;
  category?: string;
  type?: string;
  notes?: string;
  fycRate: number;
  gst: boolean;
  premiumTermOrIssueAge?: string;
  optionTitle?: string;
  options?: Array<{ label: string; fycRate: string }>;
  frequencies?: string[];
  attachableRiders?: string[];
};

type FycSummary = {
  text: string;
  variesBy?: string;
};

const normalizeOptions = (
  options: unknown,
): Array<{ label: string; fycRate: string }> =>
  Array.isArray(options) ? options : [];

const getFycSummary = (
  options: Array<{ label: string; fycRate: string }> | undefined,
  variesByLabel: string | undefined,
  fallbackRate?: string,
): FycSummary | null => {
  const entries = normalizeOptions(options).map((option) => [
    option.label,
    option.fycRate,
  ]);
  if (!entries.length) {
    if (!fallbackRate) return null;
    if (fallbackRate === "-1") return { text: "follows base plan" };
    if (fallbackRate === "0") return { text: "0%" };
    return { text: `${fallbackRate}%` };
  }

  if (entries.length === 1) {
    const rate = entries[0][1] || "";
    if (rate === "-1") return { text: "follows base plan" };
    if (rate === "0") return { text: "0%" };
    return { text: `${rate}%` };
  }

  const numericRates = entries
    .map(([, rate]) => parseFloat(rate))
    .filter((rate) => !Number.isNaN(rate) && rate >= 0);

  let rangeText = "follows base plan";
  if (numericRates.length > 0) {
    const minRate = Math.min(...numericRates);
    const maxRate = Math.max(...numericRates);
    rangeText =
      minRate === maxRate ? `${minRate}%` : `${minRate}% - ${maxRate}%`;
  }

  return {
    text: rangeText,
    variesBy: variesByLabel || "option",
  };
};

const ProductPicker: Component<Props> = (props) => {
  const navigate = useNavigate();
  const isRiderMode = () =>
    props.mode === "rider" || props.mode === "riderStandalone";
  const isBasePlanMode = () =>
    props.mode === "basePlan" || props.mode === "replace";

  const createCustomProduct = (): SelectedProduct => ({
    isRider: props.mode === "riderStandalone",
    productId: `custom-${Date.now()}`,
    fullName: "Not in list",
    shortName: "",
    category: "Other",
    type: "",
    notes: undefined,
    fycRate: 0,
    options: undefined,
    frequencies: undefined,
    gst: false,
  });

  const [products] = createResource(() => productsService.getProducts());

  const basePlans = createMemo<BasePlan[]>(() => products()?.basePlans || []);
  const ridersList = createMemo<Rider[]>(() => products()?.riders || []);

  const shouldShowOtherCategory = () =>
    isBasePlanMode() || props.mode === "riderStandalone";

  const closePicker = () => {
    props.onClose();
  };

  const handleSelectProduct = (product: BasePlan | Rider) => {
    const optionEntries = normalizeOptions(product.options)
      .map((option) => [option.label, option.fycRate])
      .sort((left, right) => {
        const leftRate = Number(left[1]);
        const rightRate = Number(right[1]);
        const normalizedLeft = Number.isFinite(leftRate) ? leftRate : -Infinity;
        const normalizedRight = Number.isFinite(rightRate)
          ? rightRate
          : -Infinity;
        if (normalizedLeft !== normalizedRight) {
          return normalizedRight - normalizedLeft;
        }
        return String(left[0]).localeCompare(String(right[0]));
      });
    const fallbackRate =
      optionEntries.length > 0
        ? parseFloat(optionEntries[0]?.[1] || "0")
        : parseFloat(product.fycRate || "0");
    const fycRate = Number.isNaN(fallbackRate) ? 0 : fallbackRate;

    const selected: SelectedProduct = {
      isRider: isRiderMode(),
      productId: product.id,
      fullName: product.fullName || "",
      shortName: product.shortName || "",
      attachedSuffix: (product as Rider).attachedSuffix,
      category: product.category,
      type: product.type,
      notes: product.notes,
      fycRate,
      gst: product.gst === "Y",
      premiumTermOrIssueAge: undefined,
      optionTitle: product.optionTitle,
      options: product.options,
      frequencies: product.frequencies,
      attachableRiders: (product as BasePlan).attachableRiders,
    };

    props.onSelect(selected);
    closePicker();
  };

  const handleClose = () => {
    closePicker();
  };

  // Filter riders to only attachable IDs when in rider mode
  const filterProducts = (items: ProductItem[], tab: TabKey) => {
    if (
      tab === "riders" &&
      isRiderMode() &&
      props.attachableRiderIds &&
      props.attachableRiderIds.length > 0
    ) {
      const allowedIds = new Set(
        props.attachableRiderIds.map((id) => String(id)),
      );
      return items.filter((r) => allowedIds.has(String(r.id)));
    }
    return items;
  };

  const renderItem = (
    item: ProductItem,
    _index: number,
    _tab: TabKey,
    highlight: (text: string) => JSX.Element,
  ): JSX.Element => {
    const fycSummary = () =>
      getFycSummary(item.options, item.optionTitle, item.fycRate);

    return (
      <div class="mb-2 rounded-lg shadow-sm">
        <button
          type="button"
          onClick={() => handleSelectProduct(item)}
          class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-l-4 border-l-primary border-y border-r border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-base font-medium text-gray-950">
                {highlight(item.fullName || "Unnamed Product")}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <Show when={item.shortName}>
                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-base text-gray-700">
                  {highlight(item.shortName || "")}
                </span>
              </Show>
              <Show when={fycSummary()}>
                {(summary) => (
                  <Show when={summary().variesBy}>
                    <span class="rounded bg-primary/10 px-1.5 py-0.5 text-base font-medium text-primary">
                      FYC varies by {summary().variesBy}
                    </span>
                  </Show>
                )}
              </Show>
            </div>
          </div>
          <Show when={fycSummary()}>
            {(summary) => {
              const parts = summary().text.split(/\s*-\s*/);
              const hasRange = parts.length === 2;
              return (
                <div class="flex w-10 shrink-0 flex-col items-center justify-center text-base text-gray-600">
                  {hasRange ? (
                    <>
                      <span>{parts[0]}</span>
                      <span class="text-[10px] uppercase text-gray-500">
                        to
                      </span>
                      <span>{parts[1]}</span>
                    </>
                  ) : (
                    <span>{summary().text}</span>
                  )}
                </div>
              );
            }}
          </Show>
        </button>
      </div>
    );
  };

  const extraFooter = () =>
    shouldShowOtherCategory() ? (
      <section class="pt-3">
        <div class="mb-4 border-b border-gray-200 bg-primary-500">
          <div class="flex items-center gap-2 px-3 py-2">
            <div class="flex h-6 w-6 items-center justify-center rounded bg-white/20">
              <TbOutlineStack class="h-3.5 w-3.5 text-white" />
            </div>
            <h3 class="font-condensed text-lg font-semibold text-white">
              Other
            </h3>
            <span class="font-condensed text-white">(1)</span>
          </div>
        </div>
        <div class="rounded-lg shadow-sm">
          <button
            type="button"
            onClick={() => {
              props.onSelect(createCustomProduct());
              closePicker();
            }}
            class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-l-4 border-l-primary border-y border-r border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-base font-medium text-gray-950">
                  Not in list
                </span>
              </div>
            </div>
            <TbOutlinePlus class="h-4 w-4 text-gray-500" />
          </button>
        </div>
      </section>
    ) : undefined;

  return (
    <Show when={props.isOpen}>
      <EditModal
        title={isBasePlanMode() ? "Select Base Plan" : "Select Rider/Top-Up"}
        onClose={handleClose}
        manageHistoryEntry
        bodyClass="pb-6 pt-0 px-4"
      >
        <ProductCatalogBrowser
          basePlans={basePlans()}
          riders={ridersList()}
          accentColor="primary"
          initialTab={isRiderMode() ? "riders" : "basePlans"}
          showTabs={false}
          showSearchEmptyActions={false}
          filterProducts={filterProducts}
          renderItem={renderItem}
          extraFooter={extraFooter()}
          loading={products.loading}
          loadingFallback={
            <div class="flex items-center justify-center py-8">
              <Spinner class="h-8 w-8 text-primary" />
            </div>
          }
        />
      </EditModal>
    </Show>
  );
};

export default ProductPicker;
