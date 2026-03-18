import {
  Component,
  Suspense,
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  createResource,
  Show,
  For,
  lazy,
  onMount,
} from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { TbOutlineFilePlus, TbOutlineSearch } from "solid-icons/tb";
import {
  PageShell,
  PageHeader,
  Alert,
  Button,
  LoadingState,
  Spinner,
  createNavigationGuard,
  createConfirm,
  ConfirmModal,
} from "../../../../components/ui";
import {
  closingsService,
  type Closing,
  type ClosingInput,
  type ClosingProduct,
  type PremiumFrequency,
  getAnnualizedFYP,
  getFYC,
} from "../../../../services/closingsService";
import {
  productsService,
  type BasePlan,
  type ProductCatalog,
  type Rider,
} from "../../../../services/productsService";
import { authService } from "../../../../services/authService";
import { teamService } from "../../../../services/teamService";
import { sourcesService } from "../../../../services/sourcesService";
import ClosingDisplayBlock from "../_ClosingDisplayBlock";
import { buildClosingDisplayModel, formatSourceLine } from "../_closingDisplay";
import { resetClosingsListView } from "../_closingsListViewState";
import { isAddonProduct } from "./_planUtils";
import { normalizePremiumFrequency } from "../../../../utils/premiumFrequency";
import {
  saveSubmitState,
  getSavedState,
  clearSavedState,
  setEditPlan,
  consumePendingHighlightProductId,
  consumePendingScrollToAddNewBusiness,
} from "./_submitStore";
import {
  appendAttachedSuffixesByRiderProductId,
  appendAttachedSuffixesFromRiders,
} from "../../../../utils/attachedSuffix";
import { consolidatePremiumRowsByAmountAndFrequency } from "../../../../utils/closingPremiumRows";
const PlansSection = lazy(() => import("./PlansSection"));
const _FscPicker = lazy(() => import("./_FscPicker"));
const SourcePicker = lazy(() => import("./SourcePicker"));

// ============ Types ============

export type DraftPremiumRow = {
  id: string;
  premium: number;
  frequency: PremiumFrequency | "";
  quantity: number;
};

export type DraftProduct = {
  id: string; // Local unique ID for React key
  isRider?: boolean;
  productId: string;
  fullName: string;
  shortName: string;
  shortNameManuallyEdited?: boolean;
  attachedSuffix?: string;
  category?: string;
  type?: string;
  notes?: string;
  premiumTermOrIssueAge?: string;
  optionTitle?: string;
  options?: Array<{ label: string; fycRate: string }>;
  fycRate: number;
  frequencies?: string[];
  gst: boolean;
  premiumRows: DraftPremiumRow[];
  riders: DraftProduct[];
  attachableRiders?: string[];
};

export type ClosingDraft = {
  sourceId: string;
  sourceLabel: string;
  sourceItemId: string;
  sourceItemLabel: string;
  sourceComment: string;
  products: DraftProduct[];
  sharedFscCode: string;
  sharedFscName: string;
  sharedFscNone: boolean;
  referrals: number | null;
  referralsComment: string;
};

export type UserInfo = {
  uid: string;
  fscCode: string;
  nickname: string;
};

type SectionId = "details" | "plans" | "summary";
// ============ Helpers ============

const createEmptyDraft = (): ClosingDraft => ({
  sourceId: "",
  sourceLabel: "",
  sourceItemId: "",
  sourceItemLabel: "",
  sourceComment: "",
  products: [],
  sharedFscCode: "",
  sharedFscName: "",
  sharedFscNone: false,
  referrals: null,
  referralsComment: "",
});

const isSameLocalDate = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const formatSummaryDate = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export const getSummaryDateLabel = (
  submittedAt?: Date | string | null,
  now: Date = new Date(),
) => {
  if (!submittedAt) return "";
  const parsed =
    submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  if (Number.isNaN(parsed.getTime()) || isSameLocalDate(parsed, now)) {
    return "";
  }
  return formatSummaryDate(parsed);
};

const normalizeCatalogOptions = (
  options: unknown,
): Array<{ label: string; fycRate: string }> =>
  Array.isArray(options) ? options : [];

const getCatalogDefaultFycRate = (
  options: Array<{ label: string; fycRate: string }>,
  fallbackRate?: string,
) => {
  const sortedOptions = [...options].sort((left, right) => {
    const leftRate = Number(left.fycRate);
    const rightRate = Number(right.fycRate);
    const normalizedLeft = Number.isFinite(leftRate) ? leftRate : -Infinity;
    const normalizedRight = Number.isFinite(rightRate) ? rightRate : -Infinity;
    if (normalizedLeft !== normalizedRight) {
      return normalizedRight - normalizedLeft;
    }
    return String(left.label || "").localeCompare(String(right.label || ""));
  });

  if (sortedOptions.length > 0) {
    const parsed = Number(sortedOptions[0].fycRate);
    if (Number.isFinite(parsed)) return parsed;
  }

  const parsedFallback = Number(fallbackRate);
  return Number.isFinite(parsedFallback) ? parsedFallback : 0;
};

const prependMissingSelectedOption = (
  options: Array<{ label: string; fycRate: string }>,
  selectedOption?: string,
  selectedRate?: number,
) => {
  const normalizedSelected = String(selectedOption || "").trim();
  if (!normalizedSelected) return options;
  if (options.some((option) => option.label === normalizedSelected)) {
    return options;
  }

  const fallbackRate = Number.isFinite(Number(selectedRate))
    ? String(selectedRate)
    : "0";

  return [
    {
      label: normalizedSelected,
      fycRate: fallbackRate,
    },
    ...options,
  ];
};

const findCatalogBasePlan = (
  item: ClosingProduct,
  catalog?: ProductCatalog | null,
): BasePlan | undefined => {
  const basePlans = catalog?.basePlans || [];
  const productId = String(item.productId || "").trim();
  const fullName = String(item.fullName || "").trim();

  return (
    basePlans.find(
      (plan) =>
        String(plan.id || "").trim() === productId &&
        String(plan.fullName || "").trim() === fullName,
    ) || basePlans.find((plan) => String(plan.id || "").trim() === productId)
  );
};

