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
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { TbOutlinePencil, TbOutlineTrash, TbOutlinePlus } from "solid-icons/tb";
import {
  PageShell,
  PageHeader,
  PageBody,
  Button,
  EditModal,
  LoadingState,
  IconButton,
  ReorderList,
  createConfirm,
} from "../../../components/ui";

import {
  DEFAULT_REPORT_LOGO_PATH,
  reportsService,
  type ReportLogoAsset,
  type ReportTemplate,
  type ReportTableLayout,
} from "../../../services/reportsService";
import {
  type Source,
  sourcesService,
} from "../../../services/sourcesService";
import { productsService } from "../../../services/productsService";
import { teamService, type TeamAgency } from "../../../services/teamService";
import { adminOptionForPath } from "../adminOptions";
import type { RenderTable, ReportRow } from "./reportExport";

const defaultTableFieldValues: Partial<ReportTableLayout> = {
  titleLines: ["TOP ADVISER", "(TOTAL FYC)", "Minimum: $8,000"],
  valueLabel: "FYC ($)",
  minValue: 8000,
  metric: { type: "fyc" },
  highlightMin: true,
  includeAllAgencies: true,
  includeAllAdvisors: true,
  rookieFilter: "all",
  showIndex: false,
};
const defaultRookieTableValues: Partial<ReportTableLayout> = {
  titleLines: ["TOP ROOKIE", "Minimum: $5,000"],
  valueLabel: "FYC ($)",
  minValue: 5000,
  metric: { type: "fyc" },
  highlightMin: true,
  includeAllAgencies: true,
  includeAllAdvisors: false,
  rookieFilter: "rookies",
  rookieYears: 2,
  showIndex: false,
  excludeProductKeywords: "singlife",
  footnote: "* Rookie refers to FSCs contracted from 1 Jan {YYYY} onwards.",
};
const defaultTitleLinesPlaceholder = (
  defaultTableFieldValues?.titleLines || []
).join("\n");
const defaultTitleLinesPlaceholderText = defaultTitleLinesPlaceholder
  ? `e.g. ${defaultTitleLinesPlaceholder}`
  : "";
const defaultValueLabelPlaceholder = defaultTableFieldValues?.valueLabel
  ? `e.g. ${defaultTableFieldValues.valueLabel}`
  : "";
const defaultMinValuePlaceholder =
  defaultTableFieldValues?.minValue != null
    ? `e.g. ${String(defaultTableFieldValues.minValue)}`
    : "";
const previewNames = ["Ahmad Rahman", "Nur Aisyah", "Siti Hajar"];

const parseTitleLinesInput = (value: string): string[] => value.split("\n");

const normalizeTitleLines = (titleLines: string[] | undefined): string[] =>
  (titleLines || []).map((line) => line.trim());

const formatPreviewDate = (value: Date): string =>
  value.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const previewValueForMetric = (
  type: ReportTableLayout["metric"]["type"],
  index: number,
): number => {
  const currencyValues = [24567.89, 18234.56, 12987.43];
  const numericValues = [14, 11, 8];

  if (["fyc", "afyc", "fyp", "afyp"].includes(type)) {
    return currencyValues[index] ?? currencyValues[currencyValues.length - 1]!;
  }

  return numericValues[index] ?? numericValues[numericValues.length - 1]!;
};

const buildPreviewRows = (table: ReportTableLayout): ReportRow[] => {
  const rowCount =
    table.rookieFilter === "rookies" && table.includeAllAdvisors === false
      ? 1
      : 3;

  return Array.from({ length: rowCount }, (_, index) => ({
    key: previewNames[index] ?? `preview-${index + 1}`,
    name: previewNames[index] ?? `Preview ${index + 1}`,
    value: previewValueForMetric(table.metric?.type || "countClosings", index),
  }));
};

const describeAgency = (agency: Pick<TeamAgency, "code" | "name">) => {
  const code = (agency.code || "").trim();
  const name = (agency.name || "").trim();
  return name ? `${name} (${code})` : code;
};

const resolveTableAgencies = (
  table: ReportTableLayout,
  agencies: TeamAgency[],
): TeamAgency[] => {
  const selectedCodes =
    table.includeAllAgencies
      ? agencies.map((agency) => agency.code)
      : table.includeAllNonLegacyAgencies
        ? agencies
            .filter((agency) => agency.isDeleted !== true && agency.isActive !== false)
            .map((agency) => agency.code)
        : !table.agencyCodes || table.agencyCodes.length === 0
          ? agencies.map((agency) => agency.code)
      : table.agencyCodes;
  const byCode = new Map(
    agencies
      .map((agency) => [(agency.code || "").trim(), agency] as const)
      .filter(([code]) => code !== ""),
  );
  const seen = new Set<string>();

  return selectedCodes
    .map((rawCode) => {
      const code = String(rawCode || "").trim();
      if (!code || seen.has(code)) return null;
      seen.add(code);
      return byCode.get(code) || { code, name: "" };
    })
    .filter((agency): agency is TeamAgency => agency !== null);
};

const applyAgencyBreakdownToTable = (
  table: ReportTableLayout,
  agency: TeamAgency,
  index: number,
  singleTable: boolean,
): ReportTableLayout => {
  const agencyLabel = describeAgency(agency);
  const id = table.id * 1000 + index + 1;

  if (singleTable) {
    return {
      ...table,
      id,
      agencyGroupLabel: agencyLabel,
      includeAllAgencies: false,
      agencyCodes: [agency.code],
      agencyBreakdown: false,
    };
  }

  return {
    ...table,
    id,
    agencyGroupLabel: agencyLabel,
    includeAllAgencies: false,
    agencyCodes: [agency.code],
    agencyBreakdown: false,
  };
};

const getLayoutMode = (report: Pick<ReportTemplate, "layoutMode" | "singleTable">) =>
  report.layoutMode || (report.singleTable ? "combinedFsc" : "separateLeaderboards");

const isCombinedLayout = (report: Pick<ReportTemplate, "layoutMode" | "singleTable">) =>
  getLayoutMode(report) === "combinedFsc";

const isAgencySummaryLayout = (report: Pick<ReportTemplate, "layoutMode" | "singleTable">) =>
  getLayoutMode(report) === "agencySummary";

const reportItemLabel = (report: Pick<ReportTemplate, "layoutMode" | "singleTable">) =>
  isAgencySummaryLayout(report)
    ? "Agency Summary Tables"
    : isCombinedLayout(report)
      ? "Metric Columns"
      : "Leaderboards";

const reportItemSingularLabel = (report: Pick<ReportTemplate, "layoutMode" | "singleTable">) =>
  isAgencySummaryLayout(report)
    ? "Agency Summary Table"
    : isCombinedLayout(report)
      ? "Metric Column"
      : "Leaderboard";

