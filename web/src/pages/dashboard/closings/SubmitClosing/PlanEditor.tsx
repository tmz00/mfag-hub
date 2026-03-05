import {
  Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  Button,
  EditModal,
  IconButton,
  PageHeader,
  createConfirm,
  createNavigationGuard,
} from "../../../../components/ui";
import {
  TbOutlinePlus,
  TbOutlineTrash,
  TbOutlinePuzzle,
  TbOutlinePencil,
  TbOutlineSearch,
  TbOutlineCheck,
  TbOutlineCurrency,
  TbOutlineFileDollar,
} from "solid-icons/tb";
import {
  productsService,
  type BasePlan,
  type Rider,
} from "../../../../services/productsService";
import {
  type PremiumFrequency,
  premiumFrequencyLabels,
} from "../../../../services/closingsService";
import type { DraftProduct } from "./SubmitClosing";
import ProductPicker, { type SelectedProduct } from "./ProductPicker";
import { classificationBadgeClass } from "../../../../utils/productBadges";
import {
  cloneDraftProduct,
  isProductComplete,
  areProductsEqual,
  isCustomProduct,
  parseAttachableRiders,
  normalizeOptions,
  getOptionEntries,
  getAllowedFrequencies,
  generateId,
  generateRowId,
  formatCurrency,
  formatFrequencySummary,
} from "./_planUtils";
import {
  getEditPlan,
  clearEditPlan,
  updateSavedDraft,
  getSavedState,
  setPendingHighlightProductId,
  setPendingScrollToAddNewBusiness,
} from "./_submitStore";

