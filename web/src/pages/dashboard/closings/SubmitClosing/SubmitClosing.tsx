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
  type PremiumFrequency,
  getAnnualizedFYP,
  getFYC,
} from "../../../../services/closingsService";
import { authService } from "../../../../services/authService";
import { teamService } from "../../../../services/teamService";
import { sourcesService } from "../../../../services/sourcesService";
import ClosingDisplayBlock from "../_ClosingDisplayBlock";
import { buildClosingDisplayModel, formatSourceLine } from "../_closingDisplay";
import { resetClosingsListView } from "../_closingsListViewState";
import { isAddonProduct } from "./_planUtils";
import {
  saveSubmitState,
  getSavedState,
  clearSavedState,
  setEditPlan,
  consumePendingHighlightProductId,
  consumePendingScrollToAddNewBusiness,
} from "./_submitStore";
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

const isDraftShared = (
  draft: Pick<ClosingDraft, "sharedFscCode" | "sharedFscName" | "sharedFscNone">,
): boolean => {
  if (draft.sharedFscNone) return false;
  return Boolean(draft.sharedFscCode || draft.sharedFscName);
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
    if (!existing || existingClosing.loading) {
      return;
    }
    setSubmittedBy(
      (prev) =>
        prev ?? {
          fscCode: existing.fscCode || "",
          nickname: existing.fscName || "",
        },
    );
    const normalizeFrequency = (value?: string): PremiumFrequency => {
      const allowed: PremiumFrequency[] = [
        "Annual",
        "Semi-Annual",
        "Quarterly",
        "Mthly-1",
        "Mthly-2",
      ];
      return allowed.includes(value as PremiumFrequency)
        ? (value as PremiumFrequency)
        : "Annual";
    };

    // Convert Closing to ClosingDraft
    const products: DraftProduct[] = existing.items.map((item, idx) => {
      const premiumRows: DraftPremiumRow[] =
        item.quantitiesAndPremiums?.map((entry, entryIdx) => ({
          id: `existing-${idx}-row-${entryIdx}`,
          premium: entry.premium || 0,
          frequency: normalizeFrequency(entry.frequency),
          quantity: entry.quantity || 1,
        })) || [];

      const fallbackRows: DraftPremiumRow[] = premiumRows.length
        ? premiumRows
        : [
            {
              id: `existing-${idx}-row-0`,
              premium: 0,
              frequency: "Annual",
              quantity: 1,
            },
          ];

      return {
        id: `existing-${idx}`,
        isRider: Boolean(item.isRider),
        productId: item.productId,
        fullName: item.fullName,
        shortName: item.shortName,
        type: item.type,
        premiumTermOrIssueAge: item.premiumTermOrIssueAge,
        frequencies: item.frequencies,
        fycRate: item.fycRate,
        gst: item.gst > 0,
        premiumRows: fallbackRows,
        riders: (item.riders || []).map((rider, rIdx) => {
          const riderRows: DraftPremiumRow[] =
            rider.quantitiesAndPremiums?.map((entry, entryIdx) => ({
              id: `existing-rider-${idx}-${rIdx}-row-${entryIdx}`,
              premium: entry.premium || 0,
              frequency: normalizeFrequency(entry.frequency),
              quantity: entry.quantity || 1,
            })) || [];

          return {
            id: `existing-rider-${idx}-${rIdx}`,
            isRider: Boolean(rider.isRider),
            productId: rider.productId,
            fullName: rider.fullName,
            shortName: rider.shortName,
            premiumTermOrIssueAge: rider.premiumTermOrIssueAge,
            type: rider.type,
            frequencies: rider.frequencies,
            fycRate: rider.fycRate,
            gst: rider.gst > 0,
            premiumRows: riderRows.length
              ? riderRows
              : [
                  {
                    id: `existing-rider-${idx}-${rIdx}-row-0`,
                    premium: 0,
                    frequency: "Annual",
                    quantity: 1,
                  },
                ],
            riders: [],
          };
        }),
      };
    });

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
  const hasValidProducts = () => {
    const products = draft().products;
    if (products.length === 0) return false;
    return products.every((product) => {
      if (product.premiumRows.length === 0) return false;
      const productValid = product.premiumRows.every(
        (row) => row.premium > 0 && Boolean(row.frequency),
      );
      if (!productValid) return false;
      return product.riders.every((rider) => {
        if (rider.premiumRows.length === 0) return false;
        return rider.premiumRows.every(
          (row) => row.premium > 0 && Boolean(row.frequency),
        );
      });
    });
  };

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
          quantitiesAndPremiums: p.premiumRows.map((row) => ({
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
              quantitiesAndPremiums: r.premiumRows.map((row) => ({
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

        {/* Content */}
        <Show when={!editId() || !existingClosing.loading}>
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
                      if (!hasValidProducts()) {
                        summaryErrors.push("Missing plans.");
                      }
                      return (
                        <div class="space-y-3">
                          <div>
                            <div class="text-xl font-condensed font-semibold text-slate-900">
                              Summary
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
                                    const totalQty = item.premiumRows.reduce(
                                      (sum, row) => sum + (row.quantity || 1),
                                      0,
                                    );
                                    return {
                                      quantity: totalQty,
                                      shortName: item.shortName,
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