const buildPreviewTables = (
  report: ReportTemplate,
  agencies: TeamAgency[] = [],
): RenderTable[] => {
  if ((report.tables || []).length === 0) {
    return [];
  }

  if (isAgencySummaryLayout(report)) {
    const selectedAgencies =
      resolveTableAgencies(report.tables[0]!, agencies).length > 0
        ? resolveTableAgencies(report.tables[0]!, agencies)
        : agencies;
    const fallbackAgencies = selectedAgencies.length > 0
      ? selectedAgencies
      : [
          { code: "AG01", name: "Agency 01" },
          { code: "AG02", name: "Agency 02" },
          { code: "AG03", name: "Agency 03" },
        ];
    return report.tables.map((table) => ({
      ...table,
      rows: fallbackAgencies
        .map((agency, index) => ({
          key: agency.code,
          name: describeAgency(agency),
          value: previewValueForMetric(table.metric?.type || "countClosings", index),
        }))
        .sort((left, right) =>
          right.value !== left.value
            ? right.value - left.value
            : left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
        ),
    }));
  }

  const agencyBreakdownSource = report.agencyBreakdown
    ? report.tables[0]
    : report.tables.find(
    (table) => table.agencyBreakdown === true,
  );
  const layoutTables = agencyBreakdownSource
    ? resolveTableAgencies(agencyBreakdownSource, agencies).flatMap(
        (agency, agencyIndex) =>
          report.tables.map((table, tableIndex) =>
            applyAgencyBreakdownToTable(
              table,
              agency,
              agencyIndex * Math.max(1, report.tables.length) + tableIndex,
              isCombinedLayout(report),
            ),
          ),
      )
    : report.tables.flatMap((table) => {
    if (!table.agencyBreakdown) {
      return [table];
    }
    const tableAgencies = resolveTableAgencies(table, agencies);
    if (tableAgencies.length === 0) {
      return [table];
    }
    return tableAgencies.map((agency, index) =>
      applyAgencyBreakdownToTable(
        table,
        agency,
        index,
        isCombinedLayout(report),
      ),
    );
  });

  let tables: RenderTable[] = layoutTables.map((table) => ({
    ...table,
    rows: buildPreviewRows(table),
  }));
  const maxRows = Math.max(1, ...tables.map((table) => table.rows.length));

  if (report.includeIndexTable && !isCombinedLayout(report)) {
    const indexRows = Array.from({ length: maxRows }, () => ({
      name: "",
      value: 0,
    }));
    tables = [
      {
        id: "index-only",
        titleLines: ["", "", ""],
        valueLabel: "No",
        valueFormat: "count",
        rows: indexRows,
        showIndex: true,
        indexOnly: true,
        minValue: 0,
        highlightMin: false,
        metric: { type: "countClosings" },
      },
      ...tables,
    ];
  }

  return tables;
};

const revokeObjectUrl = (src: string | null | undefined) => {
  if (
    !src ||
    typeof URL === "undefined" ||
    typeof URL.revokeObjectURL !== "function" ||
    !src.startsWith("blob:")
  ) {
    return;
  }

  URL.revokeObjectURL(src);
};

const releaseReportLogoAsset = (asset: ReportLogoAsset | null | undefined) => {
  revokeObjectUrl(asset?.src);
};

