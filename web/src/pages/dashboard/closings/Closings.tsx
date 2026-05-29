import {
  Component,
  onMount,
  onCleanup,
  Show,
  For,
  createSignal,
  createMemo,
  createEffect,
  createResource,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import {
  TbOutlineFilePlus,
  TbOutlineCalendar,
  TbOutlineShare2,
  TbOutlineHistory,
  TbOutlineDownload,
  TbOutlineUpload,
  TbOutlineX,
  TbOutlineTrash,
  TbOutlinePencil,
} from "solid-icons/tb";
import {
  AccordionCard,
  PageShell,
  PageHeader,
  PageBody,
  IconButton,
  Button,
  BackToTopFab,
  LoadingState,
} from "../../../components/ui";
import { dashboardOptions } from "../dashboardOptions";
import {
  filterMode,
  setFilterMode,
  selectedPeriod,
  setSelectedPeriod,
  resetClosingsListView,
  type FilterMode,
} from "./_closingsListViewState";

import {
  closingsService,
  type Closing,
  type ClosingBackup,
  type ClosingInput,
} from "../../../services/closingsService";
import { authService } from "../../../services/authService";
import { teamService } from "../../../services/teamService";
import { productsService } from "../../../services/productsService";
import {
  annualizePremium,
  calculateProductFyc,
  countInvalidPremiumFrequencyRows,
} from "../../../utils/closingMetrics";
import { consolidatePremiumRowsByAmountAndFrequency } from "../../../utils/closingPremiumRows";
import { appendAttachedSuffixesByRiderProductId } from "../../../utils/attachedSuffix";
import ClosingDisplayBlock from "./_ClosingDisplayBlock";
import {
  buildClosingDisplayModel,
  formatSourceLine,
  formatClosingDisplayForWhatsApp,
} from "./_closingDisplay";

type PremiumFrequency =
  | "Annual"
  | "Semi-Annual"
  | "Quarterly"
  | "Mthly-1"
  | "Mthly-2"
  | "Single";

type ClosingProductQuantityAndPremium = {
  quantity: number;
  premium: number;
  frequency?: PremiumFrequency;
};

type ClosingProduct = {
  id?: string;
  isRider?: boolean;
  productId: string;
  fullName: string;
  shortName: string;
  premiumTermOrIssueAge?: any;
  type?: string;
  fycRate: number;
  gst: number;
  quantitiesAndPremiums: ClosingProductQuantityAndPremium[];
  riders: ClosingProduct[];
};

interface MonthOption {
  value: string;
  label: string;
}

// Module-level state
const [userFscCode, setUserFscCode] = createSignal<string | null>(null);
const [isAdmin, setIsAdmin] = createSignal(false);
const [canViewTeamClosings, setCanViewTeamClosings] = createSignal(false);
const [teamFscCodes, setTeamFscCodes] = createSignal<Set<string>>(new Set());

// Helper functions

function calculateProductCaseCount(product: ClosingProduct): number {
  let count = 0;
  for (const qp of product.quantitiesAndPremiums || []) {
    count += qp.quantity;
  }
  return count;
}

function calculateClosingFycAndCaseCount(items: ClosingProduct[]): {
  fyc: number;
  caseCount: number;
} {
  let totalFyc = 0;
  let totalCaseCount = 0;

  for (const item of items || []) {
    totalFyc += calculateProductFyc(item);

    // Only count non-riders for case count
    if (!item.isRider) {
      totalCaseCount += calculateProductCaseCount(item);
    }
  }

  return { fyc: totalFyc, caseCount: totalCaseCount };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  if (typeof error === "string") {
    const message = error.trim();
    if (message) return message;
  }
  return "Unable to load closings.";
}

// Calculate AFYP for a product (10% for Single category)
function calculateProductAfyp(product: ClosingProduct): number {
  const isSingle = product.type?.toLowerCase() === "single";
  const fypMultiplier = isSingle ? 0.1 : 1;

  let totalAfyp = 0;

  for (const qp of product.quantitiesAndPremiums) {
    let annualized = annualizePremium(qp.premium, qp.frequency);
    if (annualized === null) {
      continue;
    }

    // Remove GST if applicable
    if (product.gst > 0) {
      annualized = annualized / (1 + product.gst / 100);
    }

    totalAfyp += annualized * qp.quantity * fypMultiplier;
  }

  // Add rider AFYP (riders inherit parent's Single multiplier)
  for (const rider of product.riders || []) {
    for (const qp of rider.quantitiesAndPremiums) {
      let annualized = annualizePremium(qp.premium, qp.frequency);
      if (annualized === null) {
        continue;
      }

      if (rider.gst > 0) {
        annualized = annualized / (1 + rider.gst / 100);
      }

      totalAfyp += annualized * qp.quantity * fypMultiplier;
    }
  }

  return totalAfyp;
}

function calculateClosingAfyp(items: ClosingProduct[]): number {
  let totalAfyp = 0;
  for (const item of items) {
    totalAfyp += calculateProductAfyp(item);
  }
  return totalAfyp;
}

// Check if any item has type (needed for accurate AFYP calculation)
function hasClassification(items: ClosingProduct[]): boolean {
  return items.some((item) => !!item.type);
}

function toClosingDisplayModel(
  closing: Closing,
  timeLabel?: string,
  riderAttachedSuffixByProductId: Record<string, string> = {},
) {
  const { fyc } = calculateClosingFycAndCaseCount(closing.items);
  const afyp = calculateClosingAfyp(closing.items);

  return buildClosingDisplayModel({
    primaryName: closing.fscName || "Unknown",
    isShared: closing.isShared,
    sharedFscCode: closing.sharedFscCode,
    sharedFscName: closing.sharedFscName,
    totalFyc: fyc,
    totalAfyp: afyp,
    products: closing.items.map((item: any) => {
      const totalQty = consolidatePremiumRowsByAmountAndFrequency(
        item.quantitiesAndPremiums || [],
      ).reduce((sum, qp) => sum + qp.quantity, 0);
      const itemFyc = calculateClosingFycAndCaseCount([item]).fyc;
      return {
        quantity: totalQty,
        shortName: appendAttachedSuffixesByRiderProductId(
          item.shortName,
          item.riders || [],
          riderAttachedSuffixByProductId,
        ),
        fyc: itemFyc,
      };
    }),
    sourceLineText: formatSourceLine(
      closing.sourceId,
      closing.sourceLabel,
      closing.sourceItemId,
      closing.sourceItemLabel,
      closing.sourceComment,
    ),
    referrals: closing.referrals,
    timeLabel,
  });
}

function generateMonthOptions(): MonthOption[] {
  const options: MonthOption[] = [{ value: "today", label: "Today" }];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const value = `${year}-${month}`;
    const label = date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    options.push({ value, label });
  }
  return options;
}