const findCatalogRider = (
  item: ClosingProduct,
  catalog?: ProductCatalog | null,
): Rider | undefined => {
  const riders = catalog?.riders || [];
  const productId = String(item.productId || "").trim();
  const fullName = String(item.fullName || "").trim();

  return (
    riders.find(
      (rider) =>
        String(rider.id || "").trim() === productId &&
        String(rider.fullName || "").trim() === fullName,
    ) || riders.find((rider) => String(rider.id || "").trim() === productId)
  );
};

const resolveHydratedFycRate = (
  item: ClosingProduct,
  options: Array<{ label: string; fycRate: string }>,
  fallbackRate?: string,
) => {
  const selectedOption = String(item.premiumTermOrIssueAge || "").trim();
  if (selectedOption) {
    const matchedOption = options.find((option) => option.label === selectedOption);
    const matchedRate = Number(matchedOption?.fycRate);
    if (Number.isFinite(matchedRate)) {
      return matchedRate;
    }
  }

  if (item.fycRate === -1) return -1;

  if (item.fycRate !== 0 && Number.isFinite(Number(item.fycRate))) {
    return Number(item.fycRate);
  }

  return getCatalogDefaultFycRate(options, fallbackRate);
};

const buildDraftPremiumRowsFromClosingProduct = (
  item: ClosingProduct,
  rowIdPrefix: string,
): DraftPremiumRow[] => {
  const normalizeFrequency = (value?: string): PremiumFrequency | "" =>
    ((normalizePremiumFrequency(value) as PremiumFrequency | undefined) || "");

  const premiumRows = consolidatePremiumRowsByAmountAndFrequency(
    item.quantitiesAndPremiums || [],
  ).map((entry, entryIdx) => ({
    id: `${rowIdPrefix}-row-${entryIdx}`,
    premium: entry.premium || 0,
    frequency: normalizeFrequency(entry.frequency),
    quantity: entry.quantity || 1,
  }));

  return premiumRows.length
    ? premiumRows
    : [
        {
          id: `${rowIdPrefix}-row-0`,
          premium: 0,
          frequency: "",
          quantity: 1,
        },
      ];
};

export const hydrateDraftProductFromClosingProduct = (
  item: ClosingProduct,
  rowIdPrefix: string,
  catalog?: ProductCatalog | null,
): DraftProduct => {
  const catalogItem = item.isRider
    ? findCatalogRider(item, catalog)
    : findCatalogBasePlan(item, catalog);
  const catalogShortName = String(catalogItem?.shortName || "").trim();
  const storedShortName = String(item.shortName || "").trim();
  const suffixByRiderProductId = Object.fromEntries(
    (catalog?.riders || [])
      .map((rider) => [
        String(rider.id || "").trim(),
        String(rider.attachedSuffix || "").trim(),
      ])
      .filter(([riderId, suffix]) => riderId && suffix),
  );
  const autoManagedShortNameWithSuffixes = item.isRider
    ? catalogShortName
    : appendAttachedSuffixesByRiderProductId(
        catalogShortName,
        item.riders,
        suffixByRiderProductId,
      ).trim();
  const autoManagedShortNames = new Set(
    [catalogShortName, autoManagedShortNameWithSuffixes].filter(Boolean),
  );
  const resolvedShortName =
    !item.isRider &&
    storedShortName &&
    catalogShortName &&
    storedShortName === catalogShortName &&
    autoManagedShortNameWithSuffixes
      ? autoManagedShortNameWithSuffixes
      : storedShortName || autoManagedShortNameWithSuffixes || catalogShortName;
  const optionsFromCatalog = normalizeCatalogOptions(catalogItem?.options);
  const mergedOptions = prependMissingSelectedOption(
    optionsFromCatalog,
    item.premiumTermOrIssueAge,
    item.fycRate,
  );

  return {
    id: rowIdPrefix,
    isRider: Boolean(item.isRider),
    productId: item.productId,
    fullName: item.fullName,
    shortName: resolvedShortName,
    shortNameManuallyEdited: Boolean(
      storedShortName &&
        autoManagedShortNames.size > 0 &&
        !autoManagedShortNames.has(storedShortName),
    ),
    attachedSuffix: item.isRider
      ? (catalogItem as Rider | undefined)?.attachedSuffix
      : undefined,
    category: catalogItem?.category,
    type: item.type || catalogItem?.type,
    notes: catalogItem?.notes,
    premiumTermOrIssueAge: item.premiumTermOrIssueAge,
    optionTitle: catalogItem?.optionTitle,
    options: mergedOptions.length ? mergedOptions : undefined,
    fycRate: resolveHydratedFycRate(item, mergedOptions, catalogItem?.fycRate),
    frequencies: item.frequencies,
    gst: item.gst > 0,
    premiumRows: buildDraftPremiumRowsFromClosingProduct(item, rowIdPrefix),
    riders: (item.riders || []).map((rider, riderIndex) =>
      hydrateDraftProductFromClosingProduct(
        rider,
        `${rowIdPrefix}-rider-${riderIndex}`,
        catalog,
      ),
    ),
    attachableRiders: item.isRider
      ? undefined
      : (catalogItem as BasePlan | undefined)?.attachableRiders,
  };
};

const isDraftShared = (
  draft: Pick<ClosingDraft, "sharedFscCode" | "sharedFscName" | "sharedFscNone">,
): boolean => {
  if (draft.sharedFscNone) return false;
  return Boolean(draft.sharedFscCode || draft.sharedFscName);
};

const getPremiumRowsValidationError = (
  rows: DraftPremiumRow[],
): string | null => {
  if (rows.length === 0) {
    return "Add at least one premium row for every plan.";
  }
  if (rows.some((row) => row.premium > 0 && !row.frequency)) {
    return "Select a frequency for every premium row.";
  }
  if (rows.some((row) => row.premium <= 0 && row.frequency)) {
    return "Enter a premium for every premium row.";
  }
  if (rows.some((row) => row.premium <= 0 && !row.frequency)) {
    return "Enter a premium and select a frequency for every premium row.";
  }
  return null;
};

