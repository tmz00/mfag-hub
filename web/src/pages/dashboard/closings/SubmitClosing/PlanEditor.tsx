import {
  Component,
  Index,
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
  TbOutlineMinus,
  TbOutlinePlus,
  TbOutlinePencil,
  TbOutlineTrash,
  TbOutlinePuzzle,
  TbOutlineSearch,
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
import type { DraftProduct, DraftPremiumRow } from "./SubmitClosing";
import ProductPicker, { type SelectedProduct } from "./ProductPicker";
import { classificationBadgeClass } from "../../../../utils/productBadges";
import { appendAttachedSuffixesFromRiders } from "../../../../utils/attachedSuffix";
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

type PremiumManagerState = {
  scope: "product" | "rider";
  riderIndex?: number;
  rows: PremiumManagerRowDraft[];
  initialRowsSignature: string;
};

type PremiumManagerRowDraft = {
  id: string;
  quantity: string;
  premium: string;
  frequency: PremiumFrequency | "";
};

const serializePremiumRowDrafts = (rows: PremiumManagerRowDraft[]) =>
  JSON.stringify(
    rows.map(({ quantity, premium, frequency }) => ({
      quantity: quantity.trim(),
      premium: premium.trim(),
      frequency,
    })),
  );

const formatPremiumDraftValue = (value?: number): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "";
};

const parsePositiveWholeQuantity = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
};

type PremiumManagerTarget = {
  scope: "product" | "rider";
  riderIndex?: number;
};

const ensurePremiumManagerRows = (
  rows: PremiumManagerRowDraft[],
  fallbackFactory: () => PremiumManagerRowDraft,
) => (rows.length > 0 ? rows : [fallbackFactory()]);

const normalizePremiumRows = (rows: DraftPremiumRow[]): DraftPremiumRow[] => {
  const normalized: DraftPremiumRow[] = [];
  const rowsByKey = new Map<string, DraftPremiumRow>();

  for (const row of rows) {
    const quantity = Math.max(1, Number(row.quantity) || 1);
    const key = `${Number(row.premium) || 0}::${row.frequency || ""}`;
    const existing = rowsByKey.get(key);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }

    const nextRow = {
      ...row,
      quantity,
    };
    rowsByKey.set(key, nextRow);
    normalized.push(nextRow);
  }

  return normalized;
};