function getSelectedPeriodLabel(): string {
  const period = selectedPeriod();
  if (period === "today") return "Today";
  const [year, month] = period.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return period;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatDateFilterValue(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatClosingsForWhatsApp(
  closings: Closing[],
  dateStr: string,
  riderAttachedSuffixByProductId: Record<string, string> = {},
): string {
  let message = `*Closing for ${dateStr}*\n\n`;

  closings.forEach((closing) => {
    const model = toClosingDisplayModel(
      closing,
      undefined,
      riderAttachedSuffixByProductId,
    );

    message += `${formatClosingDisplayForWhatsApp(model)}\n\n`;
  });

  return message.trim();
}

// Compute query parameters
const queryParams = () => {
  let startDate: string;
  let endDate: string;

  if (selectedPeriod() === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    startDate = formatDateFilterValue(today);
    endDate = formatDateFilterValue(today);
  } else {
    const [year, month] = selectedPeriod().split("-").map(Number);
    const start = new Date(year, month - 1, 1);
    start.setHours(0, 0, 0, 0);
    startDate = formatDateFilterValue(start);

    const lastDay = new Date(year, month, 0);
    lastDay.setHours(0, 0, 0, 0);
    endDate = formatDateFilterValue(lastDay);
  }

  return {
    startDate,
    endDate,
  };
};

const Closings: Component = () => {
  resetClosingsListView();

  const navigate = useNavigate();
  const [refreshing, setRefreshing] = createSignal(false);
  const [stickyControlsHeight, setStickyControlsHeight] = createSignal(0);
  const [lastAnimatedFilterMode, setLastAnimatedFilterMode] =
    createSignal<FilterMode | null>(null);
  let stickyControlsRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;
  const [showBackupModal, setShowBackupModal] = createSignal(false);
  const [backupLoading, setBackupLoading] = createSignal(false);
  const [backupError, setBackupError] = createSignal("");
  const [backups, setBackups] = createSignal<ClosingBackup[]>([]);
  const [pendingRestore, setPendingRestore] =
    createSignal<ClosingBackup | null>(null);
  const [pendingImport, setPendingImport] = createSignal<ClosingInput[] | null>(
    null,
  );
  const [restoringId, setRestoringId] = createSignal("");
  const [pendingDelete, setPendingDelete] = createSignal<ClosingBackup | null>(
    null,
  );
  const [deletingId, setDeletingId] = createSignal("");
  const [hasLoadedClosingsOnce, setHasLoadedClosingsOnce] = createSignal(false);
  let importInputRef: HTMLInputElement | undefined;

  const [closings, { refetch }] = createResource(
    queryParams,
    async (params) => {
      try {
        return await closingsService.getClosings(params);
      } finally {
        setHasLoadedClosingsOnce(true);
      }
    },
    { initialValue: [] },
  );
  const [productsCatalog] = createResource(() => productsService.getProducts());
  const riderAttachedSuffixByProductId = createMemo<Record<string, string>>(() => {
    const catalog = productsCatalog();
    const riders = Array.isArray(catalog?.riders) ? catalog.riders : [];
    const mapping: Record<string, string> = {};
    for (const rider of riders) {
      const id = String(rider.id || "").trim();
      const suffix = String(rider.attachedSuffix || "").trim();
      if (!id || !suffix) continue;
      mapping[id] = suffix;
    }
    return mapping;
  });
  const filteredClosings = createMemo(() => {
    const allClosings = closings() ?? [];
    if (filterMode() === "all") return allClosings;
    if (filterMode() === "team") {
      const codes = teamFscCodes();
      if (codes.size === 0) return [];
      return allClosings.filter(
        (closing) =>
          codes.has(closing.fscCode) ||
          Boolean(closing.sharedFscCode && codes.has(closing.sharedFscCode)),
      );
    }
    const fscCode = userFscCode();
    if (!fscCode) return [];
    return allClosings.filter(
      (closing) =>
        closing.fscCode === fscCode || closing.sharedFscCode === fscCode,
    );
  });
  const invalidFrequencyRowCount = createMemo(() =>
    filteredClosings().reduce(
      (sum, closing) =>
        sum + countInvalidPremiumFrequencyRows(closing.items || []),
      0,
    ),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const selectedPeriodLabel = () => {
    const period = selectedPeriod();
    if (period === "today") return "Today";
    const [year, month] = period.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return period;
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  };

  const selectedMonthKey = () => {
    if (selectedPeriod() === "today") {
      const now = new Date();
      return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    }
    const [year, month] = selectedPeriod().split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return "";
    return `${year}${String(month).padStart(2, "0")}`;
  };

  const formatTimestamp = (value: Date = new Date()) => {
    const pad = (num: number) => String(num).padStart(2, "0");
    return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}`;
  };

  const formatBackupDate = (value?: Date) => {
    if (!value) return "Unknown date";
    return value.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatBackupOwner = (backup: ClosingBackup) => {
    const items = parseMonthData(backup.data);
    const withUpdatedAt = items
      .filter((entry) => entry.updatedAt)
      .sort(
        (a, b) =>
          new Date(b.updatedAt || 0).getTime() -
          new Date(a.updatedAt || 0).getTime(),
      );
    const latest = withUpdatedAt[0];
    return latest?.updatedBy || "Unknown";
  };

  const downloadJson = (filename: string, data: ClosingInput[]) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const parseMonthData = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as ClosingInput[]) : [];
    } catch {
      return [];
    }
  };

  const handleImportChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ClosingInput[];
      if (!Array.isArray(parsed)) {
        setBackupError("Invalid file format.");
        return;
      }
      setPendingImport(parsed);
    } catch (error) {
      console.error("Failed to parse import file", error);
      setBackupError("Unable to read JSON file.");
    } finally {
      input.value = "";
    }
  };

  const handleConfirmImport = async () => {
    const data = pendingImport();
    const monthKey = selectedMonthKey();
    if (!data || !monthKey) return;
    setRestoringId("import");
    setBackupError("");
    try {
      await closingsService.setMonthData(monthKey, JSON.stringify(data));
      setShowBackupModal(false);
      setPendingImport(null);
      refetch();
    } catch (error) {
      console.error("Failed to import closings data", error);
      setBackupError("Unable to restore data.");
    } finally {
      setRestoringId("");
    }
  };

  const handleRestore = async (backup: ClosingBackup) => {
    const monthKey = selectedMonthKey();
    if (!monthKey) return;
    setRestoringId(backup.id);
    setBackupError("");
    try {
      await closingsService.setMonthData(monthKey, backup.data);
      setShowBackupModal(false);
      setPendingRestore(null);
      refetch();
    } catch (error) {
      console.error("Failed to restore closings backup", error);
      setBackupError("Unable to restore backup.");
    } finally {
      setRestoringId("");
    }
  };

  const handleDelete = async (backup: ClosingBackup) => {
    setDeletingId(backup.id);
    setBackupError("");
    try {
      await closingsService.deleteBackup(backup.id);
      setBackups((prev) => prev.filter((item) => item.id !== backup.id));
      setPendingDelete(null);
    } catch (error) {
      console.error("Failed to delete closings backup", error);
      setBackupError("Unable to delete backup.");
    } finally {
      setDeletingId("");
    }
  };

  createEffect(() => {
    if (!showBackupModal()) return;
    const monthKey = selectedMonthKey();
    if (!monthKey) return;
    const loadBackups = async () => {
      setBackupLoading(true);
      setBackupError("");
      try {
        const list = await closingsService.getBackupsForMonth(monthKey);
        setBackups(list);
      } catch (error) {
        console.error("Failed to load closings backups", error);
        setBackupError("Unable to load backups.");
      } finally {
        setBackupLoading(false);
      }
    };
    loadBackups();
  });

  createEffect(() => {
    const mode = filterMode();
    const prev = lastAnimatedFilterMode();
    if (prev === null) {
      setLastAnimatedFilterMode(mode);
      return;
    }
    if (prev === mode || !contentRef) return;

    const filterOrder: FilterMode[] = ["all", "team", "mine"];
    const direction =
      filterOrder.indexOf(prev) < filterOrder.indexOf(mode) ? 1 : -1;
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
    setLastAnimatedFilterMode(mode);
  });

  onMount(() => {
    const updateStickyControlsHeight = () => {
      if (!stickyControlsRef) return;
      const nextHeight = stickyControlsRef.offsetHeight;
      setStickyControlsHeight(Number.isFinite(nextHeight) ? nextHeight : 0);
    };

    requestAnimationFrame(updateStickyControlsHeight);
    window.addEventListener("resize", updateStickyControlsHeight);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && stickyControlsRef) {
      observer = new ResizeObserver(updateStickyControlsHeight);
      observer.observe(stickyControlsRef);
    }

    onCleanup(() => {
      window.removeEventListener("resize", updateStickyControlsHeight);
      observer?.disconnect();
    });
  });

  onMount(() => {
    const unsub = authService.onAuthStateChanged(async (user) => {
      if (!user) {
        navigate("/", { replace: true });
        return;
      }

      // Load user's FSC code and admin status
      try {
        const fscCode = await teamService.getUserFscCode(user.uid);
        setUserFscCode(fscCode);

        const profile = await teamService.getUserProfile(user.uid);
        const { isAdmin: adminStatus } =
          await teamService.getCurrentUserAccessLevel();
        const canViewTeam = adminStatus;

        setIsAdmin(adminStatus);
        setCanViewTeamClosings(canViewTeam);

        if (canViewTeam && profile?.agencyCode) {
          const teamData = await teamService.getTeamData();
          setTeamFscCodes(
            new Set(
              teamData.users
                .filter((member) => member.agencyCode === profile.agencyCode)
                .map((member) => String(member.fscCode || "").trim())
                .filter(Boolean),
            ),
          );
        } else {
          setTeamFscCodes(new Set());
          if (filterMode() === "team") setFilterMode("all");
        }
      } catch (e) {
        console.error("Failed to load user info", e);
      }
    });
    onCleanup(() => unsub && unsub());
  });

  return (
    <PageShell>
      <PageHeader
        title={dashboardOptions.closings.title}
        subtitle={dashboardOptions.closings.description}
        icon={
          <Dynamic component={dashboardOptions.closings.icon} class="h-5 w-5" />
        }
        onBack={() => navigate(-1)}
      />

      <PageBody>
        <div class="pb-10">
          <div
            ref={stickyControlsRef}
            class="sticky top-0 z-30 -mx-4 border-b border-gray-200 bg-gray-50 px-4 pt-3 pb-4"
          >
            <div class="space-y-4">
              <_FilterTabs />
              <_PeriodSelector />
            </div>
          </div>

          <div ref={contentRef}>
            {/* Closings List */}
            <Show
              when={hasLoadedClosingsOnce() || Boolean(closings.error)}
              fallback={
                <div class="py-6">
                  <LoadingState label="Loading closings..." />
                </div>
              }
            >
              <Show
                when={!closings.error}
                fallback={
                  <div class="rounded-lg border border-red-200 bg-red-50 p-4 shadow-sm">
                    <p class="text-base text-red-600">
                      {getErrorMessage(closings.error)}
                    </p>
                  </div>
                }
              >
                <Show
                  when={!closings.loading}
                  fallback={
                    <div class="py-6">
                      <LoadingState
                        label={
                          hasLoadedClosingsOnce()
                            ? "Refreshing closings..."
                            : "Loading closings..."
                        }
                      />
                    </div>
                  }
                >
                  <Show when={invalidFrequencyRowCount() > 0}>
                    <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
                      Excluded {invalidFrequencyRowCount()} premium row
                      {invalidFrequencyRowCount() === 1 ? "" : "s"} with missing
                      or invalid frequency from AFYP totals.
                    </div>
                  </Show>

                  <_ClosingsList
                    closings={filteredClosings}
                    stickyTopOffset={stickyControlsHeight()}
                    riderAttachedSuffixByProductId={riderAttachedSuffixByProductId()}
                  />

                  <_ShareButton
                    closings={filteredClosings}
                    riderAttachedSuffixByProductId={riderAttachedSuffixByProductId()}
                  />
                </Show>

              </Show>
            </Show>
          </div>
        </div>
      </PageBody>

      {/* Sticky Bottom Bar */}
      <div class="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 p-4 backdrop-blur-sm">
        <div class="mx-auto max-w-7xl">
          <Button
            type="button"
            onClick={() => navigate("/closings/submit")}
            class="w-full"
          >
            <TbOutlineFilePlus class="h-4 w-4" />
            SUBMIT CLOSING
          </Button>
        </div>
      </div>

      <BackToTopFab bottomClass="bottom-22" />

      {/* Bottom spacer for sticky bar */}
      <div class="h-20" />
    </PageShell>
  );
};

/*******************************
 *
 * BEGIN all subcomponents below
 *
 *******************************/

const _FilterTabs: Component = () => {
  const [indicatorStyle, setIndicatorStyle] = createSignal({
    left: 0,
    width: 0,
  });
  let tabsRef: HTMLDivElement | undefined;
  let allRef: HTMLButtonElement | undefined;
  let teamRef: HTMLButtonElement | undefined;
  let mineRef: HTMLButtonElement | undefined;

  const updateIndicator = () => {
    if (!tabsRef) return;
    const active =
      filterMode() === "all"
        ? allRef
        : filterMode() === "team"
          ? teamRef
          : mineRef;
    if (!active) return;
    const activeLabel =
      active.querySelector<HTMLElement>("[data-filter-tab-label]");
    const parentRect = tabsRef.getBoundingClientRect();
    const activeRect = (activeLabel || active).getBoundingClientRect();
    setIndicatorStyle({
      left: activeRect.left - parentRect.left,
      width: activeRect.width,
    });
  };

  createEffect(() => {
    filterMode();
    canViewTeamClosings();
    teamFscCodes().size;
    requestAnimationFrame(updateIndicator);
  });

  onMount(() => {
    requestAnimationFrame(updateIndicator);
    window.addEventListener("resize", updateIndicator);
  });

  onCleanup(() => {
    window.removeEventListener("resize", updateIndicator);
  });

  return (
    <div ref={tabsRef} class="relative flex border-b border-primary-100">
      <button
        ref={allRef}
        type="button"
        class={`relative flex flex-1 items-center justify-center gap-2 pb-3 text-lg font-condensed font-semibold transition ${
          filterMode() === "all"
            ? "text-primary"
            : "text-gray-500 font-light hover:text-gray-700 cursor-pointer"
        }`}
        onClick={() => setFilterMode("all")}
      >
        <span data-filter-tab-label>All Closings</span>
      </button>
      <Show when={canViewTeamClosings() && teamFscCodes().size > 0}>
        <button
          ref={teamRef}
          type="button"
          class={`relative flex flex-1 items-center justify-center gap-2 pb-3 text-lg font-condensed font-semibold transition ${
            filterMode() === "team"
              ? "text-primary"
              : "text-gray-500 font-light hover:text-gray-700 cursor-pointer"
          }`}
          onClick={() => setFilterMode("team")}
        >
          <span data-filter-tab-label>Team Closings</span>
        </button>
      </Show>
      <button
        ref={mineRef}
        type="button"
        class={`relative flex flex-1 items-center justify-center gap-2 pb-3 text-lg font-condensed font-semibold transition ${
          filterMode() === "mine"
            ? "text-primary"
            : "text-gray-500 font-light hover:text-gray-700 cursor-pointer"
        }`}
        onClick={() => setFilterMode("mine")}
      >
        <span data-filter-tab-label>My Closings</span>
      </button>
      <span
        class="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-primary transition-all duration-250 ease-out"
        style={{
          left: `${indicatorStyle().left}px`,
          width: `${indicatorStyle().width}px`,
        }}
      />
    </div>
  );
};

const _PeriodSelector: Component = () => {
  const monthOptions = generateMonthOptions();

  return (
    <div class="flex items-center justify-center gap-3">
      <label class="text-base font-semibold text-gray-700 whitespace-nowrap">
        Period:
      </label>
      <select
        value={selectedPeriod()}
        onChange={(e) => setSelectedPeriod(e.currentTarget.value)}
        class="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-800 shadow-inner focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
      >
        <For each={monthOptions}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
    </div>
  );
};

const _ClosingsList: Component<{
  closings: any;
  stickyTopOffset?: number;
  riderAttachedSuffixByProductId?: Record<string, string>;
}> = (
  props,
) => {
  const navigate = useNavigate();
  const [expandedDate, setExpandedDate] = createSignal<string | null>(null);
  let pendingScrollTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingOpenTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAlignTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPendingTimers = () => {
    if (pendingScrollTimer) clearTimeout(pendingScrollTimer);
    if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
    if (pendingAlignTimer) clearTimeout(pendingAlignTimer);
    pendingScrollTimer = undefined;
    pendingOpenTimer = undefined;
    pendingAlignTimer = undefined;
  };

  const getDateSectionId = (dateKey: string) =>
    `closings-date-${dateKey.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const scrollDateHeaderIntoView = (dateKey: string) => {
    const section = document.getElementById(getDateSectionId(dateKey));
    if (!section) return;
    const stickyOffset = props.stickyTopOffset ?? 0;
    const targetTop =
      section.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    const destination = Math.max(0, targetTop - stickyOffset);
    window.scrollTo({ top: destination, behavior: "smooth" });
  };

  const alignAfterExpand = (dateKey: string) => {
    pendingAlignTimer = setTimeout(() => {
      scrollDateHeaderIntoView(dateKey);
    }, 320);
  };

  const openDateAndAlign = (dateKey: string) => {
    setExpandedDate(dateKey);
    alignAfterExpand(dateKey);
  };

  // Auto-expand today's date when viewing "today"
  createEffect(() => {
    if (selectedPeriod() === "today") {
      const todayKey = new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      setExpandedDate(todayKey);
    } else {
      setExpandedDate(null);
    }
  });

  // Group closings by date
  const closingsByDate = createMemo(() => {
    const grouped = new Map<string, Closing[]>();

    (props.closings() ?? []).forEach((closing: Closing) => {
      const date = new Date(closing.timestamp);
      const dateKey = date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)!.push(closing);
    });

    // Convert to array and sort by date descending
    return Array.from(grouped.entries()).sort((a, b) => {
      const dateA = new Date(a[1][0].timestamp).getTime();
      const dateB = new Date(b[1][0].timestamp).getTime();
      return dateB - dateA;
    });
  });

  const toggleDate = (dateKey: string) => {
    clearPendingTimers();
    const current = expandedDate();
    if (current === dateKey) {
      setExpandedDate(null);
      return;
    }

    if (!current) {
      scrollDateHeaderIntoView(dateKey);
      openDateAndAlign(dateKey);
      return;
    }

    setExpandedDate(null);
    pendingScrollTimer = setTimeout(() => {
      scrollDateHeaderIntoView(dateKey);
      pendingOpenTimer = setTimeout(() => openDateAndAlign(dateKey), 220);
    }, 280);
  };

  onCleanup(() => clearPendingTimers());

  return (
    <Show
      when={(props.closings() ?? []).length > 0}
      fallback={
        <div class="rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p class="text-base text-gray-600">
            {filterMode() === "mine"
              ? `You have no closings for ${getSelectedPeriodLabel()}.`
              : filterMode() === "team"
                ? `Your team has no closings for ${getSelectedPeriodLabel()}.`
              : `No closings for ${getSelectedPeriodLabel()}.`}
          </p>
        </div>
      }
    >
      <ul
        class="space-y-4"
        style={{
          "--closings-date-sticky-top": `${Math.max(0, (props.stickyTopOffset ?? 0) - 1)}px`,
        }}
      >
        <For each={closingsByDate()}>
          {([dateKey, closingsForDate]) => {
            return (
              <li id={getDateSectionId(dateKey)}>
                <AccordionCard
                  stickyClass="sticky top-[var(--closings-date-sticky-top)] z-20"
                  open={expandedDate() === dateKey}
                  onToggle={() => toggleDate(dateKey)}
                  header={
                    <div class="flex items-center gap-2">
                      <TbOutlineCalendar class="h-4 w-4 text-primary" />
                      <div class="flex-1 text-base font-bold text-gray-900">
                        {dateKey}
                      </div>
                      <div class="text-sm font-semibold text-gray-500">
                        {closingsForDate.length} closing
                        {closingsForDate.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  }
                >
                  <div class="divide-y divide-gray-100">
                    <For each={closingsForDate}>
                      {(closing) => {
                        const closingTime = new Date(
                          closing.timestamp,
                        ).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        });
                        const isOwnClosing = () => {
                          const currentFscCode = userFscCode();
                          return (
                            !!currentFscCode &&
                            (closing.fscCode === currentFscCode ||
                              closing.sharedFscCode === currentFscCode)
                          );
                        };

                        return (
                          <div class="px-4 py-3">
                            <ClosingDisplayBlock
                              model={toClosingDisplayModel(
                                closing,
                                closingTime,
                                props.riderAttachedSuffixByProductId || {},
                              )}
                              rightAction={
                                <Show when={isOwnClosing() || isAdmin()}>
                                  <IconButton
                                    variant={isOwnClosing() ? "primary" : "admin"}
                                    onClick={() =>
                                      navigate(
                                        `/closings/submit?edit=${closing.id}`,
                                      )
                                    }
                                    size="sm"
                                  >
                                    <TbOutlinePencil />
                                  </IconButton>
                                </Show>
                              }
                            />
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </AccordionCard>
              </li>
            );
          }}
        </For>
      </ul>
    </Show>
  );
};

const _ShareButton: Component<{
  closings: any;
  riderAttachedSuffixByProductId?: Record<string, string>;
}> = (props) => {
  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // Fallback below
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  const handleShare = async () => {
    // Compute date string based on selected period
    let dateStr: string;
    const period = selectedPeriod();

    if (period === "today") {
      const today = new Date();
      dateStr = today.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } else {
      const [year, month] = period.split("-").map(Number);
      const date = new Date(year, month - 1, 1);
      dateStr = date.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      });
    }

    const message = formatClosingsForWhatsApp(
      props.closings() ?? [],
      dateStr,
      props.riderAttachedSuffixByProductId || {},
    );
    await copyToClipboard(message);
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  return (
    <Show
      when={
        selectedPeriod() === "today" &&
        filterMode() === "all" &&
        (props.closings() ?? []).length > 0
      }
    >
      <div class="flex justify-center pt-2">
        <Button type="button" variant="primaryOutline" onClick={handleShare} class="w-fit">
          <TbOutlineShare2 class="h-4 w-4" />
          Copy & Share to WhatsApp
        </Button>
      </div>
    </Show>
  );
};

export default Closings;
