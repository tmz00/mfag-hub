import {
  Component,
  createSignal,
  For,
  Show,
  Setter,
} from "solid-js";
import { Button, IconButton, createConfirm } from "../../../../components/ui";
import {
  TbOutlineChevronLeft,
  TbOutlineChevronRight,
  TbOutlinePuzzle,
  TbOutlinePencil,
  TbOutlineTrash,
} from "solid-icons/tb";
import {
  getAnnualizedFYP,
  getFYC,
} from "../../../../services/closingsService";
import type {
  ClosingDraft,
  DraftProduct,
} from "./SubmitClosing";
import ProductPicker, { type SelectedProduct } from "./ProductPicker";
import { classificationBadgeClass } from "../../../../utils/productBadges";
import {
  consolidatePremiumRows,
  formatCurrency,
  formatFrequencySummary,
  cloneDraftProduct,
  generateId,
  isAddonProduct,
} from "./_planUtils";
import { appendAttachedSuffixesFromRiders } from "../../../../utils/attachedSuffix";

type Props = {
  draft: ClosingDraft;
  setDraft: Setter<ClosingDraft>;
  onNext: () => void;
  onPrev: () => void;
  canProceed: boolean;
  showNavigation?: boolean;
  showActions?: boolean;
  onEditPlan: (product: DraftProduct, index: number | null, isAddon: boolean) => void;
  highlightProductId?: string | null;
};