const getProductsValidationError = (draft: ClosingDraft): string | null => {
  if (draft.products.length === 0) {
    return "Add at least one plan.";
  }
  for (const product of draft.products) {
    const productError = getPremiumRowsValidationError(product.premiumRows);
    if (productError) {
      return productError;
    }
    for (const rider of product.riders) {
      const riderError = getPremiumRowsValidationError(rider.premiumRows);
      if (riderError) {
        return riderError;
      }
    }
  }
  return null;
};

// For "Single" category, AFYP is 10% of the annualized premium
export const calculateProductFYP = (product: DraftProduct): number => {
  const gstPercent = product.gst ? 9 : 0;
  const isSingle = product.type?.toLowerCase() === "single";
  const fypMultiplier = isSingle ? 0.1 : 1;

  let baseFYP = 0;
  for (const row of product.premiumRows) {
    if (!row.frequency) continue;
    const quantity = row.quantity || 1;
    baseFYP +=
      getAnnualizedFYP(row.premium, row.frequency, gstPercent) *
      quantity *
      fypMultiplier;
  }

  let riderFYP = 0;
  for (const rider of product.riders) {
    const riderGst = rider.gst ? 9 : 0;
    for (const row of rider.premiumRows) {
      if (!row.frequency) continue;
      const quantity = row.quantity || 1;
      riderFYP +=
        getAnnualizedFYP(row.premium, row.frequency, riderGst) *
        quantity *
        fypMultiplier;
    }
  }

  return baseFYP + riderFYP;
};

export const calculateProductFYC = (
  product: DraftProduct,
  baseFycRate?: number,
): number => {
  const gstPercent = product.gst ? 9 : 0;
  let baseFYC = 0;
  for (const row of product.premiumRows) {
    if (!row.frequency) continue;
    const quantity = row.quantity || 1;
    baseFYC +=
      getFYC(row.premium, row.frequency, product.fycRate, gstPercent) *
      quantity;
  }

  let riderFYC = 0;
  for (const rider of product.riders) {
    const riderGst = rider.gst ? 9 : 0;
    const effectiveRate =
      rider.fycRate === -1 ? (baseFycRate ?? product.fycRate) : rider.fycRate;
    for (const row of rider.premiumRows) {
      if (!row.frequency) continue;
      const quantity = row.quantity || 1;
      riderFYC +=
        getFYC(row.premium, row.frequency, effectiveRate, riderGst) * quantity;
    }
  }

  return baseFYC + riderFYC;
};

export const calculateTotals = (draft: ClosingDraft) => {
  let totalFYP = 0;
  let totalFYC = 0;
  let caseCount = 0;

  for (const product of draft.products) {
    totalFYP += calculateProductFYP(product);
    totalFYC += calculateProductFYC(product);
    if (!isAddonProduct(product)) {
      for (const row of product.premiumRows) {
        caseCount += row.quantity || 1;
      }
    }
  }

  // If shared, divide by 2
  const isShared = isDraftShared(draft);
  const originalFYP = totalFYP;
  const originalFYC = totalFYC;
  const originalCaseCount = caseCount;
  if (isShared) {
    totalFYP /= 2;
    totalFYC /= 2;
    caseCount /= 2;
  }

  return {
    totalFYP,
    totalFYC,
    caseCount,
    isShared,
    originalFYP,
    originalFYC,
    originalCaseCount,
  };
};

export const applyAttachedSuffixesFromCatalog = (
  products: DraftProduct[],
  suffixByRiderProductId: Record<string, string>,
): DraftProduct[] => {
  let changed = false;

  const patched = products.map((product) => {
    let ridersChanged = false;
    const riders = product.riders.map((rider) => {
      const existingSuffix = String(rider.attachedSuffix || "").trim();
      if (existingSuffix) return rider;

      const mappedSuffix = String(
        suffixByRiderProductId[String(rider.productId || "").trim()] || "",
      ).trim();
      if (!mappedSuffix) return rider;

      ridersChanged = true;
      changed = true;
      return { ...rider, attachedSuffix: mappedSuffix };
    });

    if (!ridersChanged) return product;
    return { ...product, riders };
  });

  return changed ? patched : products;
};

// ============ Component ============