const ManageReports: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const adminOption = createMemo(() => adminOptionForPath(location.pathname)!);
  const [hasAccess, setHasAccess] = createSignal(false);
  const [accessLoading, setAccessLoading] = createSignal(true);
  const [reportsData] = createResource(() => reportsService.getReports());
  const [teamData] = createResource(() =>
    teamService.getTeamData({ includeDeletedAgencies: true }),
  );
  const [sourceOptionsData] = createResource(() =>
    sourcesService.getSources({ includeDeletedItems: true }),
  );
  const [productCatalogData] = createResource(() =>
    productsService.getProducts(),
  );
  const [reportTemplates, setReportTemplates] = createSignal<ReportTemplate[]>(
    [],
  );
  const [showDesigner, setShowDesigner] = createSignal(false);
  const [draftReport, setDraftReport] = createSignal<ReportTemplate | null>(
    null,
  );
  const [initialDraftSnapshot, setInitialDraftSnapshot] = createSignal("");
  const [draftTable, setDraftTable] = createSignal<ReportTableLayout | null>(
    null,
  );
  const [initialDraftTableSnapshot, setInitialDraftTableSnapshot] =
    createSignal("");
  const [editingTableId, setEditingTableId] = createSignal<number | null>(null);
  const [deleteCandidate, setDeleteCandidate] =
    createSignal<ReportTemplate | null>(null);
  const [previewTarget, setPreviewTarget] = createSignal<ReportTemplate | null>(
    null,
  );
  const [showSourcePicker, setShowSourcePicker] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [uploadingLogo, setUploadingLogo] = createSignal(false);
  const [SaveSuccessModal, showSaveSuccess] = createConfirm({
    title: "Saved",
    message: "Report template saved successfully.",
    confirmLabel: "OK",
    variant: "admin",
    hideCancel: true,
  });
  const [SaveErrorModal, showSaveError] = createConfirm({
    title: "Save failed",
    message: "Unable to save report templates. Please try again.",
    confirmLabel: "OK",
    variant: "danger",
    hideCancel: true,
  });
  const resolveActionErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error) {
      const message = error.message.trim();
      if (message) return message;
    }

    if (typeof error === "string") {
      const message = error.trim();
      if (message) return message;
    }

    return fallback;
  };
  const [reportLogoAsset, { refetch: refetchReportLogoAsset }] = createResource(
    async () => reportsService.getReportLogoAsset(),
  );
  let reportLogoInputRef: HTMLInputElement | undefined;
  let currentLogoPreviewUrl: string | null = null;
  const [previewImage] = createResource(previewTarget, async (report) => {
    if (!report || (report.tables || []).length === 0) {
      return null;
    }

    if (
      typeof document !== "undefined" &&
      "fonts" in document &&
      document.fonts?.ready
    ) {
      try {
        await document.fonts.ready;
      } catch {
        // Ignore font loading issues and render with available fonts.
      }
    }

    const { buildReportCanvas, loadImage } = await import("./reportExport");
    const logoAsset = await reportsService.getReportLogoAsset();
    let logo = null;
    try {
      logo = await loadImage(logoAsset.src);
    } finally {
      releaseReportLogoAsset(logoAsset);
    }
    const reportDate = new Date();
    const tables = buildPreviewTables(report, agencyOptions());
    if (tables.length === 0) {
      return null;
    }

    const maxRows = Math.max(1, ...tables.map((table) => table.rows.length));
    const startOfMonth = new Date(
      reportDate.getFullYear(),
      reportDate.getMonth(),
      1,
    );
    const result = buildReportCanvas({
      report,
      reportDate,
      tables,
      maxRows,
      reportRangeLabel: `${formatPreviewDate(startOfMonth)} - ${formatPreviewDate(reportDate)}`,
      logo,
      pixelScale: 2,
    });

    if (!result) {
      return null;
    }

    return {
      dataUrl: result.canvas.toDataURL("image/png"),
      width: result.width,
      height: result.height,
    };
  });

  createEffect(() => {
    const asset = reportLogoAsset();
    const nextUrl = asset?.src?.startsWith("blob:") ? asset.src : null;
    if (currentLogoPreviewUrl && currentLogoPreviewUrl !== nextUrl) {
      revokeObjectUrl(currentLogoPreviewUrl);
    }
    currentLogoPreviewUrl = nextUrl;
  });

  onCleanup(() => {
    if (currentLogoPreviewUrl) {
      revokeObjectUrl(currentLogoPreviewUrl);
      currentLogoPreviewUrl = null;
    }
  });

  onMount(() => {
    teamService
      .getCurrentUserAccessLevel()
      .then((result) => {
        const access = result.accessLevel.toLowerCase();
        setHasAccess(result.isAdmin || access === "admin");
      })
      .finally(() => {
        setAccessLoading(false);
      });
  });

  createEffect(() => {
    setReportTemplates(reportsData() || []);
  });

  const agencyOptions = createMemo(() => teamData()?.agencies || []);
  const sourceOptions = createMemo(() => {
    const options = sourceOptionsData();
    return options || [];
  });
  const sourceItemIdToSourceId = createMemo(() => {
    const map = new Map<string, string>();
    sourceOptions().forEach((source) => {
      source.children.forEach((child) => {
        map.set(child.id, source.id);
      });
    });
    return map;
  });
  const productTypeOptions = createMemo(() => {
    const catalogTypes = Object.entries(productCatalogData()?.types || {})
      .map(([key, label]) => ({
        key: String(key || "").trim(),
        label: String(label || "").trim(),
        isLegacy: false,
      }))
      .filter((option) => option.key && option.label);

    const knownKeys = new Set(catalogTypes.map((option) => option.key));
    const legacyTypes = (draftTable()?.productTypeKeys || [])
      .map((key) => String(key || "").trim())
      .filter((key) => key && !knownKeys.has(key))
      .map((key) => ({
        key,
        label: key,
        isLegacy: true,
      }));

    return [...catalogTypes, ...legacyTypes];
  });
  const reportLogoPreviewSrc = createMemo(
    () => reportLogoAsset()?.src || DEFAULT_REPORT_LOGO_PATH,
  );
  const hasCustomReportLogo = createMemo(
    () => reportLogoAsset()?.isCustom === true,
  );
  const getNextReportTemplateId = () => {
    const ids = reportTemplates().map((report) => report.id);
    return ids.length > 0 ? Math.max(...ids) + 1 : 1;
  };
  const getNextReportTableId = () => {
    const ids = new Set<number>();

    reportTemplates().forEach((report) => {
      report.tables.forEach((table) => {
        ids.add(table.id);
      });
    });

    const draft = draftReport();
    if (draft) {
      draft.tables.forEach((table) => {
        ids.add(table.id);
      });
    }

    return ids.size > 0 ? Math.max(...ids) + 1 : 1;
  };
  const createDefaultRookieTable = (): ReportTableLayout => {
    const source = defaultRookieTableValues;
    if (!source) {
      return createNewTableDraft();
    }

    return JSON.parse(
      JSON.stringify({
        ...source,
        id: getNextReportTableId(),
        sources: source.sources || [],
        sourceItemIds: source.sourceItemIds || [],
        productTypeKeys: source.productTypeKeys || [],
    includeProductKeywords: source.includeProductKeywords || "",
    excludeProductKeywords: source.excludeProductKeywords || "",
    agencyBreakdown: source.agencyBreakdown === true,
  }),
    ) as ReportTableLayout;
  };

  const addReport = () => {
    const newReport: ReportTemplate = {
      id: getNextReportTemplateId(),
      title: "New Report",
      filenameTemplate: "{YYYYMMDD}_Report",
      tableGap: 12,
      tableWidth: 180,
      indexTableWidth: 46,
      primaryColumnHeader: "Name",
      primaryColumnWidth: 120,
      includeIndexTable: true,
      layoutMode: "separateLeaderboards",
      singleTable: false,
      agencyBreakdown: false,
      agencyTableGap: 30,
      bottomFootnote: "",
      tables: [createDefaultRookieTable()],
    };
    setDraftReport(newReport);
    setInitialDraftSnapshot(JSON.stringify(newReport));
    setDraftTable(null);
    setInitialDraftTableSnapshot("");
    setEditingTableId(null);
    setShowDesigner(true);
  };

  const openEditReport = (report: ReportTemplate) => {
    const draft = JSON.parse(JSON.stringify(report)) as ReportTemplate;
    setDraftReport(draft);
    setInitialDraftSnapshot(JSON.stringify(draft));
    setDraftTable(null);
    setInitialDraftTableSnapshot("");
    setEditingTableId(null);
    setShowDesigner(true);
  };

  const closeDesigner = () => {
    setShowSourcePicker(false);
    setDraftTable(null);
    setInitialDraftTableSnapshot("");
    setEditingTableId(null);
    setDraftReport(null);
    setShowDesigner(false);
    setInitialDraftSnapshot("");
  };

  const isDraftDirty = createMemo(() => {
    const draft = draftReport();
    if (!draft) return false;
    return initialDraftSnapshot() !== JSON.stringify(draft);
  });

  const isEditingDraft = createMemo(() => {
    const draft = draftReport();
    if (!draft) return false;
    return reportTemplates().some((item) => item.id === draft.id);
  });

  const isEditingTable = createMemo(() => editingTableId() !== null);

  const isTableDraftDirty = createMemo(() => {
    const table = draftTable();
    if (!table) return false;
    return initialDraftTableSnapshot() !== JSON.stringify(table);
  });

  const createNewTableDraft = (): ReportTableLayout => ({
    id: getNextReportTableId(),
    titleLines: [],
    valueLabel: "",
    footnote: "",
    sources: [],
    sourceItemIds: [],
    productTypeKeys: [],
    includeProductKeywords: "",
    excludeProductKeywords: "",
    includeFooterTotalRow: false,
    metric: { type: defaultTableFieldValues?.metric?.type || "countClosings" },
    highlightMin: defaultTableFieldValues?.highlightMin ?? false,
    includeAllAgencies: defaultTableFieldValues?.includeAllAgencies ?? true,
    includeAllAdvisors: defaultTableFieldValues?.includeAllAdvisors ?? true,
    rookieFilter: defaultTableFieldValues?.rookieFilter ?? "all",
    rookieYears: 2,
    showIndex: defaultTableFieldValues?.showIndex ?? false,
  });

  const openAddTableEditor = () => {
    const nextTable = createNewTableDraft();
    setDraftTable(nextTable);
    setInitialDraftTableSnapshot(JSON.stringify(nextTable));
    setEditingTableId(null);
  };

  const openEditTableEditor = (table: ReportTableLayout) => {
    const nextTable = JSON.parse(JSON.stringify(table)) as ReportTableLayout;
    setDraftTable(nextTable);
    setInitialDraftTableSnapshot(JSON.stringify(nextTable));
    setEditingTableId(table.id);
  };

  const closeTableEditor = () => {
    setShowSourcePicker(false);
    setDraftTable(null);
    setInitialDraftTableSnapshot("");
    setEditingTableId(null);
  };

  const removeTable = (reportId: number, tableId: number) => {
    setDraftReport((prev) => {
      if (!prev || prev.id !== reportId) return prev;
      return {
        ...prev,
        tables: prev.tables.filter((table) => table.id !== tableId),
      };
    });
  };

  const moveTable = (reportId: number, fromIndex: number, toIndex: number) => {
    setDraftReport((prev) => {
      if (!prev || prev.id !== reportId) return prev;
      const tables = [...prev.tables];
      const [moved] = tables.splice(fromIndex, 1);
      tables.splice(toIndex, 0, moved);
      return { ...prev, tables };
    });
  };

  const updateDraftReport = (patch: Partial<ReportTemplate>) => {
    setDraftReport((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (patch.layoutMode) {
        next.singleTable =
          patch.layoutMode === "combinedFsc";
        if (patch.layoutMode === "agencySummary") {
          next.includeIndexTable = false;
          next.agencyBreakdown = false;
        }
      }
      return next;
    });
  };

  const updateTableDraft = (patch: Partial<ReportTableLayout>) => {
    setDraftTable((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const areAllAgenciesSelected = (table: ReportTableLayout) => {
    if (table.includeAllAgencies ?? true) return true;
    const options = agencyOptions();
    if (options.length === 0) return false;
    const selected = new Set(table.agencyCodes || []);
    return options.every((agency) => selected.has(agency.code));
  };

  const areAllNonLegacyAgenciesSelected = (table: ReportTableLayout) =>
    table.includeAllNonLegacyAgencies === true;

  const isLegacyAgency = (agency: TeamAgency) =>
    agency.isDeleted === true || agency.isActive === false;

  const getSelectedAgencyCodes = (table: ReportTableLayout) => {
    if (table.includeAllAgencies ?? true) {
      return agencyOptions().map((agency) => agency.code);
    }
    if (table.includeAllNonLegacyAgencies === true) {
      return agencyOptions()
        .filter((agency) => !isLegacyAgency(agency))
        .map((agency) => agency.code);
    }

    return table.agencyCodes || [];
  };

  const setAllAgenciesSelected = (checked: boolean) => {
    updateTableDraft({
      includeAllAgencies: checked,
      includeAllNonLegacyAgencies: false,
      agencyCodes: [],
    });
  };

  const setAllNonLegacyAgenciesSelected = (checked: boolean) => {
    updateTableDraft({
      includeAllAgencies: false,
      includeAllNonLegacyAgencies: checked,
      agencyCodes: [],
    });
  };

  const setAgencySelected = (
    table: ReportTableLayout,
    agencyCode: string,
    checked: boolean,
  ) => {
    const next = new Set(getSelectedAgencyCodes(table));
    if (checked) {
      next.add(agencyCode);
    } else {
      next.delete(agencyCode);
    }

    const options = agencyOptions();
    const allSelected =
      options.length > 0 && options.every((agency) => next.has(agency.code));

    if (allSelected) {
      setAllAgenciesSelected(true);
      return;
    }

    updateTableDraft({
      includeAllAgencies: false,
      includeAllNonLegacyAgencies: false,
      agencyCodes: Array.from(next),
    });
  };

  const hasAnyAgencySelected = (table: ReportTableLayout) =>
    areAllAgenciesSelected(table) ||
    areAllNonLegacyAgenciesSelected(table) ||
    (table.agencyCodes || []).length > 0;

  const isAllSourcesSelected = (table: ReportTableLayout) =>
    (table.sources || []).length === 0 &&
    (table.sourceItemIds || []).length === 0;

  const normalizeSourceSelection = (
    sourceIds: Set<string>,
    sourceItemIds: Set<string>,
  ) => {
    const explicitItems = Array.from(sourceItemIds).filter((itemId) => {
      const parentSourceId = sourceItemIdToSourceId().get(itemId);
      return parentSourceId ? !sourceIds.has(parentSourceId) : false;
    });
    const allSelected =
      sourceOptions().length > 0 &&
      sourceOptions().every((source) => sourceIds.has(source.id)) &&
      explicitItems.length === 0;

    if (allSelected || (sourceIds.size === 0 && explicitItems.length === 0)) {
      return {
        sources: [] as string[],
        sourceItemIds: [] as string[],
      };
    }

    return {
      sources: Array.from(sourceIds),
      sourceItemIds: explicitItems,
    };
  };

  const getEffectiveSourceSelection = (table: ReportTableLayout) => {
    if (isAllSourcesSelected(table)) {
      return {
        sourceIds: new Set(sourceOptions().map((source) => source.id)),
        sourceItemIds: new Set<string>(),
      };
    }

    return {
      sourceIds: new Set(table.sources || []),
      sourceItemIds: new Set(table.sourceItemIds || []),
    };
  };

  const isSourceFullySelected = (table: ReportTableLayout, source: Source) =>
    isAllSourcesSelected(table) || (table.sources || []).includes(source.id);

  const isSourceItemSelected = (
    table: ReportTableLayout,
    source: Source,
    sourceItemId: string,
  ) =>
    isSourceFullySelected(table, source) ||
    (table.sourceItemIds || []).includes(sourceItemId);

  const setSourceFullySelected = (
    table: ReportTableLayout,
    source: Source,
    checked: boolean,
  ) => {
    const selection = getEffectiveSourceSelection(table);
    if (checked) {
      selection.sourceIds.add(source.id);
      source.children.forEach((child) => {
        selection.sourceItemIds.delete(child.id);
      });
    } else {
      selection.sourceIds.delete(source.id);
      source.children.forEach((child) => {
        selection.sourceItemIds.delete(child.id);
      });
    }

    updateTableDraft(
      normalizeSourceSelection(selection.sourceIds, selection.sourceItemIds),
    );
  };

  const setSourceItemSelected = (
    table: ReportTableLayout,
    source: Source,
    sourceItemId: string,
    checked: boolean,
  ) => {
    const selection = getEffectiveSourceSelection(table);
    const childIds = source.children.map((child) => child.id);

    if (selection.sourceIds.has(source.id)) {
      selection.sourceIds.delete(source.id);
      childIds.forEach((childId) => {
        if (childId === sourceItemId) {
          if (checked) {
            selection.sourceItemIds.add(childId);
          } else {
            selection.sourceItemIds.delete(childId);
          }
        } else {
          selection.sourceItemIds.add(childId);
        }
      });
    } else {
      if (checked) {
        selection.sourceItemIds.add(sourceItemId);
      } else {
        selection.sourceItemIds.delete(sourceItemId);
      }

      if (
        childIds.length > 0 &&
        childIds.every((childId) => selection.sourceItemIds.has(childId))
      ) {
        selection.sourceIds.add(source.id);
        childIds.forEach((childId) => {
          selection.sourceItemIds.delete(childId);
        });
      }
    }

    updateTableDraft(
      normalizeSourceSelection(selection.sourceIds, selection.sourceItemIds),
    );
  };

  const describeSourceSelection = (table: ReportTableLayout) => {
    if (isAllSourcesSelected(table)) {
      return "All sources and items";
    }

    const fullSourceCount = (table.sources || []).length;
    const sourceItemCount = (table.sourceItemIds || []).length;
    const parts: string[] = [];

    if (fullSourceCount > 0) {
      parts.push(
        `${fullSourceCount} source${fullSourceCount === 1 ? "" : "s"}`,
      );
    }
    if (sourceItemCount > 0) {
      parts.push(`${sourceItemCount} item${sourceItemCount === 1 ? "" : "s"}`);
    }

    return parts.join(" + ") || "All sources and items";
  };

  const getSelectedProductTypeKeys = (table: ReportTableLayout) => {
    const selected = table.productTypeKeys || [];
    if (selected.length > 0) {
      return selected;
    }

    return productTypeOptions().map((option) => option.key);
  };

  const isProductTypeSelected = (
    table: ReportTableLayout,
    productTypeKey: string,
  ) => getSelectedProductTypeKeys(table).includes(productTypeKey);

  const setProductTypeSelected = (
    table: ReportTableLayout,
    productTypeKey: string,
    checked: boolean,
  ) => {
    const next = new Set(getSelectedProductTypeKeys(table));
    if (checked) {
      next.add(productTypeKey);
    } else {
      next.delete(productTypeKey);
    }

    const options = productTypeOptions();
    const allSelected =
      options.length > 0 && options.every((option) => next.has(option.key));

    updateTableDraft({
      productTypeKeys: allSelected || next.size === 0 ? [] : Array.from(next),
    });
  };

  const getAdvisorSelectionState = (table: ReportTableLayout) => {
    if ((table.includeAllAdvisors ?? true) || table.rookieFilter === "all") {
      return {
        allSelected: true,
        rookies: true,
        nonRookies: true,
      };
    }

    if (table.rookieFilter === "nonRookies") {
      return {
        allSelected: false,
        rookies: false,
        nonRookies: true,
      };
    }

    if (table.rookieFilter === "rookies") {
      return {
        allSelected: false,
        rookies: true,
        nonRookies: false,
      };
    }

    return {
      allSelected: false,
      rookies: false,
      nonRookies: false,
    };
  };

  const hasAnyAdvisorGroupSelected = (table: ReportTableLayout) => {
    const state = getAdvisorSelectionState(table);
    return state.allSelected || state.rookies || state.nonRookies;
  };

  const isRookiesOnlySelected = (table: ReportTableLayout) => {
    const state = getAdvisorSelectionState(table);
    return state.rookies && !state.nonRookies;
  };

  const setAllAdvisorsSelected = (checked: boolean) => {
    updateTableDraft({
      includeAllAdvisors: checked,
      rookieFilter: checked ? "all" : undefined,
    });
  };

  const setAdvisorGroupSelected = (
    table: ReportTableLayout,
    group: "rookies" | "nonRookies",
    checked: boolean,
  ) => {
    const current = getAdvisorSelectionState(table);
    let nextRookies = current.rookies;
    let nextNonRookies = current.nonRookies;

    if (group === "rookies") {
      nextRookies = checked;
    } else {
      nextNonRookies = checked;
    }

    if (nextRookies && nextNonRookies) {
      setAllAdvisorsSelected(true);
      return;
    }

    if (nextRookies) {
      updateTableDraft({
        includeAllAdvisors: false,
        rookieFilter: "rookies",
      });
      return;
    }

    if (nextNonRookies) {
      updateTableDraft({
        includeAllAdvisors: false,
        rookieFilter: "nonRookies",
      });
      return;
    }

    updateTableDraft({
      includeAllAdvisors: false,
      rookieFilter: undefined,
    });
  };

  const tableValidationErrors = createMemo(() => {
    const table = draftTable();
    if (!table) return [] as string[];

    const errors: string[] = [];

    if (!hasAnyAgencySelected(table)) {
      errors.push("Select at least one agency.");
    }

    if (!hasAnyAdvisorGroupSelected(table)) {
      errors.push("Select at least one advisor group.");
    }

    return errors;
  });

  const saveDraftTable = () => {
    const table = draftTable();
    if (!table || tableValidationErrors().length > 0) return;
    const normalizedTable = {
      ...table,
      titleLines: normalizeTitleLines(table.titleLines),
    };

    setDraftReport((prev) => {
      if (!prev) return prev;
      if (!isEditingTable()) {
        return { ...prev, tables: [...prev.tables, normalizedTable] };
      }
      return {
        ...prev,
        tables: prev.tables.map((item) =>
          item.id === editingTableId() ? normalizedTable : item,
        ),
      };
    });
    closeTableEditor();
  };

  const handleSaveReports = async (
    next?: ReportTemplate[],
    errorFeedback?: { title?: string; message?: string },
  ) => {
    let nextState: ReportTemplate[] | null = null;
    let errorState: { title: string; message: string } | null = null;

    setSaving(true);
    try {
      const payload = next ?? reportTemplates();
      const saved = await reportsService.setReports(payload);
      nextState = Array.isArray(saved) ? saved : payload;
      setReportTemplates(nextState);
    } catch (err) {
      console.error("Failed to save reports", err);
      errorState = {
        title: errorFeedback?.title || "Save failed",
        message: resolveActionErrorMessage(
          err,
          errorFeedback?.message ||
            "Unable to save report templates. Please try again.",
        ),
      };
    } finally {
      setSaving(false);
    }

    if (errorState) {
      await showSaveError(errorState);
      return null;
    }

    return nextState;
  };

  const saveDraftReport = async () => {
    const draft = draftReport();
    if (!draft) return;
    const exists = reportTemplates().some((item) => item.id === draft.id);
    const next = exists
      ? reportTemplates().map((item) => (item.id === draft.id ? draft : item))
      : [...reportTemplates(), draft];
    const saved = await handleSaveReports(next);
    if (!saved) return;
    await showSaveSuccess();
    closeDesigner();
  };

  const confirmDeleteReport = async () => {
    const target = deleteCandidate();
    if (!target) return;
    const next = reportTemplates().filter((report) => report.id !== target.id);
    const saved = await handleSaveReports(next, {
      title: "Delete failed",
      message: "Unable to delete the report template. Please try again.",
    });
    if (!saved) return;
    setDeleteCandidate(null);
    await showSaveSuccess({
      title: "Deleted",
      message: "Report template deleted successfully.",
    });
  };

  const openPreview = (report: ReportTemplate) => {
    setPreviewTarget(JSON.parse(JSON.stringify(report)) as ReportTemplate);
  };

  const handleReportLogoSelection = async (
    event: Event & { currentTarget: HTMLInputElement },
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    let errorState: { title: string; message: string } | null = null;
    let successState: { title: string; message: string } | null = null;

    setUploadingLogo(true);
    try {
      await reportsService.uploadReportLogo(file);
      await refetchReportLogoAsset();
      successState = {
        title: "Uploaded",
        message: "Report logo uploaded successfully.",
      };
    } catch (err) {
      console.error("Failed to upload report logo", err);
      errorState = {
        title: "Upload failed",
        message: resolveActionErrorMessage(
          err,
          "Unable to upload the report logo. Please try again.",
        ),
      };
    } finally {
      setUploadingLogo(false);
    }

    if (errorState) {
      await showSaveError(errorState);
      return;
    }

    if (successState) {
      await showSaveSuccess(successState);
    }
  };

  const removeCustomReportLogo = async () => {
    let errorState: { title: string; message: string } | null = null;
    let successState: { title: string; message: string } | null = null;

    setUploadingLogo(true);
    try {
      await reportsService.deleteReportLogo();
      await refetchReportLogoAsset();
      successState = {
        title: "Deleted",
        message: "Report logo deleted successfully.",
      };
    } catch (err) {
      console.error("Failed to delete report logo", err);
      errorState = {
        title: "Delete failed",
        message: resolveActionErrorMessage(
          err,
          "Unable to delete the report logo. Please try again.",
        ),
      };
    } finally {
      setUploadingLogo(false);
    }

    if (errorState) {
      await showSaveError(errorState);
      return;
    }

    if (successState) {
      await showSaveSuccess(successState);
    }
  };

  const openTablePreview = () => {
    const report = draftReport();
    const table = draftTable();
    if (!report || !table) return;

    const existingTableId = editingTableId();
    const hasExistingTable =
      existingTableId !== null &&
      report.tables.some((item) => item.id === existingTableId);
    const tables = hasExistingTable
      ? report.tables.map((item) =>
          item.id === existingTableId ? table : item,
        )
      : [...report.tables, table];

    openPreview({
      ...report,
      tables,
    });
  };

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        onBack={() => navigate(-1)}
        icon={<Dynamic component={adminOption().icon} class="h-5 w-5" />}
        title={adminOption().title}
        subtitle={adminOption().description}
      />

      <PageBody>
        <Show when={accessLoading()}>
          <div class="py-6 text-center">
            <LoadingState label="Loading report templates..." />
          </div>
        </Show>

        <Show when={!accessLoading() && !hasAccess()}>
          <div class="rounded-lg border border-gray-200 bg-white p-6 text-center text-base text-gray-600 shadow-sm">
            Admin access required.
          </div>
        </Show>

        <Show when={!accessLoading() && hasAccess()}>
          <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div class="text-base font-semibold text-gray-900">
                  Report Logo
                </div>
                <div class="mt-1 text-sm text-gray-600">
                  Used at the top of every report template.
                </div>
                <div class="mt-1 text-sm text-gray-500">
                  <Show
                    when={hasCustomReportLogo()}
                    fallback="Using the default MFAG banner until a custom logo is uploaded."
                  >
                    Custom logo is stored privately and used for all report
                    previews and exports.
                  </Show>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <input
                  ref={reportLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  class="sr-only"
                  aria-label="Upload Logo"
                  disabled={uploadingLogo()}
                  onChange={(event) => {
                    void handleReportLogoSelection(event);
                  }}
                />
                <Button
                  type="button"
                  variant="adminOutline"
                  size="sm"
                  disabled={uploadingLogo()}
                  onClick={() => reportLogoInputRef?.click()}
                >
                  {uploadingLogo()
                    ? "Uploading..."
                    : hasCustomReportLogo()
                      ? "Replace Logo"
                      : "Upload Logo"}
                </Button>
                <Show when={hasCustomReportLogo()}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={uploadingLogo()}
                    onClick={() => {
                      void removeCustomReportLogo();
                    }}
                  >
                    Use Default Logo
                  </Button>
                </Show>
              </div>
            </div>
            <div class="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <Show
                when={!reportLogoAsset.loading}
                fallback={<LoadingState label="Loading report logo..." />}
              >
                <img
                  src={reportLogoPreviewSrc()}
                  alt="Current report logo"
                  class="block h-auto max-w-full rounded-md"
                />
              </Show>
            </div>
          </div>

          <div class="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-base font-semibold text-gray-900">
                  Report Templates
                </div>
                <div class="mt-1 text-sm text-gray-500">
                  Manage the template layouts available for report exports.
                </div>
              </div>
            </div>

            <div class="mt-4 space-y-2">
              <For each={reportTemplates()}>
                {(report) => (
                  <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3">
                    <div>
                      <div class="text-base font-semibold text-gray-900">
                        {report.title || report.id}
                      </div>
                      <div class="text-sm text-gray-500">
                        {report.tables.length}{" "}
                        {isCombinedLayout(report) ? "metric columns" : "leaderboards"}
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="adminOutline"
                        size="sm"
                        onClick={() => openPreview(report)}
                      >
                        Preview
                      </Button>
                      <IconButton
                        type="button"
                        variant="adminOutline"
                        onClick={() => openEditReport(report)}
                        title="Edit report"
                        aria-label="Edit report"
                      >
                        <TbOutlinePencil class="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        type="button"
                        variant="danger"
                        onClick={() => setDeleteCandidate(report)}
                        class="border-red-500 text-red-600"
                        title="Delete report"
                        aria-label="Delete report"
                      >
                        <TbOutlineTrash class="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <div class="mt-4 flex justify-center">
              <Button
                type="button"
                variant="adminOutline"
                size="sm"
                onClick={addReport}
              >
                <TbOutlinePlus class="h-4 w-4" />
                Add Report Template
              </Button>
            </div>
          </div>
        </Show>
      </PageBody>

      <Show when={showDesigner() && draftReport()}>
        {(draft) => (
          <EditModal
            title={
              isEditingDraft() ? "Edit Report Template" : "Add Report Template"
            }
            onClose={closeDesigner}
            onSave={() => {
              void saveDraftReport();
            }}
            saving={saving}
            saveDisabled={saving() || !isDraftDirty()}
            hasUnsavedChanges={isDraftDirty}
            discardPrompt="You have unsaved changes to this report template that will be lost."
            footerLeft={
              <Button
                type="button"
                variant="adminOutline"
                onClick={() => openPreview(draft())}
              >
                Preview
              </Button>
            }
          >
            <div class="grid gap-4 md:grid-cols-2">
              <label class="text-sm font-semibold text-gray-700">
                Title
                <input
                  value={draft().title}
                  onInput={(e) =>
                    updateDraftReport({ title: e.currentTarget.value })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <label class="text-sm font-semibold text-gray-700">
                Filename Template
                <input
                  value={draft().filenameTemplate}
                  onInput={(e) =>
                    updateDraftReport({
                      filenameTemplate: e.currentTarget.value,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <label class="text-sm font-semibold text-gray-700">
                Report Layout
                <select
                  value={getLayoutMode(draft())}
                  onChange={(e) =>
                    updateDraftReport({
                      layoutMode: e.currentTarget
                        .value as ReportTemplate["layoutMode"],
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                >
                  <option value="separateLeaderboards">Separate FSC leaderboards</option>
                  <option value="combinedFsc">Combined FSC table</option>
                  <option value="agencySummary">Agency summary table</option>
                </select>
              </label>
              <label class="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={draft().includeIndexTable}
                  onChange={(e) =>
                    updateDraftReport({
                      includeIndexTable: e.currentTarget.checked,
                    })
                  }
                />
                Include Index Column
              </label>
              <label class="text-sm font-semibold text-gray-700">
                {isCombinedLayout(draft()) ? "Metric Column Gap (px)" : "Leaderboard Gap (px)"}
                <input
                  type="number"
                  value={draft().tableGap}
                  onInput={(e) =>
                    updateDraftReport({
                      tableGap: Number(e.currentTarget.value) || 0,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <label class="text-sm font-semibold text-gray-700">
                Metric Value Column Width (px)
                <input
                  type="number"
                  value={draft().tableWidth}
                  onInput={(e) =>
                    updateDraftReport({
                      tableWidth: Number(e.currentTarget.value) || 0,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <label class="text-sm font-semibold text-gray-700">
                FSC/Agency Column Title
                <input
                  value={
                    draft().primaryColumnHeader ||
                    (isAgencySummaryLayout(draft()) ? "Agency" : "Name")
                  }
                  onInput={(e) =>
                    updateDraftReport({
                      primaryColumnHeader: e.currentTarget.value,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <label class="text-sm font-semibold text-gray-700">
                FSC/Agency Column Width (px)
                <input
                  type="number"
                  value={draft().primaryColumnWidth ?? 120}
                  onInput={(e) =>
                    updateDraftReport({
                      primaryColumnWidth: Number(e.currentTarget.value) || 120,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <Show when={!isAgencySummaryLayout(draft())}>
              <label class="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={draft().agencyBreakdown === true}
                  onChange={(e) =>
                    updateDraftReport({
                      agencyBreakdown: e.currentTarget.checked,
                    })
                  }
                />
                Separate report by agency
              </label>
              </Show>
              <Show when={draft().agencyBreakdown === true && !isAgencySummaryLayout(draft())}>
                <label class="text-sm font-semibold text-gray-700">
                  Agency Table Gap (px)
                  <input
                    type="number"
                    value={draft().agencyTableGap ?? 30}
                    onInput={(e) =>
                      updateDraftReport({
                        agencyTableGap: Number(e.currentTarget.value) || 0,
                      })
                    }
                    class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                  />
                </label>
              </Show>
              <Show when={draft().includeIndexTable}>
                <label class="text-sm font-semibold text-gray-700">
                  Index Column Width (px)
                  <input
                    type="number"
                    value={draft().indexTableWidth}
                    onInput={(e) =>
                      updateDraftReport({
                        indexTableWidth: Number(e.currentTarget.value) || 0,
                      })
                    }
                    class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                  />
                </label>
              </Show>
            </div>

            <div class="mt-6">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h4 class="text-base font-semibold text-gray-900">
                  {reportItemLabel(draft())}
                </h4>
              </div>

              <ReorderList
                class="mt-3 overflow-hidden rounded-md border border-gray-200"
                items={draft().tables}
                itemKey={(table) => String(table.id)}
                onMove={(from, to) => moveTable(draft().id, from, to)}
                renderLabel={(table) => (
                  <div class="flex flex-wrap items-center justify-between gap-3 py-0.5">
                    <div class="text-sm font-semibold text-gray-700">
                      <Show
                        when={(table.titleLines || []).length > 0}
                        fallback={<span>{table.id}</span>}
                      >
                        <div class="flex flex-col gap-0.5">
                          <For each={(table.titleLines || []).slice(0, 3)}>
                            {(line) => <span>{line}</span>}
                          </For>
                        </div>
                      </Show>
                    </div>
                    <div class="flex items-center gap-2">
                      <IconButton
                        type="button"
                        variant="adminOutline"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditTableEditor(table);
                        }}
                        title={`Edit ${reportItemSingularLabel(draft()).toLowerCase()}`}
                        aria-label={`Edit ${reportItemSingularLabel(draft()).toLowerCase()}`}
                      >
                        <TbOutlinePencil class="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        type="button"
                        variant="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTable(draft().id, table.id);
                        }}
                        class="border-red-500 text-red-600"
                        title={
                          `Delete ${reportItemSingularLabel(draft()).toLowerCase()}`
                        }
                        aria-label={
                          `Delete ${reportItemSingularLabel(draft()).toLowerCase()}`
                        }
                      >
                        <TbOutlineTrash class="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                )}
              />

              <div class="mt-4 flex justify-center">
                <Button
                  type="button"
                  variant="adminOutline"
                  size="sm"
                  onClick={openAddTableEditor}
                >
                  <TbOutlinePlus class="h-4 w-4" />
                  Add {reportItemSingularLabel(draft())}
                </Button>
              </div>

              <label class="mt-6 block text-sm font-semibold text-gray-700">
                Bottom Footnote
                <textarea
                  rows={2}
                  value={draft().bottomFootnote || ""}
                  onInput={(e) =>
                    updateDraftReport({
                      bottomFootnote: e.currentTarget.value,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
            </div>
          </EditModal>
        )}
      </Show>

      <Show when={draftTable()}>
        {(table) => (
          <EditModal
            title={
              isEditingTable()
                ? `Edit ${reportItemSingularLabel(draftReport() || { layoutMode: "separateLeaderboards" })}`
                : `Add ${reportItemSingularLabel(draftReport() || { layoutMode: "separateLeaderboards" })}`
            }
            onClose={closeTableEditor}
            onSave={saveDraftTable}
            saveLabel={
              isEditingTable()
                ? `Save ${reportItemSingularLabel(draftReport() || { layoutMode: "separateLeaderboards" })}`
                : `Add ${reportItemSingularLabel(draftReport() || { layoutMode: "separateLeaderboards" })}`
            }
            saveDisabled={
              tableValidationErrors().length > 0 ||
              (isEditingTable() && !isTableDraftDirty())
            }
            hasUnsavedChanges={isTableDraftDirty}
            discardPrompt="You have unsaved changes to this table that will be lost."
            footerLeft={
              <Button
                type="button"
                variant="adminOutline"
                onClick={openTablePreview}
              >
                Preview
              </Button>
            }
          >
            <div class="grid gap-3 md:grid-cols-2">
              <Show when={tableValidationErrors().length > 0}>
                <div class="md:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <For each={tableValidationErrors()}>
                    {(message) => <div>{message}</div>}
                  </For>
                </div>
              </Show>
              <label class="text-base font-semibold text-gray-700">
                Title Lines (one per line)
                <textarea
                  rows={3}
                  value={(table().titleLines || []).join("\n")}
                  placeholder={defaultTitleLinesPlaceholderText || undefined}
                  onInput={(e) =>
                    updateTableDraft({
                      titleLines: parseTitleLinesInput(e.currentTarget.value),
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base placeholder:italic"
                />
              </label>
              <label class="text-base font-semibold text-gray-700">
                {isCombinedLayout(draftReport() || { layoutMode: "separateLeaderboards" }) ? "Column Header" : "Value Label"}
                <input
                  value={table().valueLabel}
                  placeholder={defaultValueLabelPlaceholder || undefined}
                  onInput={(e) =>
                    updateTableDraft({
                      valueLabel: e.currentTarget.value,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base placeholder:italic"
                />
              </label>
              <label class="text-base font-semibold text-gray-700">
                Metric Type
                <select
                  value={table().metric?.type || "countClosings"}
                  onChange={(e) =>
                    updateTableDraft({
                      metric: {
                        type: e.currentTarget
                          .value as ReportTableLayout["metric"]["type"],
                      },
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                >
                  <option value="fyc">FYC</option>
                  <option value="afyc">AFYC</option>
                  <option value="fyp">FYP</option>
                  <option value="afyp">AFYP</option>
                  <option value="referrals">Referrals</option>
                  <option value="countCases">Case Count</option>
                  <option value="countClosings">Closings</option>
                </select>
              </label>
              <label class="text-base font-semibold text-gray-700">
                Target
                <input
                  type="number"
                  value={table().minValue ?? ""}
                  placeholder={defaultMinValuePlaceholder || undefined}
                  onInput={(e) =>
                    updateTableDraft({
                      minValue:
                        e.currentTarget.value === ""
                          ? undefined
                          : Number(e.currentTarget.value) || 0,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base placeholder:italic"
                />
              </label>
              <label class="md:col-span-2 flex items-center gap-2 text-base font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={table().highlightMin ?? false}
                  onChange={(e) =>
                    updateTableDraft({
                      highlightMin: e.currentTarget.checked,
                    })
                  }
                />
                Highlight rows that hit minimum target
              </label>
              <label class="md:col-span-2 flex items-center gap-2 text-base font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={table().includeFooterTotalRow === true}
                  onChange={(e) =>
                    updateTableDraft({
                      includeFooterTotalRow: e.currentTarget.checked,
                    })
                  }
                />
                Include Footer Total Row
              </label>
              <div class="md:col-span-2 rounded-lg border border-gray-200 bg-white p-4">
                <div class="space-y-3 text-base font-semibold text-gray-700">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div>Sources</div>
                      <div class="text-sm font-medium text-gray-500">
                        {describeSourceSelection(table())}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="adminOutline"
                      onClick={() => setShowSourcePicker(true)}
                    >
                      Open Source Picker
                    </Button>
                  </div>
                </div>
              </div>
              <div class="md:col-span-2 rounded-lg border border-gray-200 bg-white p-4">
                <div class="space-y-3 text-base font-semibold text-gray-700">
                  <div>Product Types</div>
                  <Show
                    when={productTypeOptions().length > 0}
                    fallback={
                      <div class="text-sm font-medium text-gray-500">
                        No product types configured.
                      </div>
                    }
                  >
                    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <For each={productTypeOptions()}>
                        {(option) => (
                          <label class="flex items-center gap-2 text-base text-gray-600">
                            <input
                              type="checkbox"
                              checked={isProductTypeSelected(
                                table(),
                                option.key,
                              )}
                              onChange={(e) =>
                                setProductTypeSelected(
                                  table(),
                                  option.key,
                                  e.currentTarget.checked,
                                )
                              }
                            />
                            {option.label}
                            {option.isLegacy ? " (legacy)" : ""}
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
              <label class="md:col-span-2 text-base font-semibold text-gray-700">
                Include only specific products containing any of these keyword(s)
                <div class="mt-1 text-xs font-medium text-gray-500">
                  Separate keywords by commas.
                </div>
                <input
                  value={table().includeProductKeywords || ""}
                  onInput={(e) =>
                    updateTableDraft({
                      includeProductKeywords: e.currentTarget.value,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <label class="md:col-span-2 text-base font-semibold text-gray-700">
                Exclude specific products containing any of these keyword(s)
                <div class="mt-1 text-xs font-medium text-gray-500">
                  Separate keywords by commas.
                </div>
                <input
                  value={table().excludeProductKeywords || ""}
                  onInput={(e) =>
                    updateTableDraft({
                      excludeProductKeywords: e.currentTarget.value,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <div class="md:col-span-2 rounded-lg border border-gray-200 bg-white p-4">
                <div class="space-y-3 text-base font-semibold text-gray-700">
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={areAllAgenciesSelected(table())}
                      onChange={(e) =>
                        setAllAgenciesSelected(e.currentTarget.checked)
                      }
                    />
                    Include all agencies
                  </label>
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={areAllNonLegacyAgenciesSelected(table())}
                      onChange={(e) =>
                        setAllNonLegacyAgenciesSelected(
                          e.currentTarget.checked,
                        )
                      }
                    />
                    Include all non-legacy agencies
                  </label>
                  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <For each={agencyOptions()}>
                      {(agency) => (
                        <label class="flex items-center gap-2 text-base text-gray-600">
                          <input
                            type="checkbox"
                            checked={
                              areAllAgenciesSelected(table()) ||
                              (areAllNonLegacyAgenciesSelected(table()) &&
                                !isLegacyAgency(agency)) ||
                              (table().agencyCodes || []).includes(agency.code)
                            }
                            onChange={(e) =>
                              setAgencySelected(
                                table(),
                                agency.code,
                                e.currentTarget.checked,
                              )
                            }
                          />
                          {agency.code} {agency.name ? `— ${agency.name}` : ""}
                          {agency.isDeleted ? " (legacy)" : ""}
                        </label>
                      )}
                    </For>
                  </div>
                </div>
              </div>
              <div class="md:col-span-2 rounded-lg border border-gray-200 bg-white p-4">
                <div class="space-y-3 text-base font-semibold text-gray-700">
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={getAdvisorSelectionState(table()).allSelected}
                      onChange={(e) =>
                        setAllAdvisorsSelected(e.currentTarget.checked)
                      }
                    />
                    Include all advisors
                  </label>
                  <div class="grid gap-2 sm:grid-cols-2">
                    <label class="flex items-center gap-2 text-base text-gray-600">
                      <input
                        type="checkbox"
                        checked={getAdvisorSelectionState(table()).rookies}
                        onChange={(e) =>
                          setAdvisorGroupSelected(
                            table(),
                            "rookies",
                            e.currentTarget.checked,
                          )
                        }
                      />
                      Rookies
                    </label>
                    <label class="flex items-center gap-2 text-base text-gray-600">
                      <input
                        type="checkbox"
                        checked={getAdvisorSelectionState(table()).nonRookies}
                        onChange={(e) =>
                          setAdvisorGroupSelected(
                            table(),
                            "nonRookies",
                            e.currentTarget.checked,
                          )
                        }
                      />
                      Non-rookies
                    </label>
                    <Show when={isRookiesOnlySelected(table())}>
                      <label class="flex items-center gap-2 text-base text-gray-600">
                        Rookie # years
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={table().rookieYears ?? 2}
                          onInput={(e) =>
                            updateTableDraft({
                              rookieYears: Number(e.currentTarget.value) || 2,
                            })
                          }
                          class="w-20 rounded-md border border-gray-200 bg-white px-2 py-1 text-base"
                        />
                      </label>
                    </Show>
                  </div>
                </div>
              </div>
              <label class="md:col-span-2 text-base font-semibold text-gray-700">
                Footnote
                <Show when={isRookiesOnlySelected(table())}>
                  <div class="mt-1 text-xs font-medium text-gray-500">
                    Use {"{YYYY}"} to indicate rookie start year.
                  </div>
                </Show>
                <textarea
                  rows={2}
                  value={table().footnote || ""}
                  onInput={(e) =>
                    updateTableDraft({
                      footnote: e.currentTarget.value,
                    })
                  }
                  class="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base"
                />
              </label>
            </div>
          </EditModal>
        )}
      </Show>

      <Show when={showSourcePicker() && draftTable()}>
        {(table) => (
          <EditModal
            title="Select Sources"
            onClose={() => setShowSourcePicker(false)}
          >
            <div class="space-y-4">
              <div class="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
                Selecting a parent source includes all of its items.
              </div>
              <Show
                when={sourceOptions().length > 0}
                fallback={
                  <div class="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                    No sources available.
                  </div>
                }
              >
                <div class="space-y-3">
                  <For each={sourceOptions()}>
                    {(source) => (
                      <div class="rounded-lg border border-gray-200 bg-white p-4">
                        <label class="flex items-center gap-2 text-base font-semibold text-gray-700">
                          <input
                            type="checkbox"
                            checked={isSourceFullySelected(table(), source)}
                            onChange={(e) =>
                              setSourceFullySelected(
                                table(),
                                source,
                                e.currentTarget.checked,
                              )
                            }
                          />
                          {source.label}
                          {source.isDeleted ? " (legacy)" : ""}
                        </label>
                        <Show when={source.children.length > 0}>
                          <div class="mt-3 grid gap-2 pl-6 sm:grid-cols-2">
                            <For each={source.children}>
                              {(child) => (
                                <label class="flex items-center gap-2 text-base text-gray-600">
                                  <input
                                    type="checkbox"
                                    checked={isSourceItemSelected(
                                      table(),
                                      source,
                                      child.id,
                                    )}
                                    onChange={(e) =>
                                      setSourceItemSelected(
                                        table(),
                                        source,
                                        child.id,
                                        e.currentTarget.checked,
                                      )
                                    }
                                  />
                                  {child.label}
                                  {child.isDeleted ? " (legacy)" : ""}
                                </label>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </EditModal>
        )}
      </Show>

      <Show when={previewTarget()}>
        {(report) => (
          <EditModal
            title={`Preview: ${report().title || report().id}`}
            onClose={() => setPreviewTarget(null)}
          >
            <div class="space-y-4">
              <div class="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
                Preview uses sample placeholder ranking data to show the report
                layout only.
              </div>

              <Show
                when={(report().tables || []).length > 0}
                fallback={
                  <div class="rounded-lg border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
                    Add at least one table to render a preview.
                  </div>
                }
              >
                <Show
                  when={!previewImage.loading}
                  fallback={
                    <div class="py-10">
                      <LoadingState label="Rendering preview..." />
                    </div>
                  }
                >
                  <Show
                    when={!previewImage.error && previewImage()}
                    fallback={
                      <div class="rounded-lg border border-dashed border-red-200 bg-white p-10 text-center text-sm text-red-600">
                        Unable to render the report preview.
                      </div>
                    }
                  >
                    {(preview) => (
                      <div class="overflow-auto">
                        <img
                          src={preview().dataUrl}
                          alt={`Preview for ${report().title || report().id}`}
                          class="mx-auto block h-auto max-w-full"
                          style={{
                            width: `${preview().width}px`,
                            "max-width": "100%",
                          }}
                        />
                      </div>
                    )}
                  </Show>
                </Show>
              </Show>
            </div>
          </EditModal>
        )}
      </Show>

      <Show when={deleteCandidate()}>
        {(candidate) => (
          <div class="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div class="absolute inset-0 bg-black/50" />
            <div class="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
              <h3 class="text-lg font-semibold text-gray-900">
                Delete report?
              </h3>
              <p class="mt-2 text-base text-gray-600">
                This will remove “{candidate().title || candidate().id}” from
                the available report templates.
              </p>
              <div class="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDeleteCandidate(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="dangerSolid"
                  onClick={confirmDeleteReport}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </Show>

      <SaveSuccessModal />
      <SaveErrorModal />
    </PageShell>
  );
};

export default ManageReports;