const normalizeProductPremiumRows = (product: DraftProduct): DraftProduct => ({
  ...product,
  premiumRows: normalizePremiumRows(product.premiumRows),
  riders: product.riders.map((rider) => ({
    ...rider,
    premiumRows: normalizePremiumRows(rider.premiumRows),
  })),
});

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

  const normalizedPlanProduct = normalizeProductPremiumRows(
    cloneDraftProduct(planData.product),
  );
  const [editingProduct, setEditingProduct] = createSignal<DraftProduct | null>(
    normalizedPlanProduct,
  );
  const [originalEditingProduct, setOriginalEditingProduct] =
    createSignal<DraftProduct | null>(cloneDraftProduct(normalizedPlanProduct));
  const [rowEditor, setRowEditor] = createSignal<PremiumManagerState | null>(
    null,
  );
  const [rowEditorError, setRowEditorError] = createSignal("");
  const [showPicker, setShowPicker] = createSignal(false);
  const [pickerMode, setPickerMode] = createSignal<"replace" | "rider">(
    "replace",
  );
  const [pendingScrollToAddRider, setPendingScrollToAddRider] = createSignal<
    string | null
  >(null);

  // Row animation feedback
  const [highlightedRowId, setHighlightedRowId] = createSignal<string | null>(
    null,
  );
  let highlightTimeout: number | undefined;

  const highlightRow = (id: string) => {
    if (highlightTimeout !== undefined) clearTimeout(highlightTimeout);
    setHighlightedRowId(id);
    highlightTimeout = window.setTimeout(() => setHighlightedRowId(null), 1800);
  };

  // Rider card animation feedback
  const [highlightedRiderId, setHighlightedRiderId] = createSignal<
    string | null
  >(null);
  const [removingRiderId, setRemovingRiderId] = createSignal<string | null>(
    null,
  );
  let riderHighlightTimeout: number | undefined;

  const highlightRider = (id: string) => {
    if (riderHighlightTimeout !== undefined)
      clearTimeout(riderHighlightTimeout);
    setHighlightedRiderId(id);
    riderHighlightTimeout = window.setTimeout(
      () => setHighlightedRiderId(null),
      1800,
    );
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
    const updated = applySingleFrequency(normalizeProductPremiumRows(current));
    if (!areProductsEqual(current, updated)) {
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

  const getDefaultShortNameForProduct = (product: DraftProduct): string => {
    const catalogDefault = getCatalogShortNameForProduct(product);
    const fallbackDefault =
      String(product.shortName || "").trim() ||
      String(planData.product.shortName || "").trim();
    const baseShortName = (catalogDefault ?? fallbackDefault).trim();
    if (!baseShortName || product.isRider) return baseShortName;
    return appendAttachedSuffixesFromRiders(baseShortName, product.riders);
  };

  const getAutoManagedShortNamesForProduct = (product: DraftProduct): Set<string> => {
    const defaultShortName = getDefaultShortNameForProduct(product).trim();
    const baseShortName = (
      getCatalogShortNameForProduct(product) ??
      String(planData.product.shortName || "")
    ).trim();
    return new Set([baseShortName, defaultShortName].filter(Boolean));
  };

  const buildShortNameState = (
    product: DraftProduct,
    value: string,
  ): Pick<DraftProduct, "shortName" | "shortNameManuallyEdited"> => {
    const autoManagedShortNames = getAutoManagedShortNamesForProduct(product);
    const defaultShortName = getDefaultShortNameForProduct(product);
    const normalizedValue = value.trim();

    return {
      shortName: value,
      shortNameManuallyEdited:
        autoManagedShortNames.size > 0
          ? !autoManagedShortNames.has(normalizedValue)
          : normalizedValue !== defaultShortName,
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

  createEffect(() => {
    const current = editingProduct();
    if (!current || current.isRider || current.shortNameManuallyEdited) return;
    const defaultShortName = getDefaultShortNameForProduct(current);
    if (String(current.shortName || "").trim() === defaultShortName) return;
    setEditingProduct({
      ...current,
      shortName: defaultShortName,
      shortNameManuallyEdited: false,
    });
  });

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

  const getEditorTargetRows = (
    current: DraftProduct,
    editor: Pick<PremiumManagerState, "scope" | "riderIndex">,
  ): DraftPremiumRow[] => {
    if (editor.scope === "product") {
      return current.premiumRows;
    }
    const riderIndex = editor.riderIndex ?? -1;
    return riderIndex >= 0 ? current.riders[riderIndex]?.premiumRows || [] : [];
  };

  const updateEditorTargetRows = (
    current: DraftProduct,
    editor: PremiumManagerTarget,
    updater: (rows: DraftPremiumRow[]) => DraftPremiumRow[],
  ): DraftProduct => {
    if (editor.scope === "product") {
      return { ...current, premiumRows: updater(current.premiumRows) };
    }

    const riderIndex = editor.riderIndex ?? -1;
    if (riderIndex < 0) return current;
    const riders = [...current.riders];
    const rider = riders[riderIndex];
    if (!rider) return current;
    riders[riderIndex] = {
      ...rider,
      premiumRows: updater(rider.premiumRows),
    };
    return { ...current, riders };
  };

  const getDefaultRowEditorFrequency = (
    current: DraftProduct,
    editor: PremiumManagerTarget,
    existingFrequency?: PremiumFrequency | "",
  ): PremiumFrequency | "" => {
    const targetRows =
      editor.scope === "product"
        ? current
        : current.riders[editor.riderIndex ?? -1];
    if (!targetRows) return existingFrequency || "";

    const allowed = getAllowedFrequencies(targetRows);
    const basePlanFrequency = current.premiumRows[0]?.frequency || "";
    return (
      existingFrequency ||
      (allowed.length === 1 ? allowed[0] : "") ||
      (editor.scope === "rider" &&
      basePlanFrequency &&
      allowed.includes(basePlanFrequency)
        ? basePlanFrequency
        : "")
    );
  };

  const createRowEditorDraft = (
    current: DraftProduct,
    editor: PremiumManagerTarget,
    row?: DraftPremiumRow,
  ): PremiumManagerRowDraft => ({
    id: row?.id || generateRowId(),
    quantity: String(Math.max(1, row?.quantity || 1)),
    premium: formatPremiumDraftValue(row?.premium),
    frequency:
      row?.frequency ||
      getDefaultRowEditorFrequency(current, editor, row?.frequency || ""),
  });

  const buildRowEditorState = (
    current: DraftProduct,
    editor: PremiumManagerTarget,
  ): PremiumManagerState => {
    const rows = ensurePremiumManagerRows(
      getEditorTargetRows(current, editor).map((row) =>
        createRowEditorDraft(current, editor, row),
      ),
      () => createRowEditorDraft(current, editor),
    );
    return {
      ...editor,
      rows,
      initialRowsSignature: serializePremiumRowDrafts(rows),
    };
  };

  const openProductRowEditor = () => {
    const current = editingProduct();
    if (!current) return;
    setRowEditor(buildRowEditorState(current, { scope: "product" }));
    setRowEditorError("");
  };

  const openRiderRowEditor = (riderIndex: number) => {
    const current = editingProduct();
    if (!current || !current.riders[riderIndex]) return;
    setRowEditor(
      buildRowEditorState(current, {
        scope: "rider",
        riderIndex,
      }),
    );
    setRowEditorError("");
  };

  const updateManagedRow = (
    rowId: string,
    updater: (row: PremiumManagerRowDraft) => PremiumManagerRowDraft,
  ) => {
    setRowEditor((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((row) =>
              row.id === rowId ? updater(row) : row,
            ),
          }
        : prev,
    );
    setRowEditorError("");
  };

  const addManagedRow = () => {
    const editor = rowEditor();
    const current = editingProduct();
    if (!editor || !current) return;
    const nextRow = createRowEditorDraft(current, editor);
    setRowEditor((prev) =>
      prev ? { ...prev, rows: [...prev.rows, nextRow] } : prev,
    );
    setRowEditorError("");
    highlightRow(nextRow.id);
  };

  const stepManagedRowQuantity = (rowId: string, delta: number) => {
    updateManagedRow(rowId, (draftRow) => {
      const currentQuantity = parsePositiveWholeQuantity(draftRow.quantity) ?? 0;
      const nextQuantity = Math.max(1, currentQuantity + delta);
      return {
        ...draftRow,
        quantity: String(nextQuantity),
      };
    });
  };

  const removeManagedRow = (rowId: string) => {
    const current = editingProduct();
    setRowEditor((prev) => {
      if (!prev) return prev;
      if (prev.rows.length <= 1 || !current) return prev;
      return {
        ...prev,
        rows: ensurePremiumManagerRows(
          prev.rows.filter((row) => row.id !== rowId),
          () => createRowEditorDraft(current, prev),
        ),
      };
    });
    setRowEditorError("");
  };

  const closeRowEditor = () => {
    setRowEditor(null);
    setRowEditorError("");
  };

  const getRowDraftError = (row: PremiumManagerRowDraft): string | null => {
    if (!row.quantity.trim()) {
      return "Quantity is required.";
    }
    const parsedQuantity = parsePositiveWholeQuantity(row.quantity);
    if (parsedQuantity === null) {
      return "Quantity must be a positive whole number.";
    }
    if (!row.premium.trim()) {
      return "Premium is required.";
    }
    const parsedPremium = parseFloat(row.premium);
    if (!Number.isFinite(parsedPremium) || parsedPremium <= 0) {
      return "Premium must be a positive number.";
    }
    if (!row.frequency) {
      return "Frequency is required.";
    }
    return null;
  };

  const saveRowEditor = () => {
    const editor = rowEditor();
    if (!editor) return;
    const parsedRows: DraftPremiumRow[] = [];

    for (const row of editor.rows) {
      const error = getRowDraftError(row);
      if (error) {
        setRowEditorError("Complete every quantity/premium entry before finishing.");
        return;
      }
      parsedRows.push({
        id: row.id,
        quantity: parsePositiveWholeQuantity(row.quantity) ?? 1,
        premium: parseFloat(row.premium),
        frequency: row.frequency,
      });
    }

    setEditingProduct((current) => {
      if (!current) return current;
      return updateEditorTargetRows(current, editor, () =>
        normalizePremiumRows(parsedRows),
      );
    });

    closeRowEditor();
  };

  const getFrequencyOptionLabel = (freq: PremiumFrequency) =>
    (premiumFrequencyLabels[freq] || freq)
      .replace("1 month", "1 mth")
      .replace("2 months", "2 mth");

  const formatPremiumRowSummary = (row: DraftPremiumRow) =>
    `${Math.max(1, row.quantity || 1)} x ${
      row.premium > 0 ? `$${formatCurrency(row.premium)}` : "Premium"
    } / ${row.frequency ? formatFrequencySummary(row.frequency) : "Frequency"}`;

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
                              handleProductFycRateChange(e.currentTarget.value)
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
                                handleProductGstChange(e.currentTarget.checked)
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

                  <div class="mt-4">
                    <label class="mb-1.5 block text-base font-semibold uppercase text-slate-600">
                      Quantities & Premiums
                    </label>
                    <button
                      type="button"
                      onClick={() => openProductRowEditor()}
                      class={`relative w-full cursor-pointer rounded-2xl border px-4 py-4 shadow-sm transition ${
                        product().premiumRows.length > 0
                          ? "border-slate-200 bg-white hover:border-primary/40 hover:shadow-md"
                          : "border-red-200 bg-red-50/60 hover:border-red-300"
                      }`}
                    >
                      <Show when={product().premiumRows.length > 0}>
                        <span class="pointer-events-none absolute -right-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white text-primary shadow-sm ring-1 ring-slate-200">
                          <TbOutlinePencil class="h-3.5 w-3.5" />
                        </span>
                      </Show>
                      <div class="flex flex-col items-center justify-center gap-3 text-center">
                        <Show
                          when={product().premiumRows.length > 0}
                          fallback={
                            <div class="text-base text-red-600">
                              Tap to key in quantity/premium
                            </div>
                          }
                        >
                          <div class="flex w-full flex-col items-center gap-2">
                            <For each={product().premiumRows}>
                              {(row) => (
                                <div
                                  class={`w-full max-w-md rounded-xl border px-3 py-2 text-center ${
                                    row.id === highlightedRowId()
                                      ? "animate-row-highlight border-primary/30 bg-primary/5"
                                      : "border-slate-200 bg-slate-50"
                                  }`}
                                >
                                  <div class="text-base font-medium text-slate-900">
                                    {formatPremiumRowSummary(row)}
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </button>
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
                                        {rider.optionTitle || "Entry Age"} / FYC
                                        Rate
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

                                  <div class="mt-3">
                                    <label class="mb-1.5 block text-base font-semibold uppercase text-slate-600">
                                      Quantities & Premiums
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openRiderRowEditor(riderIndex())
                                      }
                                      class={`relative w-full cursor-pointer rounded-2xl border px-4 py-4 shadow-sm transition ${
                                        rider.premiumRows.length > 0
                                          ? "border-slate-200 bg-white hover:border-primary/40 hover:shadow-md"
                                          : "border-red-200 bg-red-50/60 hover:border-red-300"
                                      }`}
                                    >
                                      <Show when={rider.premiumRows.length > 0}>
                                        <span class="pointer-events-none absolute -right-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white text-primary shadow-sm ring-1 ring-slate-200">
                                          <TbOutlinePencil class="h-3.5 w-3.5" />
                                        </span>
                                      </Show>
                                      <div class="flex flex-col items-center justify-center gap-3 text-center">
                                        <Show
                                          when={rider.premiumRows.length > 0}
                                          fallback={
                                            <div class="text-base text-red-600">
                                              Tap to key in quantity/premium
                                            </div>
                                          }
                                        >
                                          <div class="flex w-full flex-col items-center gap-2">
                                            <For each={rider.premiumRows}>
                                              {(row) => (
                                                <div
                                                  class={`w-full max-w-md rounded-xl border px-3 py-2 text-center ${
                                                    row.id ===
                                                    highlightedRowId()
                                                      ? "animate-row-highlight border-primary/30 bg-primary/5"
                                                      : "border-slate-200 bg-slate-50"
                                                  }`}
                                                >
                                                  <div class="text-base font-medium text-slate-900">
                                                    {formatPremiumRowSummary(
                                                      row,
                                                    )}
                                                  </div>
                                                </div>
                                              )}
                                            </For>
                                          </div>
                                        </Show>
                                      </div>
                                    </button>
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
          const optionsSource = isProduct ? currentProduct : targetRider;
          if (!optionsSource) return null;
          const modalRows = () => editor().rows;
          const allowedFrequencies = getAllowedFrequencies(optionsSource);
          const isLocked = allowedFrequencies.length === 1;
          return (
            <EditModal
              title="Edit Quantities & Premiums"
              onClose={closeRowEditor}
              onSave={saveRowEditor}
              saveVariant="primary"
              manageHistoryEntry
              saveLabel="Done"
              maxWidthClass="max-w-3xl"
              hasUnsavedChanges={() =>
                serializePremiumRowDrafts(editor().rows) !==
                editor().initialRowsSignature
              }
              discardPrompt="You have unsaved quantity/premium changes that will be lost."
            >
              <div class="space-y-4">
                <div class="space-y-3">
                  <Index each={modalRows()}>
                    {(row, index) => {
                      const currentRow = row;
                      const quantityInvalid = () => {
                        const draftRow = currentRow();
                        return (
                          !draftRow.quantity.trim() ||
                          parsePositiveWholeQuantity(draftRow.quantity) === null
                        );
                      };
                      const premiumInvalid = () => {
                        const draftRow = currentRow();
                        return (
                          !draftRow.premium.trim() ||
                          !Number.isFinite(parseFloat(draftRow.premium)) ||
                          parseFloat(draftRow.premium) <= 0
                        );
                      };
                      const frequencyInvalid = () => !currentRow().frequency;

                      return (
                        <div
                          class={`relative rounded-2xl border bg-white p-4 shadow-sm ${
                            row().id === highlightedRowId()
                              ? "animate-row-highlight border-primary/30 bg-primary/5"
                              : "border-slate-200"
                          }`}
                        >
                          <Show when={modalRows().length > 1}>
                            <IconButton
                              type="button"
                              size="sm"
                              onClick={() => removeManagedRow(row().id)}
                              class="absolute -right-2 -top-2 z-10 bg-white text-red-500 shadow-sm ring-1 ring-slate-200 hover:bg-red-50 hover:text-red-600"
                              title="Delete entry"
                              aria-label={`Delete entry ${index + 1}`}
                            >
                              <TbOutlineTrash />
                            </IconButton>
                          </Show>

                          <div class="grid grid-cols-[0.85fr_1.15fr] gap-3 sm:grid-cols-[0.8fr_1.2fr_1fr]">
                            <div>
                              <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Quantity
                              </label>
                              <div
                                class={`relative h-11 rounded-md border bg-white focus-within:ring-2 ${
                                  quantityInvalid()
                                    ? "border-red-300 bg-red-50/40 focus-within:ring-red-200"
                                    : "border-slate-300 focus-within:border-primary focus-within:ring-primary/20"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    stepManagedRowQuantity(row().id, -1)
                                  }
                                  aria-label={`Decrease quantity for entry ${index + 1}`}
                                  title="Decrease quantity"
                                  class="absolute inset-y-0 left-2 flex items-center justify-center border-0 bg-transparent p-0 text-slate-400 transition hover:text-slate-700 focus:outline-none"
                                >
                                  <TbOutlineMinus class="h-3.5 w-3.5" />
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  autocomplete="off"
                                  aria-label={`Quantity for entry ${index + 1}`}
                                  value={currentRow().quantity}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onInput={(e) =>
                                    updateManagedRow(row().id, (draftRow) => ({
                                      ...draftRow,
                                      quantity: e.currentTarget.value,
                                    }))
                                  }
                                  class="h-full w-full border-0 bg-transparent px-0 py-2 text-center text-base text-slate-950 placeholder:text-slate-500 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    stepManagedRowQuantity(row().id, 1)
                                  }
                                  aria-label={`Increase quantity for entry ${index + 1}`}
                                  title="Increase quantity"
                                  class="absolute inset-y-0 right-2 flex items-center justify-center border-0 bg-transparent p-0 text-slate-400 transition hover:text-slate-700 focus:outline-none"
                                >
                                  <TbOutlinePlus class="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>

                            <div>
                              <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
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
                                  value={currentRow().premium}
                                  onInput={(e) =>
                                    updateManagedRow(row().id, (draftRow) => ({
                                      ...draftRow,
                                      premium: e.currentTarget.value,
                                    }))
                                  }
                                  class={`h-11 w-full rounded-md border bg-white py-2.5 pl-8 pr-3 text-base text-slate-950 placeholder:text-slate-500 focus:outline-none focus:ring-2 ${
                                    premiumInvalid()
                                      ? "border-red-300 bg-red-50/40 focus:ring-red-200"
                                      : "border-slate-300 focus:border-primary focus:ring-primary/20"
                                  }`}
                                />
                              </div>
                            </div>

                            <div class="col-span-2 sm:col-span-1">
                              <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Frequency
                              </label>
                              <select
                                value={currentRow().frequency}
                                disabled={isLocked}
                                onChange={(e) =>
                                  updateManagedRow(row().id, (draftRow) => ({
                                    ...draftRow,
                                    frequency: e.currentTarget
                                      .value as PremiumFrequency,
                                  }))
                                }
                                class={`h-10 w-full rounded-md border px-3 py-0 text-base leading-none text-slate-950 focus:outline-none focus:ring-2 ${
                                  frequencyInvalid()
                                    ? "border-red-300 bg-red-50/40 focus:ring-red-200"
                                    : "border-slate-300 bg-white focus:border-primary focus:ring-primary/20"
                                } ${
                                  isLocked
                                    ? "cursor-default opacity-80"
                                    : "cursor-pointer"
                                }`}
                              >
                                <option value="" disabled>
                                  Select frequency...
                                </option>
                                <For each={allowedFrequencies}>
                                  {(freq) => (
                                    <option value={freq}>
                                      {getFrequencyOptionLabel(freq)}
                                    </option>
                                  )}
                                </For>
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  </Index>
                </div>

                <Show when={rowEditorError()}>
                  <div class="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-base text-red-600">
                    {rowEditorError()}
                  </div>
                </Show>

                <div class="flex justify-center">
                  <Button
                    type="button"
                    variant="primaryOutline"
                    onClick={addManagedRow}
                  >
                    <TbOutlinePlus class="h-4 w-4" />
                    Add another Quantity/Premium
                  </Button>
                </div>
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
          pickerMode() === "rider" ? getAttachableRiderIds() : undefined
        }
      />

      <RemoveRiderModal />
      <GuardModal />
    </div>
  );
};

export default PlanEditor;