const SubmitClosing: Component = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const navigateBack = (fallbackHref: string) => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(fallbackHref, { replace: true });
  };

  // Restore from saved state (returning from EditPlan)
  const _saved = getSavedState();
  const restoredFromSave = !!_saved;

  // Highlight product card that was just added/edited
  const [highlightProductId, setHighlightProductId] = createSignal<string | null>(
    restoredFromSave ? consumePendingHighlightProductId() : null,
  );
  const [scrollToAddButton, setScrollToAddButton] = createSignal(
    restoredFromSave ? consumePendingScrollToAddNewBusiness() : false,
  );

  createEffect(() => {
    const productId = highlightProductId();
    if (!productId) return;
    let retryTimer: number | undefined;
    let clearHighlightTimer: number | undefined;
    let attempts = 0;
    const maxAttempts = 24;

    const scrollToHighlightedPlan = () => {
      const target = document.getElementById(`submit-plan-${productId}`);
      if (!target) {
        attempts += 1;
        if (attempts < maxAttempts) {
          retryTimer = window.setTimeout(scrollToHighlightedPlan, 80);
        } else {
          setHighlightProductId(null);
        }
        return;
      }
      const navHeight = sectionNavRef?.offsetHeight ?? 0;
      const top = target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(0, top - navHeight - 28),
        behavior: "smooth",
      });
      setActiveSection("plans");
      clearHighlightTimer = window.setTimeout(() => {
        setHighlightProductId(null);
      }, 1800);
    };

    retryTimer = window.setTimeout(scrollToHighlightedPlan, 0);
    onCleanup(() => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (clearHighlightTimer !== undefined) window.clearTimeout(clearHighlightTimer);
    });
  });

  createEffect(() => {
    if (!scrollToAddButton()) return;
    let retryTimer: number | undefined;
    let attempts = 0;
    const maxAttempts = 24;

    const scrollToAddNewBusiness = () => {
      const target = document.getElementById("submit-add-new-business-btn");
      if (!target) {
        attempts += 1;
        if (attempts < maxAttempts) {
          retryTimer = window.setTimeout(scrollToAddNewBusiness, 80);
        } else {
          setScrollToAddButton(false);
        }
        return;
      }
      const navHeight = sectionNavRef?.offsetHeight ?? 0;
      const top = target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(0, top - navHeight - 28),
        behavior: "smooth",
      });
      setActiveSection("plans");
      setScrollToAddButton(false);
    };

    retryTimer = window.setTimeout(scrollToAddNewBusiness, 0);
    onCleanup(() => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    });
  });

  // State
  const [draft, setDraft] = createSignal<ClosingDraft>(
    _saved?.draft ?? createEmptyDraft(),
  );
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [currentUser, setCurrentUser] = createSignal<UserInfo | null>(null);
  const [showFscPicker, setShowFscPicker] = createSignal(false);
  const [showSubmittedByPicker, setShowSubmittedByPicker] = createSignal(false);
  const [showSourcePicker, setShowSourcePicker] = createSignal(false);
  const [submitFeedback, setSubmitFeedback] = createSignal<{
    open: boolean;
    kind: "success" | "error";
    message: string;
  }>({
    open: false,
    kind: "success",
    message: "",
  });
  const [deleteFeedback, setDeleteFeedback] = createSignal<{
    open: boolean;
    kind: "success" | "error";
    message: string;
  }>({
    open: false,
    kind: "success",
    message: "",
  });
  const [submittedBy, setSubmittedBy] = createSignal<{
    fscCode: string;
    nickname: string;
  } | null>(_saved?.submittedBy ?? null);
  const [initialSnapshot, setInitialSnapshot] = createSignal(
    _saved?.initialSnapshot ?? "",
  );
  const [snapshotReady, setSnapshotReady] = createSignal(
    _saved?.snapshotReady ?? false,
  );
  const [previewTimestampCreatedAt] = createSignal(new Date());
  const [activeSection, setActiveSection] = createSignal<SectionId>("details");

  let sectionNavRef: HTMLDivElement | undefined;
  let detailsSectionRef: HTMLDivElement | undefined;
  let plansSectionRef: HTMLDivElement | undefined;
  let summarySectionRef: HTMLDivElement | undefined;

  // Track if we're navigating to EditPlan (to preserve saved state)
  let navigatingToEditPlan = false;
  onCleanup(() => {
    if (!navigatingToEditPlan) {
      clearSavedState();
    }
  });

  // Edit mode: load existing closing
  const editId = () => searchParams.edit as string | undefined;

  const [existingClosing] = createResource(editId, async (id) => {
    if (!id) return null;
    return closingsService.getClosingById(id);
  });
  const [productsCatalog] = createResource(editId, async (id) => {
    if (!id) return null;
    return productsService.getProducts();
  });
  const riderSuffixByProductId = createMemo<Record<string, string>>(() => {
    const suffixes: Record<string, string> = {};
    const riders = productsCatalog()?.riders || [];
    for (const rider of riders) {
      const riderId = String(rider.id || "").trim();
      const suffix = String(rider.attachedSuffix || "").trim();
      if (!riderId || !suffix) continue;
      suffixes[riderId] = suffix;
    }
    return suffixes;
  });
  const previewTimestamp = createMemo(() => {
    if (editId()) {
      const existing = existingClosing();
      if (existing?.timestamp) {
        const parsed = new Date(existing.timestamp);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
    }
    return previewTimestampCreatedAt();
  });
  const summaryDateLabel = createMemo(() =>
    getSummaryDateLabel(editId() ? existingClosing()?.timestamp : null),
  );
  const [sources] = createResource(() => sourcesService.getSources());
  const [DeleteClosingModal, confirmDeleteClosing] = createConfirm({
    title: "Delete closing",
    message: "Delete this closing? This cannot be undone.",
    confirmLabel: "Delete",
    variant: "danger",
  });

  const resolveSourceLabel = (sourceKey: string) => {
    if (!sourceKey) return "";
    const matched = (sources() || []).find((source) => source.id === sourceKey);
    return matched?.label || sourceKey;
  };

  const resolveSourceItemLabel = (sourceKey: string, sourceItemId: string) => {
    if (!sourceKey || !sourceItemId) return "";
    const matchedSource = (sources() || []).find((source) => source.id === sourceKey);
    const matchedItem = matchedSource?.children.find((child) => child.id === sourceItemId);
    return matchedItem?.label || sourceItemId;
  };

  const isEditingOthers = () => {
    if (!editId()) return false;
    const existing = existingClosing();
    const user = currentUser();
    if (!existing || !user?.fscCode) return false;
    return (
      existing.fscCode !== user.fscCode &&
      existing.sharedFscCode !== user.fscCode
    );
  };

  const submittedByLabel = () => {
    const submitter = submittedBy();
    if (!submitter) return "";
    const name = submitter.nickname || "";
    const code = submitter.fscCode || "";
    if (!name && !code) return "";
    if (name && code) return `${name} (${code})`;
    return name || code;
  };

  const sharedFscLabel = () => {
    const name = draft().sharedFscName || "";
    const code = draft().sharedFscCode || "";
    if (!name && !code) return draft().sharedFscNone ? "Not shared" : "";
    if (name && code) return `${name} (${code})`;
    return name || code;
  };

  const sourceDisplayLabel = () => {
    const label = draft().sourceLabel || draft().sourceId || "";
    const detail = draft().sourceItemLabel || draft().sourceItemId || "";
    if (!label) return "";
    if (detail) return `${label} (${detail})`;
    return label;
  };

  // Load current user info
  onMount(() => {
    const unsubscribe = authService.onAuthStateChanged(async (user) => {
      if (user) {
        const fscCode = await teamService.getUserFscCode(user.uid);
        const profile = await teamService.getUserProfile(user.uid);
        setCurrentUser({
          uid: user.uid,
          fscCode: fscCode || "",
          nickname: profile?.nickname || "",
        });
      }
    });
    onCleanup(() => unsubscribe());
  });

  const getSectionElement = (section: SectionId) => {
    if (section === "details") return detailsSectionRef;
    if (section === "plans") return plansSectionRef;
    return summarySectionRef;
  };

  const scrollToSection = (section: SectionId) => {
    const target = getSectionElement(section);
    if (!target) return;
    setActiveSection(section);
    const navHeight = sectionNavRef?.offsetHeight ?? 0;
    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: Math.max(0, targetTop - navHeight - 32),
      behavior: "smooth",
    });
  };

  onMount(() => {
    const sections: SectionId[] = ["details", "plans", "summary"];
    let ticking = false;

    const updateActiveSection = () => {
      ticking = false;
      const navHeight = sectionNavRef?.offsetHeight ?? 0;
      const anchorLine = navHeight + 40;
      let nextSection: SectionId = "details";
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const section of sections) {
        const el = getSectionElement(section);
        if (!el) continue;
        const distance = Math.abs(el.getBoundingClientRect().top - anchorLine);
        if (distance < closestDistance) {
          closestDistance = distance;
          nextSection = section;
        }
      }

      setActiveSection(nextSection);
    };

    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateActiveSection);
    };

    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    onCleanup(() => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    });
  });

  // Populate draft from existing closing when editing
  createEffect(() => {
    if (restoredFromSave) return;
    const existing = existingClosing();
    const catalog = productsCatalog();
    if (!existing || existingClosing.loading) {
      return;
    }
    if (editId() && productsCatalog.loading) {
      return;
    }
    setSubmittedBy(
      (prev) =>
        prev ?? {
          fscCode: existing.fscCode || "",
          nickname: existing.fscName || "",
        },
    );

    // Convert Closing to ClosingDraft
    const products: DraftProduct[] = existing.items.map((item, idx) =>
      hydrateDraftProductFromClosingProduct(item, `existing-${idx}`, catalog),
    );

    setDraft({
      sourceId: existing.sourceId || "",
      sourceLabel:
        existing.sourceLabel || resolveSourceLabel(existing.sourceId || ""),
      sourceItemId: existing.sourceItemId || "",
      sourceItemLabel:
        existing.sourceItemLabel
        || resolveSourceItemLabel(existing.sourceId || "", existing.sourceItemId || ""),
      sourceComment: existing.sourceComment || "",
      products,
      sharedFscCode: existing.sharedFscCode || "",
      sharedFscName: existing.sharedFscName || "",
      sharedFscNone:
        !(
          typeof existing.isShared === "boolean"
            ? existing.isShared
            : existing.sharedFscCode || existing.sharedFscName
        ),
      referrals: existing.referrals ?? null,
      referralsComment: existing.referralsComment || "",
    });
  });

  // Existing closings don't persist rider attached suffix labels.
  // Backfill from current product catalog so plan short names render correctly.
  createEffect(() => {
    if (!editId()) return;
    const suffixByRiderId = riderSuffixByProductId();
    if (Object.keys(suffixByRiderId).length === 0) return;

    setDraft((current) => {
      const nextProducts = applyAttachedSuffixesFromCatalog(
        current.products,
        suffixByRiderId,
      );
      if (nextProducts === current.products) return current;
      return { ...current, products: nextProducts };
    });
  });

  // Backfill source label once sources are loaded (e.g. edit draft restored before sources).
  createEffect(() => {
    const sourceKey = draft().sourceId;
    if (!sourceKey || sources.loading) return;
    const resolved = resolveSourceLabel(sourceKey);
    if (!resolved) return;
    const currentLabel = draft().sourceLabel;
    if (currentLabel === resolved) return;
    if (currentLabel && currentLabel !== sourceKey) return;
    setDraft((d) => ({ ...d, sourceLabel: resolved }));
  });

  createEffect(() => {
    const sourceKey = draft().sourceId;
    const sourceItemId = draft().sourceItemId;
    if (!sourceKey || !sourceItemId || sources.loading) return;
    const resolved = resolveSourceItemLabel(sourceKey, sourceItemId);
    if (!resolved) return;
    const currentLabel = draft().sourceItemLabel;
    if (currentLabel === resolved) return;
    if (currentLabel && currentLabel !== sourceItemId) return;
    setDraft((d) => ({ ...d, sourceItemLabel: resolved }));
  });

  createEffect(() => {
    if (restoredFromSave) return;
    const user = currentUser();
    if (!user || editId()) return;
    setSubmittedBy({
      fscCode: user.fscCode,
      nickname: user.nickname,
    });
  });

  const serializeState = () => {
    const d = draft();
    return JSON.stringify({
      draft: {
        ...d,
        // Display-only field; do not treat async label hydration as user changes.
        sourceLabel: "",
        sourceItemLabel: "",
      },
      submittedBy: submittedBy(),
    });
  };

  createEffect(() => {
    if (snapshotReady()) return;
    if (editId() && existingClosing.loading) return;
    if (editId() && !submittedBy()) return;
    if (!editId() && !submittedBy()) return;
    setInitialSnapshot(serializeState());
    setSnapshotReady(true);
  });

  const hasUnsavedChanges = () =>
    snapshotReady() && initialSnapshot() !== serializeState();

  const hasValidSource = () => draft().sourceId !== "";
  const hasValidReferrals = () => {
    const referrals = draft().referrals;
    return typeof referrals === "number" && referrals >= 0;
  };
  const getCurrentProductsValidationError = () =>
    getProductsValidationError(draft());
  const hasValidProducts = () => !getCurrentProductsValidationError();

  const formatCurrency = (value: number) =>
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const submitDisabled = () =>
    !hasValidSource() ||
    !hasValidProducts() ||
    !hasValidReferrals() ||
    (Boolean(editId()) && !hasUnsavedChanges()) ||
    isSubmitting();

  // Submit
  const handleSubmit = async () => {
    const user = currentUser();
    if (!user) {
      setError("User not authenticated");
      return;
    }

    if (!hasValidSource()) {
      setError("Please select a source");
      return;
    }

    const productsValidationError = getCurrentProductsValidationError();
    if (productsValidationError) {
      setError(productsValidationError);
      return;
    }

    if (!hasValidReferrals()) {
      setError("Please enter the number of referrals");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const d = draft();
      const submitter = isEditingOthers()
        ? submittedBy() || {
            fscCode: existingClosing()?.fscCode || "",
            nickname: existingClosing()?.fscName || "",
          }
        : { fscCode: user.fscCode, nickname: user.nickname };
      const existing = existingClosing();

      // Convert DraftProducts to ClosingProducts
      // Use a helper to remove undefined values (Firestore doesn't accept them)
      const removeUndefined = <T extends Record<string, unknown>>(
        obj: T,
      ): T => {
        return Object.fromEntries(
          Object.entries(obj).filter(([_, v]) => v !== undefined),
        ) as T;
      };

      const items = d.products.map((p) =>
        removeUndefined({
          isRider: p.isRider || undefined,
          productId: p.productId,
          fullName: p.fullName,
          shortName: p.shortName,
          type: p.type || undefined,
          premiumTermOrIssueAge: p.premiumTermOrIssueAge || undefined,
          fycRate: p.fycRate,
          gst: p.gst ? 9 : 0,
          quantitiesAndPremiums: consolidatePremiumRowsByAmountAndFrequency(
            p.premiumRows,
          ).map((row) => ({
            quantity: row.quantity || 1,
            premium: row.premium,
            frequency: row.frequency || undefined,
          })),
          riders: p.riders.map((r) =>
            removeUndefined({
              isRider: r.isRider || undefined,
              productId: r.productId,
              fullName: r.fullName,
              shortName: r.shortName,
              type: r.type || undefined,
              premiumTermOrIssueAge: r.premiumTermOrIssueAge || undefined,
              fycRate: r.fycRate === -1 ? p.fycRate : r.fycRate,
              gst: r.gst ? 9 : 0,
              quantitiesAndPremiums: consolidatePremiumRowsByAmountAndFrequency(
                r.premiumRows,
              ).map((row) => ({
                quantity: row.quantity || 1,
                premium: row.premium,
                frequency: row.frequency || undefined,
              })),
              riders: [],
            }),
          ),
        }),
      );

      const closingData: ClosingInput = {
        timestamp: editId() ? existing?.timestamp || new Date() : new Date(),
        fscCode: submitter.fscCode,
        fscName: submitter.nickname,
        isShared: isDraftShared(d),
        updatedBy: user.nickname,
        updatedAt: new Date().toISOString(),
        sourceId: d.sourceId,
        referrals: d.referrals as number,
        items,
      };

      // Only add optional fields if they have values (Firestore doesn't accept undefined)
      if (d.sourceItemId) closingData.sourceItemId = d.sourceItemId;
      if (d.sourceComment) closingData.sourceComment = d.sourceComment;
      if (d.sharedFscCode) closingData.sharedFscCode = d.sharedFscCode;
      if (d.sharedFscName) closingData.sharedFscName = d.sharedFscName;
      if (d.referralsComment) closingData.referralsComment = d.referralsComment;

      if (editId()) {
        await closingsService.updateClosing({
          id: editId()!,
          ...closingData,
        } as Closing);
      } else {
        await closingsService.createClosing(closingData);
      }

      setSubmitFeedback({
        open: true,
        kind: "success",
        message: editId()
          ? "Closing updated successfully."
          : "Closing submitted successfully.",
      });
    } catch (e) {
      setSubmitFeedback({
        open: true,
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to submit closing",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const { GuardModal, guardNavigate, skipGuard } =
    createNavigationGuard(hasUnsavedChanges);

  const handleCancel = () => guardNavigate(() => navigateBack("/closings"));

  const closeSubmitFeedback = () =>
    setSubmitFeedback((prev) => ({ ...prev, open: false }));

  const handleSubmitFeedbackConfirm = async () => {
    const feedback = submitFeedback();
    closeSubmitFeedback();
    if (feedback.kind === "success") {
      skipGuard();
      if (!editId()) {
        resetClosingsListView();
      }
      navigate("/closings", { replace: true });
      return;
    }
    await handleSubmit();
  };

  const handleEditPlan = (
    product: DraftProduct,
    index: number | null,
    isAddon: boolean,
  ) => {
    const location = window.location;
    saveSubmitState({
      draft: draft(),
      submittedBy: submittedBy(),
      initialSnapshot: initialSnapshot(),
      snapshotReady: snapshotReady(),
      returnUrl: location.pathname + location.search,
    });
    setEditPlan({ product, index, isAddon });
    navigatingToEditPlan = true;
    skipGuard();
    window.setTimeout(() => {
      navigate("/closings/submit/plan");
    }, 50);
  };

  const handleDelete = async () => {
    const id = editId();
    if (!id) return;
    if (!(await confirmDeleteClosing())) return;

    setIsDeleting(true);
    setError("");
    try {
      await closingsService.deleteClosing(id);
      setDeleteFeedback({
        open: true,
        kind: "success",
        message: "Closing deleted successfully.",
      });
    } catch (e) {
      setDeleteFeedback({
        open: true,
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to delete closing",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const closeDeleteFeedback = () =>
    setDeleteFeedback((prev) => ({ ...prev, open: false }));

  const handleDeleteFeedbackConfirm = () => {
    const feedback = deleteFeedback();
    closeDeleteFeedback();
    if (feedback.kind === "success") {
      skipGuard();
      navigate("/closings", { replace: true });
    }
  };

  return (
    <PageShell>
      <PageHeader
        icon={<TbOutlineFilePlus class="h-5 w-5" />}
        title={editId() ? "Edit Closing" : "Submit Closing"}
        subtitle="Complete closing details"
        onBack={handleCancel}
      />

      <div
        class="mx-auto max-w-6xl px-4 pb-20 pt-6"
        data-disable-pull-refresh="true"
      >
        {/* Error Alert */}
        <Show when={error()}>
          <div class="mb-4">
            <Alert type="error">{error()}</Alert>
          </div>
        </Show>

        {/* Loading state for edit mode */}
        <Show when={editId() && existingClosing.loading}>
          <div class="flex items-center justify-center py-12">
            <Spinner class="h-8 w-8 text-primary" />
          </div>
        </Show>
        <Show when={editId() && !existingClosing.loading && productsCatalog.loading}>
          <div class="flex items-center justify-center py-12">
            <Spinner class="h-8 w-8 text-primary" />
          </div>
        </Show>

        {/* Content */}
        <Show when={!editId() || (!existingClosing.loading && !productsCatalog.loading)}>
          <Suspense
            fallback={
              <LoadingState label="Loading..." class="py-12" />
            }
          >
            <div class="space-y-4">
              <div
                ref={sectionNavRef}
                class="sticky top-0 z-20 rounded-lg border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur lg:hidden"
              >
                <div class="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => scrollToSection("details")}
                    class={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                      activeSection() === "details"
                        ? "bg-primary text-white"
                        : "cursor-pointer bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollToSection("plans")}
                    class={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                      activeSection() === "plans"
                        ? "bg-primary text-white"
                        : "cursor-pointer bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Plans
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollToSection("summary")}
                    class={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                      activeSection() === "summary"
                        ? "bg-primary text-white"
                        : "cursor-pointer bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Summary
                  </button>
                </div>
              </div>

              <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div class="space-y-6">
                  <div
                    id="details-section"
                    ref={detailsSectionRef}
                    class="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                  <div class="space-y-4">
                    <h3 class="text-xl font-condensed font-semibold text-slate-900">
                      Details
                    </h3>

                    <Show when={isEditingOthers()}>
                      <div>
                        <label class="block text-base font-semibold text-slate-700">
                          Submitted by
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowSubmittedByPicker(true)}
                          class="mt-2 flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 shadow-sm transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                          <span>{submittedByLabel()}</span>
                          <TbOutlineSearch class="h-4 w-4 text-slate-500" />
                        </button>
                      </div>
                    </Show>
                    <div>
                      <label class="block text-base font-semibold text-slate-700">
                        Shared with FSC
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowFscPicker(true)}
                        class="mt-2 flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 shadow-sm transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <span class={sharedFscLabel() ? "" : "text-slate-500"}>
                          {sharedFscLabel() || "Select FSC #2 (if any)..."}
                        </span>
                        <TbOutlineSearch class="h-4 w-4 text-slate-500" />
                      </button>
                    </div>

                    <div>
                      <label class="block text-base font-semibold text-slate-700">
                        Source
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowSourcePicker(true)}
                        class={`mt-2 flex w-full items-center justify-between rounded-xl border px-3 py-2 text-base shadow-sm transition focus:outline-none focus:ring-2 ${
                          hasValidSource()
                            ? "border-slate-300 bg-white text-slate-800 hover:border-primary focus:ring-primary/20"
                            : "border-red-300 bg-red-50/40 text-slate-800 focus:ring-red-200"
                        }`}
                      >
                        <span
                          class={sourceDisplayLabel() ? "" : "text-slate-500"}
                        >
                          {sourceDisplayLabel() || "Select source..."}
                        </span>
                        <TbOutlineSearch class="h-4 w-4 text-slate-500" />
                      </button>
                    </div>

                    <div>
                      <label class="block text-base font-semibold text-slate-700">
                        Source comment (optional)
                      </label>
                      <input
                        type="text"
                        value={draft().sourceComment}
                        onInput={(e) =>
                          setDraft((d) => ({
                            ...d,
                            sourceComment: e.currentTarget.value,
                          }))
                        }
                        placeholder="e.g. name of seminar"
                        class="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-500 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>

                    <div>
                      <label class="block text-base font-semibold text-slate-700">
                        Number of referrals
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={draft().referrals ?? ""}
                        onInput={(e) =>
                          setDraft((d) => ({
                            ...d,
                            referrals:
                              e.currentTarget.value === ""
                                ? null
                                : Math.max(
                                    0,
                                    parseInt(e.currentTarget.value) || 0,
                                  ),
                          }))
                        }
                        class={`mt-2 w-full rounded-xl border px-3 py-2 text-base shadow-sm focus:outline-none focus:ring-2 ${
                          hasValidReferrals()
                            ? "border-slate-300 bg-white text-slate-900 focus:border-primary focus:ring-primary/20"
                            : "border-red-300 bg-red-50/40 text-slate-900 focus:ring-red-200"
                        }`}
                      />
                    </div>
                  </div>
                  </div>

                  <div
                    id="plans-section"
                    ref={plansSectionRef}
                    class={`scroll-mt-28 rounded-2xl border bg-white p-5 shadow-sm ${
                      hasValidProducts() ? "border-slate-200" : "border-red-200"
                    }`}
                  >
                    <div class="mb-4 flex items-center justify-between">
                      <h3 class="text-xl font-condensed font-semibold text-slate-900">
                        Plans
                      </h3>
                    </div>

                    <PlansSection
                      draft={draft()}
                      setDraft={setDraft}
                      onNext={() => {}}
                      onPrev={() => {}}
                      canProceed={hasValidProducts()}
                      showNavigation={false}
                      showActions={true}
                      onEditPlan={handleEditPlan}
                      highlightProductId={highlightProductId()}
                    />
                  </div>
                </div>

                <div
                  id="summary-section"
                  ref={summarySectionRef}
                  class="space-y-4 h-fit scroll-mt-28 lg:sticky lg:top-6"
                >
                  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    {(() => {
                      const currentDraft = draft();
                      const totalFYC = currentDraft.products.reduce(
                        (sum, product) => sum + calculateProductFYC(product),
                        0,
                      );
                      const totalAFYP = currentDraft.products.reduce(
                        (sum, product) => sum + calculateProductFYP(product),
                        0,
                      );
                      const submitterName =
                        submittedBy()?.nickname ||
                        currentUser()?.nickname ||
                        "Unknown";
                      const sharedName = currentDraft.sharedFscName || "";
                      const closingTime = previewTimestamp().toLocaleTimeString(
                        "en-US",
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        },
                      );
                      const summaryErrors: string[] = [];
                      if (!hasValidSource()) {
                        summaryErrors.push("Missing source.");
                      }
                      if (!hasValidReferrals()) {
                        summaryErrors.push("Missing referrals.");
                      }
                      const productsValidationError =
                        getProductsValidationError(currentDraft);
                      if (productsValidationError) {
                        summaryErrors.push(productsValidationError);
                      }
                      return (
                        <div class="space-y-3">
                          <div>
                            <div class="flex items-baseline justify-between gap-3">
                              <div class="text-xl font-condensed font-semibold text-slate-900">
                                Summary
                              </div>
                              <Show when={summaryDateLabel()}>
                                <div class="text-sm italic text-gray-500">
                                  {summaryDateLabel()}
                                </div>
                              </Show>
                            </div>
                            <div class="mt-3">
                              <ClosingDisplayBlock
                                model={buildClosingDisplayModel({
                                  primaryName: submitterName,
                                  isShared: isDraftShared(currentDraft),
                                  sharedFscCode: currentDraft.sharedFscCode,
                                  sharedFscName: sharedName,
                                  totalFyc: totalFYC,
                                  totalAfyp: totalAFYP,
                                  products: currentDraft.products.map((item) => {
                                    const totalQty =
                                      consolidatePremiumRowsByAmountAndFrequency(
                                        item.premiumRows,
                                      ).reduce(
                                        (sum, row) => sum + row.quantity,
                                        0,
                                      );
                                    const baseShortName =
                                      item.shortName || item.fullName;
                                    return {
                                      quantity: totalQty,
                                      shortName: item.shortNameManuallyEdited
                                        ? baseShortName
                                        : appendAttachedSuffixesFromRiders(
                                            baseShortName,
                                            item.riders,
                                          ),
                                      fyc: calculateProductFYC(item),
                                    };
                                  }),
                                  sourceLineText: formatSourceLine(
                                    currentDraft.sourceId,
                                    currentDraft.sourceLabel,
                                    currentDraft.sourceItemId,
                                    currentDraft.sourceItemLabel,
                                    currentDraft.sourceComment,
                                  ),
                                  referrals: currentDraft.referrals,
                                  timeLabel: closingTime,
                                  includeSource: hasValidSource(),
                                  includeReferrals: hasValidReferrals(),
                                })}
                              />
                            </div>
                          </div>

                          <Show when={summaryErrors.length > 0}>
                            <div class="rounded-xl border border-red-300 bg-red-50 p-3">
                              <div class="text-sm font-semibold text-red-900">
                                Errors
                              </div>
                              <div class="mt-2 space-y-1">
                                <For each={summaryErrors}>
                                  {(error) => (
                                    <div class="text-sm text-red-800">
                                      • {error}
                                    </div>
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </div>
                      );
                    })()}
                  </div>

                  <Button
                    variant="primary"
                    fullWidth
                    size="lg"
                    onClick={handleSubmit}
                    disabled={submitDisabled() || isDeleting()}
                  >
                    {isSubmitting()
                      ? editId()
                        ? "Updating..."
                        : "Submitting..."
                      : editId()
                        ? "UPDATE"
                        : "SUBMIT"}
                  </Button>
                  <Show when={editId()}>
                    <Button
                      variant="dangerSolid"
                      fullWidth
                      size="lg"
                      onClick={handleDelete}
                      disabled={isSubmitting() || isDeleting()}
                    >
                      {isDeleting() ? "Deleting..." : "DELETE"}
                    </Button>
                  </Show>

                  <div class="h-40" aria-hidden="true" />
                </div>
              </div>
            </div>

              <_FscPicker
                isOpen={showFscPicker()}
                onClose={() => setShowFscPicker(false)}
                includeNone
                includeOther
                selectedFscCode={draft().sharedFscCode}
                selectedNickname={draft().sharedFscName}
                selectedNone={draft().sharedFscNone}
                onSelect={(user) =>
                  setDraft((d) => ({
                    ...d,
                    sharedFscCode: user.fscCode,
                    sharedFscName: user.nickname,
                    sharedFscNone: user.isNone === true,
                  }))
                }
                excludeFscCode={currentUser()?.fscCode}
              />
              <_FscPicker
                isOpen={showSubmittedByPicker()}
                onClose={() => setShowSubmittedByPicker(false)}
                selectedFscCode={submittedBy()?.fscCode}
                selectedNickname={submittedBy()?.nickname}
                onSelect={(user) =>
                  setSubmittedBy({
                    fscCode: user.fscCode,
                    nickname: user.nickname,
                  })
                }
              />
              <SourcePicker
                isOpen={showSourcePicker()}
                onClose={() => setShowSourcePicker(false)}
                selectedSourceId={draft().sourceId}
                selectedSourceItemId={draft().sourceItemId}
                onSelect={(selection) =>
                  setDraft((d) => ({
                    ...d,
                    sourceId: selection.sourceId,
                    sourceLabel: selection.sourceLabel,
                    sourceItemId: selection.sourceItemId || "",
                    sourceItemLabel: selection.sourceItemLabel || "",
                  }))
                }
              />
          </Suspense>
        </Show>
      </div>

      <GuardModal />
      <DeleteClosingModal />
      <ConfirmModal
        open={submitFeedback().open}
        title={
          submitFeedback().kind === "success" ? "Success" : "Unable to submit"
        }
        message={submitFeedback().message}
        confirmLabel={submitFeedback().kind === "success" ? "OK" : "Retry"}
        cancelLabel={submitFeedback().kind === "success" ? "Close" : "OK"}
        hideCancel={submitFeedback().kind === "success"}
        variant={submitFeedback().kind === "success" ? "default" : "danger"}
        onConfirm={handleSubmitFeedbackConfirm}
        onCancel={closeSubmitFeedback}
      />
      <ConfirmModal
        open={deleteFeedback().open}
        title={
          deleteFeedback().kind === "success" ? "Success" : "Unable to delete"
        }
        message={deleteFeedback().message}
        confirmLabel="OK"
        hideCancel
        variant={deleteFeedback().kind === "success" ? "default" : "danger"}
        onConfirm={handleDeleteFeedbackConfirm}
        onCancel={closeDeleteFeedback}
      />
    </PageShell>
  );
};

export default SubmitClosing;