const PlanEditor: Component = () => {
  const navigate = useNavigate();
  const navigateBack = (fallbackHref: string) => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(fallbackHref, { replace: true });
  };
  let addRiderButtonRef: HTMLDivElement | undefined;
  let contentScrollRef: HTMLDivElement | undefined;

  // Read edit plan data from store
  const planData = getEditPlan();

  // If no plan data, redirect back
  if (!planData) {
    navigateBack("/closings/submit");
    return null as any;
  }

  const [editingProduct, setEditingProduct] = createSignal<DraftProduct | null>(
    cloneDraftProduct(planData.product),
  );
  const [originalEditingProduct, setOriginalEditingProduct] =
    createSignal<DraftProduct | null>(
      cloneDraftProduct(planData.product),
    );
  const [rowEditor, setRowEditor] = createSignal<{
    scope: "product" | "rider";
    riderIndex?: number;
    rowIndex: number | null;
    quantity: string;
    premium: string;
    frequency: PremiumFrequency | "";
  } | null>(null);
  const [rowEditorError, setRowEditorError] = createSignal("");
  const [showPicker, setShowPicker] = createSignal(false);
  const [pickerMode, setPickerMode] = createSignal<"replace" | "rider">(
    "replace",
  );
  const [pendingScrollToAddRider, setPendingScrollToAddRider] =
    createSignal<string | null>(null);

  // Row animation feedback
  const [highlightedRowId, setHighlightedRowId] = createSignal<string | null>(null);
  const [removingRowId, setRemovingRowId] = createSignal<string | null>(null);
  let highlightTimeout: number | undefined;

  const highlightRow = (id: string) => {
    if (highlightTimeout !== undefined) clearTimeout(highlightTimeout);
    setHighlightedRowId(id);
    highlightTimeout = window.setTimeout(() => setHighlightedRowId(null), 1800);
  };

  // Rider card animation feedback
  const [highlightedRiderId, setHighlightedRiderId] = createSignal<string | null>(null);
  const [removingRiderId, setRemovingRiderId] = createSignal<string | null>(null);
  let riderHighlightTimeout: number | undefined;

  const highlightRider = (id: string) => {
    if (riderHighlightTimeout !== undefined) clearTimeout(riderHighlightTimeout);
    setHighlightedRiderId(id);
    riderHighlightTimeout = window.setTimeout(() => setHighlightedRiderId(null), 1800);
  };

  // Load catalog data
  const [productsCatalog] = createResource(() => productsService.getProducts());
  const basePlans = createMemo<BasePlan[]>(
    () => productsCatalog()?.basePlans || [],
  );
  const ridersCatalog = createMemo<Rider[]>(
    () => productsCatalog()?.riders || [],
  );
  const typeEntries = createMemo(() =>
    Object.entries(productsCatalog()?.types || {}),
  );

  const [RemoveRiderModal, confirmRemoveRider] = createConfirm({
    title: "Remove rider",
    confirmLabel: "Remove",
    variant: "danger",
  });

  // Auto-apply single frequency
  const applySingleFrequency = (product: DraftProduct): DraftProduct => {
    const allowed = getAllowedFrequencies(product);
    let changed = false;
    let updatedProduct = product;

    if (allowed.length === 1) {
      const frequency = allowed[0];
      const updatedRows = product.premiumRows.map((row) => {
        if (row.frequency !== frequency) {
          changed = true;
          return { ...row, frequency };
        }
        return row;
      });
      updatedProduct = { ...updatedProduct, premiumRows: updatedRows };
    }

    const updatedRiders = updatedProduct.riders.map((rider) => {
      const riderAllowed = getAllowedFrequencies(rider);
      if (riderAllowed.length !== 1) return rider;
      const riderFrequency = riderAllowed[0];
      let riderChanged = false;
      const updatedRows = rider.premiumRows.map((row) => {
        if (row.frequency !== riderFrequency) {
          riderChanged = true;
          return { ...row, frequency: riderFrequency };
        }
        return row;
      });
      if (riderChanged) {
        changed = true;
        return { ...rider, premiumRows: updatedRows };
      }
      return rider;
    });

    if (changed) {
      return { ...updatedProduct, riders: updatedRiders };
    }
    return product;
  };

  createEffect(() => {
    const current = editingProduct();
    if (!current) return;
    const updated = applySingleFrequency(current);
    if (updated !== current) {
      setEditingProduct(updated);
    }
  });

  // --- Handlers ---

  const getCatalogShortNameForProduct = (
    product: DraftProduct,
  ): string | null => {
    if (product.isRider) {
      const riders = ridersCatalog();
      const match =
        riders.find(
          (rider) =>
            String(rider.id || "") === String(product.productId || "") &&
            (rider.fullName || "") === (product.fullName || "") &&
            (rider.category || "") === (product.category || ""),
        ) ||
        riders.find(
          (rider) => String(rider.id || "") === String(product.productId || ""),
        );
      const shortName = String(match?.shortName || "").trim();
      return shortName || null;
    }

    const plans = basePlans();
    const match =
      plans.find(
        (plan) =>
          plan.id === product.productId &&
          (plan.fullName || "") === (product.fullName || "") &&
          (plan.category || "") === (product.category || ""),
      ) || plans.find((plan) => plan.id === product.productId);
    const shortName = String(match?.shortName || "").trim();
    return shortName || null;
  };

  const buildShortNameState = (
    product: DraftProduct,
    value: string,
  ): Pick<DraftProduct, "shortName" | "shortNameManuallyEdited"> => {
    const catalogDefault = getCatalogShortNameForProduct(product);
    const fallbackDefault = String(planData.product.shortName || "");
    const defaultShortName = (catalogDefault ?? fallbackDefault).trim();
    const normalizedValue = value.trim();

    return {
      shortName: value,
      shortNameManuallyEdited: normalizedValue !== defaultShortName,
    };
  };

  const handleProductShortNameChange = (value: string) => {
    setEditingProduct((current) => {
      if (!current) return current;
      return {
        ...current,
        ...buildShortNameState(current, value),
      };
    });
  };

  const handleProductShortNameBlur = () => {
    setEditingProduct((current) => {
      if (!current) return current;
      const trimmed = String(current.shortName || "").trim();
      const nextState = buildShortNameState(current, trimmed);
      if (
        current.shortName === nextState.shortName &&
        Boolean(current.shortNameManuallyEdited) ===
          Boolean(nextState.shortNameManuallyEdited)
      ) {
        return current;
      }
      return { ...current, ...nextState };
    });
  };

  const handleProductFycRateChange = (value: string) => {
    const rate = parseFloat(value);
    setEditingProduct((current) =>
      current
        ? { ...current, fycRate: Number.isNaN(rate) ? 0 : rate }
        : current,
    );
  };

  const handleProductTypeChange = (value: string) => {
    setEditingProduct((current) =>
      current ? { ...current, type: value } : current,
    );
  };

  const handleProductGstChange = (checked: boolean) => {
    setEditingProduct((current) =>
      current ? { ...current, gst: checked } : current,
    );
  };

  const handleRemoveRider = (riderIndex: number) => {
    const product = editingProduct();
    if (!product) return;
    const riderId = product.riders[riderIndex]?.id;
    if (!riderId) return;
    setRemovingRiderId(riderId);
    setTimeout(() => {
      setRemovingRiderId(null);
      setEditingProduct((current) => {
        if (!current) return current;
        return {
          ...current,
          riders: current.riders.filter((r) => r.id !== riderId),
        };
      });
    }, 280);
  };

  const handleProductRowPremiumChange = (rowIndex: number, value: string) => {
    const premium = parseFloat(value) || 0;
    setEditingProduct((current) => {
      if (!current) return current;
      const rows = [...current.premiumRows];
      rows[rowIndex] = { ...rows[rowIndex], premium };
      return { ...current, premiumRows: rows };
    });
  };

  const handleProductRowFrequencyChange = (
    rowIndex: number,
    frequency: PremiumFrequency | "",
  ) => {
    setEditingProduct((current) => {
      if (!current) return current;
      const rows = [...current.premiumRows];
      rows[rowIndex] = { ...rows[rowIndex], frequency };
      return { ...current, premiumRows: rows };
    });
  };

  const handleRemoveProductRow = (rowIndex: number) => {
    const product = editingProduct();
    if (!product) return;
    const rowId = product.premiumRows[rowIndex]?.id;
    if (!rowId) return;
    setRemovingRowId(rowId);
    setTimeout(() => {
      setRemovingRowId(null);
      setEditingProduct((current) => {
        if (!current) return current;
        return { ...current, premiumRows: current.premiumRows.filter((r) => r.id !== rowId) };
      });
    }, 280);
  };

  const handleRiderRowPremiumChange = (
    riderIndex: number,
    rowIndex: number,
    value: string,
  ) => {
    const premium = parseFloat(value) || 0;
    setEditingProduct((current) => {
      if (!current) return current;
      const riders = [...current.riders];
      const rows = [...riders[riderIndex].premiumRows];
      rows[rowIndex] = { ...rows[rowIndex], premium };
      riders[riderIndex] = { ...riders[riderIndex], premiumRows: rows };
      return { ...current, riders };
    });
  };

  const handleRiderRowFrequencyChange = (
    riderIndex: number,
    rowIndex: number,
    frequency: PremiumFrequency | "",
  ) => {
    setEditingProduct((current) => {
      if (!current) return current;
      const riders = [...current.riders];
      const rows = [...riders[riderIndex].premiumRows];
      rows[rowIndex] = { ...rows[rowIndex], frequency };
      riders[riderIndex] = { ...riders[riderIndex], premiumRows: rows };
      return { ...current, riders };
    });
  };

  const handleRiderFycRateChange = (riderIndex: number, value: string) => {
    const parsed = value.trim() === "" ? -1 : parseFloat(value);
    const rate = Number.isNaN(parsed) ? -1 : parsed;
    setEditingProduct((current) => {
      if (!current) return current;
      const riders = [...current.riders];
      riders[riderIndex] = { ...riders[riderIndex], fycRate: rate };
      return { ...current, riders };
    });
  };

  const handleRemoveRiderRow = (riderIndex: number, rowIndex: number) => {
    const product = editingProduct();
    if (!product) return;
    const rider = product.riders[riderIndex];
    if (!rider) return;
    const rowId = rider.premiumRows[rowIndex]?.id;
    if (!rowId) return;
    setRemovingRowId(rowId);
    setTimeout(() => {
      setRemovingRowId(null);
      setEditingProduct((current) => {
        if (!current) return current;
        const riders = [...current.riders];
        const target = riders[riderIndex];
        if (!target) return current;
        riders[riderIndex] = {
          ...target,
          premiumRows: target.premiumRows.filter((r) => r.id !== rowId),
        };
        return { ...current, riders };
      });
    }, 280);
  };

  const openProductRowEditor = (rowIndex?: number) => {
    const current = editingProduct();
    if (!current) return;
    const row =
      rowIndex !== undefined ? current.premiumRows[rowIndex] : undefined;
    const allowed = getAllowedFrequencies(current);
    const defaultFrequency =
      row?.frequency || (allowed.length === 1 ? allowed[0] : "");
    setRowEditor({
      scope: "product",
      rowIndex: rowIndex ?? null,
      quantity: row ? String(Math.max(1, row.quantity || 1)) : "1",
      premium: row ? String(row.premium || "") : "",
      frequency: defaultFrequency,
    });
    setRowEditorError("");
  };

  const openRiderRowEditor = (riderIndex: number, rowIndex?: number) => {
    const current = editingProduct();
    if (!current) return;
    const rider = current.riders[riderIndex];
    if (!rider) return;
    const row =
      rowIndex !== undefined ? rider.premiumRows[rowIndex] : undefined;
    const allowed = getAllowedFrequencies(rider);
    const basePlanFrequency = current.premiumRows[0]?.frequency || "";
    const defaultFrequency =
      row?.frequency ||
      (allowed.length === 1 ? allowed[0] : "") ||
      (basePlanFrequency && allowed.includes(basePlanFrequency)
        ? basePlanFrequency
        : "");
    setRowEditor({
      scope: "rider",
      riderIndex,
      rowIndex: rowIndex ?? null,
      quantity: row ? String(Math.max(1, row.quantity || 1)) : "1",
      premium: row ? String(row.premium || "") : "",
      frequency: defaultFrequency,
    });
    setRowEditorError("");
  };

  const closeRowEditor = () => {
    setRowEditor(null);
    setRowEditorError("");
  };

  const saveRowEditor = () => {
    const editor = rowEditor();
    if (!editor) return;
    if (!editor.quantity.trim()) {
      setRowEditorError("Quantity is required.");
      return;
    }
    const parsedQuantity = Number(editor.quantity);
    if (
      !Number.isFinite(parsedQuantity) ||
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity <= 0
    ) {
      setRowEditorError("Quantity must be a positive whole number.");
      return;
    }
    if (!editor.premium.trim()) {
      setRowEditorError("Premium is required.");
      return;
    }
    const parsedPremium = parseFloat(editor.premium);
    if (!Number.isFinite(parsedPremium) || parsedPremium <= 0) {
      setRowEditorError("Premium must be a positive number.");
      return;
    }
    if (!editor.frequency) {
      setRowEditorError("Frequency is required.");
      return;
    }

    const newId = editor.rowIndex === null ? generateRowId() : null;

    setEditingProduct((current) => {
      if (!current) return current;
      if (editor.scope === "product") {
        const rows = [...current.premiumRows];
        if (editor.rowIndex === null) {
          rows.push({
            id: newId!,
            premium: parsedPremium,
            frequency: editor.frequency,
            quantity: parsedQuantity,
          });
        } else {
          rows[editor.rowIndex] = {
            ...rows[editor.rowIndex],
            quantity: parsedQuantity,
            premium: parsedPremium,
            frequency: editor.frequency,
          };
        }
        return { ...current, premiumRows: rows };
      }
      const riderIndex = editor.riderIndex ?? -1;
      if (riderIndex < 0) return current;
      const riders = [...current.riders];
      const rider = riders[riderIndex];
      if (!rider) return current;
      const rows = [...rider.premiumRows];
      if (editor.rowIndex === null) {
        rows.push({
          id: newId!,
          premium: parsedPremium,
          frequency: editor.frequency,
          quantity: parsedQuantity,
        });
      } else {
        rows[editor.rowIndex] = {
          ...rows[editor.rowIndex],
          quantity: parsedQuantity,
          premium: parsedPremium,
          frequency: editor.frequency,
        };
      }
      riders[riderIndex] = { ...rider, premiumRows: rows };
      return { ...current, riders };
    });

    // Highlight the saved row
    if (newId) {
      highlightRow(newId);
    } else if (editor.rowIndex !== null) {
      const current = editingProduct();
      if (current) {
        const rowId =
          editor.scope === "product"
            ? current.premiumRows[editor.rowIndex]?.id
            : current.riders[editor.riderIndex ?? -1]?.premiumRows[editor.rowIndex]?.id;
        if (rowId) highlightRow(rowId);
      }
    }

    closeRowEditor();
  };

  const getFrequencyOptionLabel = (freq: PremiumFrequency) =>
    (premiumFrequencyLabels[freq] || freq)
      .replace("1 month", "1 mth")
      .replace("2 months", "2 mth");

  const getBasePlanOptionsForProduct = (product: DraftProduct) => {
    if (product.options && product.options.length > 0) {
      return getOptionEntries({ options: product.options });
    }
    const plans = basePlans();
    if (!plans.length) return [];
    const matchIndex = plans.findIndex(
      (plan) =>
        plan.id === product.productId &&
        (plan.fullName || "") === (product.fullName || "") &&
        (plan.shortName || "") === (product.shortName || "") &&
        (plan.category || "") === (product.category || ""),
    );
    const plan =
      matchIndex >= 0
        ? plans[matchIndex]
        : plans.find((p) => p.id === product.productId);
    if (!plan) return [];
    return getOptionEntries({
      options: plan.options,
    });
  };

  const getRiderOptionsForProduct = (product: DraftProduct) => {
    const riders = ridersCatalog();
    if (!riders.length) return [];
    const matchIndex = riders.findIndex(
      (rider) =>
        String(rider.id || "") === String(product.productId || "") &&
        (rider.fullName || "") === (product.fullName || "") &&
        (rider.shortName || "") === (product.shortName || "") &&
        (rider.category || "") === (product.category || ""),
    );
    const rider =
      matchIndex >= 0
        ? riders[matchIndex]
        : riders.find(
            (r) => String(r.id || "") === String(product.productId || ""),
          );
    if (!rider) {
      return getOptionEntries({
        options: product.options,
      });
    }
    return getOptionEntries({
      options: rider.options,
    });
  };

  const handleProductOptionChange = (value: string) => {
    setEditingProduct((current) => {
      if (!current) return current;
      if (!value) {
        return { ...current, premiumTermOrIssueAge: undefined };
      }
      const plan = basePlans().find(
        (p) =>
          p.id === current.productId &&
          (p.fullName || "") === (current.fullName || "") &&
          (p.shortName || "") === (current.shortName || "") &&
          (p.category || "") === (current.category || ""),
      );
      const rateValue = normalizeOptions(plan?.options ?? current.options).find(
        (option) => option.label === value,
      )?.fycRate;
      const rate = parseFloat(rateValue || "0");
      return {
        ...current,
        premiumTermOrIssueAge: value,
        optionTitle: plan?.optionTitle || current.optionTitle,
        fycRate: Number.isNaN(rate) ? 0 : rate,
      };
    });
  };

  const handleRiderOptionChange = (riderIndex: number, value: string) => {
    setEditingProduct((current) => {
      if (!current) return current;
      const riders = [...current.riders];
      const target = riders[riderIndex];
      if (!target) return current;
      if (!value) {
        riders[riderIndex] = { ...target, premiumTermOrIssueAge: undefined };
        return { ...current, riders };
      }
      const rider = ridersCatalog().find(
        (r) =>
          String(r.id || "") === String(target.productId || "") &&
          (r.fullName || "") === (target.fullName || "") &&
          (r.shortName || "") === (target.shortName || "") &&
          (r.category || "") === (target.category || ""),
      );
      const rateValue =
        normalizeOptions(rider?.options).find(
          (option) => option.label === value,
        )?.fycRate ??
        normalizeOptions(target.options).find(
          (option) => option.label === value,
        )?.fycRate;
      const rate = parseFloat(rateValue || "0");
      riders[riderIndex] = {
        ...target,
        premiumTermOrIssueAge: value,
        optionTitle: rider?.optionTitle || target.optionTitle,
        fycRate: Number.isNaN(rate) ? 0 : rate,
      };
      return { ...current, riders };
    });
  };

  const hasMissingRiderOptions = (product: DraftProduct) =>
    product.riders.some((rider) => {
      const options = getRiderOptionsForProduct(rider);
      return options.length > 0 && !rider.premiumTermOrIssueAge;
    });

  const getAttachableRiderIds = () => {
    const product = editingProduct();
    if (!product) return [];
    return parseAttachableRiders(product.attachableRiders);
  };

  const openReplacePlanPicker = () => {
    setPickerMode("replace");
    setShowPicker(true);
  };

  const openRiderPicker = () => {
    setPickerMode("rider");
    setShowPicker(true);
  };

  const scrollAddRiderButtonIntoView = (): boolean => {
    const target = addRiderButtonRef;
    if (!target) return false;
    const scroller = contentScrollRef;
    if (scroller) {
      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop = targetRect.top - scrollerRect.top + scroller.scrollTop;
      const top = Math.max(0, targetTop - scroller.clientHeight * 0.35);
      scroller.scrollTo({ top, behavior: "smooth" });
      return true;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  };

  const handlePickerSelect = (selected: SelectedProduct) => {
    // Close picker immediately so post-select scroll logic can run deterministically.
    setShowPicker(false);

    if (pickerMode() === "replace") {
      setPendingScrollToAddRider(null);
      setEditingProduct((current) => {
        if (!current) return current;
        const allowedRiderIds = parseAttachableRiders(
          selected.attachableRiders,
        );
        const filteredRiders =
          allowedRiderIds.length > 0
            ? current.riders.filter((rider) =>
                allowedRiderIds.includes(rider.productId),
              )
            : [];
        return {
          ...current,
          isRider: Boolean(selected.isRider),
          productId: selected.productId,
          fullName: selected.fullName,
          shortName: selected.shortName,
          shortNameManuallyEdited: false,
          attachedSuffix: selected.attachedSuffix,
          category: selected.category,
          type: selected.type,
          premiumTermOrIssueAge: undefined,
          optionTitle: selected.optionTitle,
          options: selected.options,
          fycRate: selected.fycRate,
          gst: selected.gst,
          attachableRiders: selected.attachableRiders,
          riders: filteredRiders,
        };
      });
    } else {
      const newRiderId = generateId();
      const newRider: DraftProduct = {
        id: newRiderId,
        isRider: Boolean(selected.isRider),
        productId: selected.productId,
        fullName: selected.fullName,
        shortName: selected.shortName,
        attachedSuffix: selected.attachedSuffix,
        notes: selected.notes,
        premiumTermOrIssueAge: undefined,
        optionTitle: selected.optionTitle,
        options: selected.options,
        fycRate: selected.fycRate,
        frequencies: selected.frequencies,
        gst: selected.gst,
        premiumRows: [],
        riders: [],
      };
      setEditingProduct((current) => {
        if (!current) return current;
        return { ...current, riders: [...current.riders, newRider] };
      });
      setPendingScrollToAddRider(newRiderId);
      // Highlight after picker closes and scroll completes
      setTimeout(() => highlightRider(newRiderId), 400);
    }
  };

  createEffect(() => {
    const pending = pendingScrollToAddRider();
    if (showPicker() || !pending) return;
    setPendingScrollToAddRider(null);
    let attempts = 0;
    const maxAttempts = 20;

    const tryScroll = () => {
      if (scrollAddRiderButtonIntoView()) {
        window.setTimeout(() => {
          scrollAddRiderButtonIntoView();
        }, 220);
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(tryScroll, 80);
      }
    };

    window.setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(tryScroll);
      });
    }, 120);
  });

  const hasUnsavedChanges = () => {
    const original = originalEditingProduct();
    const current = editingProduct();
    return original && current ? !areProductsEqual(original, current) : false;
  };

  // Navigation guard
  const { GuardModal, guardNavigate, skipGuard } =
    createNavigationGuard(hasUnsavedChanges);

  const handleClose = () =>
    guardNavigate(() => {
      setPendingScrollToAddNewBusiness(true);
      clearEditPlan();
      navigateBack("/closings/submit");
    });

  const handleSaveProduct = () => {
    const product = editingProduct();
    if (!product || !isProductComplete(product)) return;
    const normalizedShortNameState = buildShortNameState(
      product,
      String(product.shortName || "").trim(),
    );
    const normalizedProduct: DraftProduct = {
      ...product,
      ...normalizedShortNameState,
    };
    setEditingProduct(normalizedProduct);

    // Highlight the product card after returning to SubmitClosing
    setPendingHighlightProductId(normalizedProduct.id);

    updateSavedDraft((d) => {
      if (planData.index === null) {
        return { ...d, products: [...d.products, normalizedProduct] };
      }
      const products = [...d.products];
      products[planData.index] = normalizedProduct;
      return { ...d, products };
    });

    clearEditPlan();
    skipGuard();
    navigateBack("/closings/submit");
  };

  return (
    <div class="flex h-dvh flex-col bg-white">
      <PageHeader
        variant="plain"
        onBack={handleClose}
        subtitle={planData.isAddon ? "Add-on Rider/Top-Up" : "New Business"}
        class="sticky top-0 z-10"
        maxWidthClass="max-w-7xl"
      />

      <div
        ref={contentScrollRef}
        class="flex-1 overflow-y-auto px-4 bg-gray-50 pb-6 pt-4"
      >
        <div class="mx-auto w-full max-w-7xl">
          <Show when={editingProduct()}>
            {(product) => {
              const planOptions = () => getBasePlanOptionsForProduct(product());
              const hasSelectableOptions = () => planOptions().length > 0;
              const attachableRiders = () =>
                parseAttachableRiders(product().attachableRiders);

              return (
                <>
                  <div class="mb-4 bg-primary/5 px-3 py-3">
                    <div class="flex flex-wrap items-center justify-center gap-2 text-center">
                      <div class="text-lg font-semibold text-slate-900 leading-tight">
                        {isCustomProduct(product())
                          ? "Not in list"
                          : product().fullName || "Plan"}
                      </div>
                    </div>
                    <Show when={!isCustomProduct(product())}>
                      <div class="mt-2 flex flex-wrap items-center justify-center gap-2">
                        <Show
                          when={
                            !hasSelectableOptions() ||
                            product().premiumTermOrIssueAge
                          }
                        >
                          <span class="rounded bg-primary/10 px-2 py-0.5 text-base font-medium text-primary">
                            {product().fycRate === -1
                              ? "follows base"
                              : `${product().fycRate}%`}
                          </span>
                        </Show>
                        <Show when={product().type}>
                          <span
                            class={`rounded px-1.5 py-0.5 text-base font-medium ${classificationBadgeClass(
                              product().type!,
                            )}`}
                          >
                            {product().type}
                          </span>
                        </Show>
                        <Show when={product().gst}>
                          <span class="rounded bg-yellow-50 px-1.5 py-0.5 text-base font-medium text-yellow-700">
                            GST
                          </span>
                        </Show>
                      </div>
                    </Show>
                  </div>

                  <div class="mb-4">
                    <label class="mb-1 block text-base font-semibold uppercase text-slate-600">
                      Short Name
                    </label>
                    <input
                      type="text"
                      value={product().shortName || ""}
                      onInput={(e) =>
                        handleProductShortNameChange(e.currentTarget.value)
                      }
                      onBlur={handleProductShortNameBlur}
                      class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="Short name"
                    />
                  </div>

                  <Show when={hasSelectableOptions()}>
                    <div class="mb-4">
                      <label class="mb-1 block text-base font-semibold uppercase text-slate-600">
                        {product().optionTitle || "Entry Age"} / FYC Rate
                      </label>
                      <select
                        value={product().premiumTermOrIssueAge || ""}
                        onChange={(e) =>
                          handleProductOptionChange(e.currentTarget.value)
                        }
                        class={`w-full rounded-md border px-2 py-2.5 text-base leading-6 text-slate-950 focus:outline-none focus:ring-2 ${
                          product().premiumTermOrIssueAge
                            ? "border-slate-300 bg-white focus:border-primary focus:ring-primary/20"
                            : "border-red-300 bg-red-50/40 focus:ring-red-200"
                        }`}
                        style={{
                          color: product().premiumTermOrIssueAge
                            ? ""
                            : "#94A3B8",
                        }}
                      >
                        <option value="" disabled>
                          Select an option...
                        </option>
                        <For each={planOptions()}>
                          {(option) => {
                            const label = product().optionTitle || "Option";
                            const displayText = option.value
                              ? `${label} ${option.value}`
                              : label;
                            const fycLabel =
                              option.rate === "-1"
                                ? "follows base"
                                : `${option.rate}%`;
                            return (
                              <option
                                value={option.value}
                                selected={
                                  option.value ===
                                  product().premiumTermOrIssueAge
                                }
                              >
                                {`${displayText} / ${fycLabel}`}
                              </option>
                            );
                          }}
                        </For>
                      </select>
                    </div>
                  </Show>

                  <Show
                    when={!isCustomProduct(product())}
                    fallback={
                      <div class="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div>
                          <label class="mb-1 block text-base font-semibold uppercase text-slate-600">
                            FYC Rate (%)
                          </label>
                          <input
                            type="number"
                            value={product().fycRate}
                            onInput={(e) =>
                              handleProductFycRateChange(
                                e.currentTarget.value,
                              )
                            }
                            min="0"
                            step="0.01"
                            class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <div>
                          <label class="mb-1 block text-base font-semibold uppercase text-slate-600">
                            Type
                          </label>
                          <select
                            value={product().type || ""}
                            onChange={(e) =>
                              handleProductTypeChange(e.currentTarget.value)
                            }
                            class={`w-full rounded-md border px-3 py-2 text-base text-slate-950 focus:outline-none focus:ring-2 ${
                              product().type
                                ? "border-slate-300 bg-white focus:border-primary focus:ring-primary/20"
                                : "border-red-300 bg-red-50/40 focus:ring-red-200"
                            }`}
                            style={{
                              color: product().type ? "" : "#94A3B8",
                            }}
                          >
                            <option value="">Select type...</option>
                            <For each={typeEntries()}>
                              {(entry) => (
                                <option value={entry[0]}>{entry[1]}</option>
                              )}
                            </For>
                            <Show
                              when={
                                product().type &&
                                !typeEntries().some(
                                  ([key]) => key === product().type,
                                )
                              }
                            >
                              <option value={product().type}>
                                {product().type}
                              </option>
                            </Show>
                          </select>
                        </div>
                        <div>
                          <label class="mb-1 block text-base font-semibold uppercase text-slate-600">
                            GST
                          </label>
                          <label class="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-950">
                            <input
                              type="checkbox"
                              checked={product().gst}
                              onChange={(e) =>
                                handleProductGstChange(
                                  e.currentTarget.checked,
                                )
                              }
                            />
                            <span>Applicable</span>
                          </label>
                        </div>
                      </div>
                    }
                  >
                    <div class="mb-4" />
                  </Show>

                  <Show when={product().notes}>
                    <div class="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-base text-amber-900">
                      {product().notes}
                    </div>
                  </Show>

                  <div class="space-y-2 flex flex-col items-center">
                    <Show
                      when={product().premiumRows.length > 0}
                      fallback={
                        <Button
                          type="button"
                          onClick={() => openProductRowEditor()}
                          variant="danger"
                          class="rounded-lg bg-red-50/40"
                        >
                          Key in Quantity & Premium
                        </Button>
                      }
                    >
                      <For each={product().premiumRows}>
                        {(row, rowIndex) => {
                          const premiumLabel = () =>
                            row.premium > 0
                              ? `$${formatCurrency(row.premium)}`
                              : "Premium";
                          const frequencyLabel = () =>
                            row.frequency
                              ? formatFrequencySummary(row.frequency)
                              : "Frequency";
                          const rowLabel = () =>
                            `${Math.max(1, row.quantity || 1)} x ${premiumLabel()} / ${frequencyLabel()}`;
                          return (
                            <div class={`w-full max-w-sm ${row.id === removingRowId() ? "animate-row-remove" : ""}`}>
                              <div class={`flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm ${row.id === highlightedRowId() ? "animate-row-highlight" : ""}`}>
                                <span
                                  class={`text-base ${
                                    row.premium > 0 && row.frequency
                                      ? "text-slate-900"
                                      : "text-slate-500"
                                  }`}
                                >
                                  {rowLabel()}
                                </span>
                                <div class="flex items-center gap-1.5">
                                  <IconButton
                                    type="button"
                                    onClick={() =>
                                      openProductRowEditor(rowIndex())
                                    }
                                    class="text-primary hover:bg-primary/10 hover:text-primary"
                                    title="Edit row"
                                    aria-label="Edit row"
                                  >
                                    <TbOutlinePencil />
                                  </IconButton>
                                  <IconButton
                                    type="button"
                                    onClick={() =>
                                      handleRemoveProductRow(rowIndex())
                                    }
                                    class="text-red-500 hover:bg-red-50 hover:text-red-600"
                                    title="Delete row"
                                    aria-label="Delete row"
                                  >
                                    <TbOutlineTrash />
                                  </IconButton>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                      <button
                        type="button"
                        onClick={() => openProductRowEditor()}
                        class="cursor-pointer text-base text-primary hover:text-primary/80"
                      >
                        + Add premium row
                      </button>
                    </Show>
                  </div>

                  <Show when={!planData.isAddon}>
                    <div class="mt-4 border-t border-gray-100 pt-4">
                      <div class="mb-2 flex items-center justify-between">
                        <span class="text-base font-medium uppercase text-gray-500">
                          Riders ({product().riders.length})
                        </span>
                      </div>

                      <Show
                        when={product().riders.length > 0}
                        fallback={
                          <Show when={attachableRiders().length === 0}>
                            <p class="text-base text-gray-500 italic">
                              No attachable riders for this plan
                            </p>
                          </Show>
                        }
                      >
                        <div class="space-y-3">
                          <For each={product().riders}>
                            {(rider, riderIndex) => {
                              const riderOptions = () =>
                                getRiderOptionsForProduct(rider);
                              const hasSelectableRiderOptions = () =>
                                riderOptions().length > 0;
                              const baseRateReady = () =>
                                !hasSelectableOptions() ||
                                product().premiumTermOrIssueAge;
                              const riderRateReady = () =>
                                !hasSelectableRiderOptions() ||
                                rider.premiumTermOrIssueAge;
                              const shouldShowRiderBadge = () =>
                                rider.fycRate === -1
                                  ? riderRateReady() && baseRateReady()
                                  : riderRateReady();
                              return (
                                <div
                                  id={`plan-editor-rider-${rider.id}`}
                                  class={`rounded-lg border border-gray-100 bg-gray-100 p-4 ${rider.id === removingRiderId() ? "animate-row-remove" : ""} ${rider.id === highlightedRiderId() ? "animate-row-highlight" : ""}`}
                                >
                                  <div class="mb-3 flex items-center justify-between">
                                    <div class="flex items-center gap-2">
                                      <TbOutlinePuzzle class="h-4 w-4 text-purple-500" />
                                      <span class="text-base font-medium text-gray-800">
                                        {rider.shortName || rider.fullName}
                                      </span>
                                      <Show when={shouldShowRiderBadge()}>
                                        <Show
                                          when={rider.fycRate === -1}
                                          fallback={
                                            <span class="rounded bg-primary/10 px-1.5 py-0.5 text-base font-medium text-primary">
                                              {`${rider.fycRate}%`}
                                            </span>
                                          }
                                        >
                                          <span class="rounded bg-primary/10 px-1.5 py-0.5 text-base font-medium text-primary">
                                            {`follows base (${product().fycRate}%)`}
                                          </span>
                                        </Show>
                                      </Show>
                                    </div>
                                    <IconButton
                                      type="button"
                                      onClick={async () => {
                                        if (
                                          await confirmRemoveRider({
                                            message: `Remove ${rider.shortName || rider.fullName}?`,
                                          })
                                        ) {
                                          handleRemoveRider(riderIndex());
                                        }
                                      }}
                                      class="text-red-500 hover:bg-red-50 hover:text-red-600"
                                      title="Remove rider"
                                      aria-label="Remove rider"
                                    >
                                      <TbOutlineTrash />
                                    </IconButton>
                                  </div>

                                  <Show when={hasSelectableRiderOptions()}>
                                    <div class="mb-3">
                                      <label class="mb-1.5 block text-base font-semibold uppercase text-slate-600">
                                        {rider.optionTitle || "Entry Age"} / FYC Rate
                                      </label>
                                      <select
                                        value={
                                          rider.premiumTermOrIssueAge || ""
                                        }
                                        onChange={(e) =>
                                          handleRiderOptionChange(
                                            riderIndex(),
                                            e.currentTarget.value,
                                          )
                                        }
                                        class={`w-full rounded border px-2 py-1.5 text-base text-slate-950 focus:outline-none focus:ring-2 ${
                                          rider.premiumTermOrIssueAge
                                            ? "border-slate-300 bg-white focus:border-primary focus:ring-primary/20"
                                            : "border-red-300 bg-red-50/40 focus:ring-red-200"
                                        }`}
                                        style={{
                                          color: rider.premiumTermOrIssueAge
                                            ? ""
                                            : "#94A3B8",
                                        }}
                                      >
                                        <option value="" disabled>
                                          Select an option...
                                        </option>
                                        <For each={riderOptions()}>
                                          {(option) => {
                                            const label =
                                              rider.optionTitle || "Option";
                                            const displayText = option.value
                                              ? `${label} ${option.value}`
                                              : label;
                                            const fycLabel =
                                              option.rate === "-1"
                                                ? "follows base"
                                                : `${option.rate}%`;
                                            return (
                                              <option
                                                value={option.value}
                                                selected={
                                                  option.value ===
                                                  rider.premiumTermOrIssueAge
                                                }
                                              >
                                                {`${displayText} / ${fycLabel}`}
                                              </option>
                                            );
                                          }}
                                        </For>
                                      </select>
                                    </div>
                                  </Show>

                                  <Show when={rider.notes}>
                                    <div class="mb-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-base text-amber-900">
                                      {rider.notes}
                                    </div>
                                  </Show>

                                  <div class="space-y-2 flex flex-col items-center">
                                    <Show
                                      when={rider.premiumRows.length > 0}
                                      fallback={
                                        <Button
                                          type="button"
                                          onClick={() =>
                                            openRiderRowEditor(riderIndex())
                                          }
                                          variant="danger"
                                          class="rounded-lg bg-red-50/40"
                                        >
                                          Key in Quantity & Premium
                                        </Button>
                                      }
                                    >
                                      <For each={rider.premiumRows}>
                                        {(row, rowIndex) => {
                                          const premiumLabel = () =>
                                            row.premium > 0
                                              ? `$${formatCurrency(row.premium)}`
                                              : "Premium";
                                          const frequencyLabel = () =>
                                            row.frequency
                                              ? formatFrequencySummary(
                                                  row.frequency,
                                                )
                                              : "Frequency";
                                          const rowLabel = () =>
                                            `${Math.max(1, row.quantity || 1)} x ${premiumLabel()} / ${frequencyLabel()}`;
                                          return (
                                            <div class={`w-full max-w-sm ${row.id === removingRowId() ? "animate-row-remove" : ""}`}>
                                              <div class={`flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm ${row.id === highlightedRowId() ? "animate-row-highlight" : ""}`}>
                                                <span
                                                  class={`text-base ${
                                                    row.premium > 0 &&
                                                    row.frequency
                                                      ? "text-slate-900"
                                                      : "text-slate-500"
                                                  }`}
                                                >
                                                  {rowLabel()}
                                                </span>
                                                <div class="flex items-center gap-1.5">
                                                  <IconButton
                                                    type="button"
                                                    onClick={() =>
                                                      openRiderRowEditor(
                                                        riderIndex(),
                                                        rowIndex(),
                                                      )
                                                    }
                                                    class="text-primary hover:bg-primary/10 hover:text-primary"
                                                    title="Edit row"
                                                    aria-label="Edit row"
                                                  >
                                                    <TbOutlinePencil />
                                                  </IconButton>
                                                  <IconButton
                                                    type="button"
                                                    onClick={() =>
                                                      handleRemoveRiderRow(
                                                        riderIndex(),
                                                        rowIndex(),
                                                      )
                                                    }
                                                    class="text-red-500 hover:bg-red-50 hover:text-red-600"
                                                    title="Delete row"
                                                    aria-label="Delete row"
                                                  >
                                                    <TbOutlineTrash />
                                                  </IconButton>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        }}
                                      </For>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openRiderRowEditor(riderIndex())
                                        }
                                        class="cursor-pointer text-base text-primary hover:text-primary/80"
                                      >
                                        + Add premium row
                                      </button>
                                    </Show>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>

                      <Show when={attachableRiders().length > 0}>
                        <div
                          ref={addRiderButtonRef}
                          class="mt-3 flex justify-center"
                        >
                          <Button
                            type="button"
                            variant="primaryOutline"
                            onClick={openRiderPicker}
                            class="text-base"
                          >
                            <TbOutlinePlus class="h-3 w-3" />
                            Add Rider / Top-Up
                          </Button>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Button
                    fullWidth
                    class="mt-6"
                    onClick={handleSaveProduct}
                    disabled={
                      !isProductComplete(product()) ||
                      (hasSelectableOptions() &&
                        !product().premiumTermOrIssueAge) ||
                      hasMissingRiderOptions(product())
                    }
                  >
                    Save
                  </Button>
                </>
              );
            }}
          </Show>
        </div>
      </div>

      {/* Row Editor Modal */}
      <Show when={rowEditor()}>
        {(editor) => {
          const currentProduct = editingProduct();
          if (!currentProduct) return null;
          const isProduct = editor().scope === "product";
          const riderIndex = editor().riderIndex;
          const targetRider =
            !isProduct && typeof riderIndex === "number"
              ? currentProduct.riders[riderIndex]
              : undefined;
          const optionsSource = isProduct
            ? currentProduct
            : targetRider;
          const allowedFrequencies =
            getAllowedFrequencies(optionsSource);
          const isLocked = allowedFrequencies.length === 1;
          const quantityInvalid = () => {
            const parsed = Number(editor().quantity);
            return (
              !editor().quantity.trim() ||
              !Number.isFinite(parsed) ||
              !Number.isInteger(parsed) ||
              parsed <= 0
            );
          };
          const premiumInvalid = () =>
            !editor().premium.trim() ||
            !Number.isFinite(parseFloat(editor().premium)) ||
            parseFloat(editor().premium) <= 0;
          const frequencyInvalid = () => !editor().frequency;
          const rowSaveDisabled = () =>
            quantityInvalid() ||
            premiumInvalid() ||
            frequencyInvalid();
          return (
            <EditModal
              title={
                editor().rowIndex === null
                  ? "Add Premium Row"
                  : "Edit Premium Row"
              }
              onClose={closeRowEditor}
              onSave={saveRowEditor}
              manageHistoryEntry
              saveVariant="primaryOutline"
              saveDisabled={rowSaveDisabled()}
              bodyClass="pb-6 pt-4"
            >
                <div class="space-y-4">
                  <div>
                    <label class="mb-1 block text-base font-semibold uppercase text-slate-600">
                      Quantity
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      autocomplete="off"
                      value={editor().quantity}
                      onInput={(e) =>
                        setRowEditor((prev) =>
                          prev
                            ? {
                                ...prev,
                                quantity: e.currentTarget.value,
                              }
                            : prev,
                        )
                      }
                      class={`w-full rounded-md border bg-white px-3 py-2.5 text-base text-slate-950 placeholder:text-slate-500 focus:outline-none focus:ring-2 ${
                        quantityInvalid()
                          ? "border-red-300 bg-red-50/40 focus:ring-red-200"
                          : "border-slate-300 focus:border-primary focus:ring-primary/20"
                      }`}
                    />
                  </div>
                  <div>
                    <label class="mb-1 block text-base font-semibold uppercase text-slate-600">
                      Premium
                    </label>
                    <div class="relative">
                      <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-gray-500">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        autocomplete="off"
                        value={editor().premium}
                        onInput={(e) =>
                          setRowEditor((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  premium: e.currentTarget.value,
                                }
                              : prev,
                          )
                        }
                        class={`w-full rounded-md border bg-white py-2.5 pl-8 pr-3 text-base text-slate-950 placeholder:text-slate-500 focus:outline-none focus:ring-2 ${
                          premiumInvalid()
                            ? "border-red-300 bg-red-50/40 focus:ring-red-200"
                            : "border-slate-300 focus:border-primary focus:ring-primary/20"
                        }`}
                      />
                    </div>
                  </div>
                  <div>
                    <label class="mb-1 block text-base font-semibold uppercase text-slate-600">
                      Select Frequency
                    </label>
                    <div
                      class={`overflow-hidden rounded-lg border ${
                        frequencyInvalid()
                          ? "border-red-300 bg-red-50/40"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <For each={allowedFrequencies}>
                        {(freq) => {
                          const selected = () =>
                            editor().frequency === freq;
                          return (
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={() =>
                                setRowEditor((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        frequency: freq,
                                      }
                                    : prev,
                                )
                              }
                              class={`flex w-full items-center justify-between gap-3 border-l-4 border-l-primary border-y border-r border-gray-200 px-4 py-3 text-left text-base transition-colors ${
                                selected()
                                  ? "bg-primary/5 font-semibold text-primary"
                                  : "bg-white text-gray-700 hover:bg-gray-50"
                              } ${
                                isLocked
                                  ? "cursor-default opacity-80"
                                  : "cursor-pointer"
                              }`}
                            >
                              <span>{getFrequencyOptionLabel(freq)}</span>
                              <Show when={selected()}>
                                <TbOutlineCheck class="h-4 w-4 text-primary" />
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                  <Show when={rowEditorError()}>
                    <div class="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-base text-red-600">
                      {rowEditorError()}
                    </div>
                  </Show>
                </div>
            </EditModal>
          );
        }}
      </Show>

      {/* Internal ProductPicker for replace/rider modes */}
      <ProductPicker
        isOpen={showPicker()}
        onClose={() => setShowPicker(false)}
        onSelect={handlePickerSelect}
        mode={pickerMode()}
        attachableRiderIds={
          pickerMode() === "rider"
            ? getAttachableRiderIds()
            : undefined
        }
      />

      <RemoveRiderModal />
      <GuardModal />
    </div>
  );
};

export default PlanEditor;