const PlansSection: Component<Props> = (props) => {
  const showNavigation = () => props.showNavigation !== false;
  const showActions = () => props.showActions !== false;
  const [showPicker, setShowPicker] = createSignal(false);
  const [pickerMode, setPickerMode] = createSignal<
    "basePlan" | "riderStandalone"
  >("basePlan");
  const [removingProductId, setRemovingProductId] = createSignal<string | null>(null);

  const createDraftProduct = (selected: SelectedProduct): DraftProduct => {
    const newId = generateId();
    return {
      id: newId,
      isRider: Boolean(selected.isRider),
      productId: selected.productId,
      fullName: selected.fullName,
      shortName: selected.shortName,
      attachedSuffix: selected.attachedSuffix,
      category: selected.category,
      type: selected.type,
      notes: selected.notes,
      premiumTermOrIssueAge: undefined,
      optionTitle: selected.optionTitle,
      options: selected.options,
      fycRate: selected.fycRate,
      frequencies: selected.frequencies,
      gst: selected.gst,
      premiumRows: [],
      riders: [],
      attachableRiders: selected.attachableRiders,
    };
  };

  const handleRemoveProduct = (productIndex: number) => {
    const productId = props.draft.products[productIndex]?.id;
    if (!productId) return;
    setRemovingProductId(productId);
    setTimeout(() => {
      setRemovingProductId(null);
      props.setDraft((d) => ({
        ...d,
        products: d.products.filter((p) => p.id !== productId),
      }));
    }, 280);
  };

  const [RemoveProductModal, confirmRemoveProduct] = createConfirm({
    title: "Remove product",
    confirmLabel: "Remove",
    variant: "danger",
  });

  const openBasePlanPicker = () => {
    setPickerMode("basePlan");
    setShowPicker(true);
  };

  const openStandaloneRiderPicker = () => {
    setPickerMode("riderStandalone");
    setShowPicker(true);
  };

  const handlePickerSelect = (selected: SelectedProduct) => {
    const mode = pickerMode();
    if (mode === "basePlan") {
      const newProduct = createDraftProduct(selected);
      props.onEditPlan(newProduct, null, false);
    } else if (mode === "riderStandalone") {
      const newProduct = createDraftProduct(selected);
      const baseName = selected.shortName || selected.fullName;
      newProduct.shortName = baseName ? `add on ${baseName}` : "add on";
      props.onEditPlan(newProduct, null, true);
    }
  };

  // Calculate base plan FYP/FYC for display (includes quantity multiplier)
  const getBaseProductCalcs = (product: DraftProduct) => {
    const gstPercent = product.gst ? 9 : 0;
    const isSingle = product.type?.toLowerCase() === "single";
    const fypMultiplier = isSingle ? 0.1 : 1;

    let baseFyp = 0;
    let baseFyc = 0;
    for (const row of product.premiumRows) {
      if (!row.frequency) continue;
      const quantity = row.quantity || 1;
      baseFyp +=
        getAnnualizedFYP(row.premium, row.frequency, gstPercent) *
        quantity *
        fypMultiplier;
      baseFyc +=
        getFYC(row.premium, row.frequency, product.fycRate, gstPercent) *
        quantity;
    }

    return { fyp: baseFyp, fyc: baseFyc };
  };

  const getRiderCalcs = (
    rider: DraftProduct,
    baseFycRate: number,
    isSingle: boolean = false,
  ) => {
    const gstPercent = rider.gst ? 9 : 0;
    const effectiveRate = rider.fycRate === -1 ? baseFycRate : rider.fycRate;
    const fypMultiplier = isSingle ? 0.1 : 1;
    let fyp = 0;
    let fyc = 0;
    for (const row of rider.premiumRows) {
      if (!row.frequency) continue;
      const quantity = row.quantity || 1;
      fyp +=
        getAnnualizedFYP(row.premium, row.frequency, gstPercent) *
        quantity *
        fypMultiplier;
      fyc +=
        getFYC(row.premium, row.frequency, effectiveRate, gstPercent) *
        quantity;
    }
    return { fyp, fyc };
  };

  return (
    <div class="space-y-6">
      {/* Product List */}
      <Show when={props.draft.products.length > 0}>
        <div class="space-y-3">
          <For each={props.draft.products}>
            {(product, productIndex) => {
              const calcs = () => getBaseProductCalcs(product);
              const productDisplayName = () => {
                const baseShortName = product.shortName || product.fullName;
                return product.shortNameManuallyEdited
                  ? baseShortName
                  : appendAttachedSuffixesFromRiders(
                      baseShortName,
                      product.riders,
                    );
              };
              const hasValidPremium = () =>
                product.premiumRows.every(
                  (row) => row.premium > 0 && Boolean(row.frequency),
                );
              return (
                <div
                  id={`submit-plan-${product.id}`}
                  class={`relative border-b border-gray-200 ${product.id === removingProductId() ? "animate-row-remove" : ""} ${product.id === props.highlightProductId ? "animate-row-highlight" : ""}`}
                >
                  <div class="w-full px-4 py-3 text-left">
                    <div class="min-w-0">
                      <div>
                        <span class="text-base font-semibold text-gray-950">
                          {productDisplayName()}
                        </span>
                        <div class="mt-1 flex flex-wrap items-center gap-1.5">
                          <span class="rounded bg-primary/10 px-1.5 py-0.5 text-base font-medium text-primary">
                            {product.fycRate === -1
                              ? "follows base"
                              : `${product.fycRate}%`}
                          </span>
                          <Show when={product.type}>
                            <span
                              class={`rounded px-1.5 py-0.5 text-base font-medium ${classificationBadgeClass(
                                product.type!,
                              )}`}
                            >
                              {product.type}
                            </span>
                          </Show>
                          <Show when={product.gst}>
                            <span class="rounded bg-yellow-50 px-1.5 py-0.5 text-base font-medium text-yellow-700">
                              GST
                            </span>
                          </Show>
                        </div>
                      </div>
                      <Show
                        when={hasValidPremium()}
                        fallback={
                          <div class="mt-1 text-base text-red-500">
                            Please key in premium / frequency
                          </div>
                        }
                      >
                        <div class="mt-1 space-y-0.5 text-base text-gray-600">
                          <For
                            each={consolidatePremiumRows(product.premiumRows)}
                          >
                            {(row) => (
                              <div>
                               {row.quantity} × 
                                ${formatCurrency(row.premium)} /{" "}
                                {formatFrequencySummary(row.frequency)}
                              </div>
                            )}
                          </For>
                        </div>
                        <div class="mt-1 text-base text-green-600">
                          <div>FYC: ${formatCurrency(calcs().fyc)}</div>
                          <div>AFYP: ${formatCurrency(calcs().fyp)}</div>
                        </div>
                        <Show when={product.riders.length > 0}>
                          <div class="mt-2 space-y-2 border-l-2 border-purple-200 pl-3">
                            <For each={product.riders}>
                              {(rider) => {
                                const riderCalcs = getRiderCalcs(
                                  rider,
                                  product.fycRate,
                                  product.type?.toLowerCase() === "single",
                                );
                                const effectiveRate =
                                  rider.fycRate === -1
                                    ? product.fycRate
                                    : rider.fycRate;
                                return (
                                  <div>
                                    <div class="flex flex-wrap items-center gap-1.5">
                                      <TbOutlinePuzzle class="h-3.5 w-3.5 text-purple-500" />
                                      <span class="text-base font-medium text-gray-800">
                                        {rider.shortName || rider.fullName}
                                      </span>
                                      <span class="rounded bg-primary/10 px-1.5 py-0.5 text-base font-medium text-primary">
                                        {rider.fycRate === -1
                                          ? `follows base (${product.fycRate}%)`
                                          : `${effectiveRate}%`}
                                      </span>
                                    </div>
                                    <Show
                                      when={rider.premiumRows.every(
                                        (row) =>
                                          row.premium > 0 &&
                                          Boolean(row.frequency),
                                      )}
                                      fallback={
                                        <div class="mt-0.5 pl-5 text-base text-red-500">
                                          Please key in premium / frequency
                                        </div>
                                      }
                                    >
                                      <div class="mt-0.5 space-y-0.5 pl-5 text-base text-gray-500">
                                        <For
                                          each={consolidatePremiumRows(
                                            rider.premiumRows,
                                          )}
                                        >
                                          {(row) => (
                                            <div>
                                              ${formatCurrency(row.premium)} /{" "}
                                              {formatFrequencySummary(
                                                row.frequency,
                                              )}
                                              <Show when={row.quantity > 1}>
                                                {" "}
                                                × {row.quantity}
                                              </Show>
                                            </div>
                                          )}
                                        </For>
                                      </div>
                                      <div class="mt-0.5 pl-5 text-base text-green-600">
                                        <div>
                                          FYC: ${formatCurrency(riderCalcs.fyc)}
                                        </div>
                                        <div>
                                          AFYP: $
                                          {formatCurrency(riderCalcs.fyp)}
                                        </div>
                                      </div>
                                    </Show>
                                  </div>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </div>
                    <div class="absolute right-4 top-3 flex items-center gap-2">
                      <IconButton
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onEditPlan(
                            cloneDraftProduct(product),
                            productIndex(),
                            isAddonProduct(product),
                          );
                        }}
                        class="rounded-md border border-primary/30 text-primary hover:bg-primary/10"
                        title="Edit plan"
                        aria-label="Edit plan"
                      >
                        <TbOutlinePencil />
                      </IconButton>
                      <IconButton
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (
                            await confirmRemoveProduct({
                              message: `Remove ${product.shortName || product.fullName}?`,
                            })
                          ) {
                            handleRemoveProduct(productIndex());
                          }
                        }}
                        class="rounded-md border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"
                        title="Remove plan"
                        aria-label="Remove plan"
                      >
                        <TbOutlineTrash />
                      </IconButton>
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={showActions()}>
        <div class="space-y-3">
          <Button
            id="submit-add-new-business-btn"
            type="button"
            onClick={openBasePlanPicker}
            variant="primarySoft"
            fullWidth
            class="rounded-lg py-4"
          >
            Add New Business
          </Button>
          <Button
            type="button"
            onClick={openStandaloneRiderPicker}
            variant="primarySoft"
            fullWidth
            class="rounded-lg py-4"
          >
            Add-on To Existing Policy
          </Button>
        </div>
      </Show>

      <Show when={showNavigation()}>
        <div class="flex justify-between pt-4">
          <button
            type="button"
            onClick={props.onPrev}
            class="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-base font-medium text-gray-800 shadow-sm transition hover:bg-gray-10"
          >
            <TbOutlineChevronLeft class="h-4 w-4" />
            Back
          </button>

          <button
            type="button"
            onClick={props.onNext}
            disabled={!props.canProceed}
            class="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-base font-semibold text-white shadow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next: Sharing
            <TbOutlineChevronRight class="h-4 w-4" />
          </button>
        </div>
      </Show>

      {/* Product Picker (basePlan / riderStandalone modes only) */}
      <ProductPicker
        isOpen={showPicker()}
        onClose={() => setShowPicker(false)}
        onSelect={handlePickerSelect}
        mode={pickerMode()}
      />

      <RemoveProductModal />
    </div>
  );
};

export default PlansSection;
