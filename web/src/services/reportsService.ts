import { authFetch, authJson } from "./authService";

export const DEFAULT_REPORT_LOGO_PATH = "/api/reports/logo";

export type ReportValueFormat = "currency" | "count" | "number";
export type RookieFilterMode = "rookies" | "nonRookies" | "all";
export type ReportLayoutMode =
  | "separateLeaderboards"
  | "combinedFsc"
  | "agencySummary";
const allowedMetricTypes = [
  "fyc",
  "afyc",
  "fyp",
  "afyp",
  "referrals",
  "countCases",
  "countClosings",
] as const;

export type ReportMetricType = (typeof allowedMetricTypes)[number];

export type ReportMetric = {
  type: ReportMetricType;
};

export type ReportTableLayout = {
  id: number;
  titleLines: string[];
  valueLabel: string;
  valueFormat?: ReportValueFormat;
  minValue?: number;
  highlightMin?: boolean;
  showIndex?: boolean;
  includeAllAgencies?: boolean;
  includeAllNonLegacyAgencies?: boolean;
  agencyCodes?: string[];
  agencyBreakdown?: boolean;
  agencyGroupLabel?: string;
  includeAllAdvisors?: boolean;
  rookieFilter?: RookieFilterMode;
  rookieYears?: number;
  sources?: string[];
  sourceItemIds?: string[];
  productTypeKeys?: string[];
  includeProductKeywords?: string;
  excludeProductKeywords?: string;
  includeFooterTotalRow?: boolean;
  metric: ReportMetric;
  footnote?: string;
};

export type ReportTemplate = {
  id: number;
  title: string;
  filenameTemplate: string;
  tableGap: number;
  tableWidth: number;
  indexTableWidth: number;
  includeIndexTable: boolean;
  layoutMode?: ReportLayoutMode;
  singleTable?: boolean;
  primaryColumnHeader?: string;
  primaryColumnWidth?: number;
  agencyBreakdown?: boolean;
  agencyTableGap?: number;
  bottomFootnote?: string;
  tables: ReportTableLayout[];
  updatedBy?: string;
  updatedAt?: string;
};

export type ReportRenderRow = {
  key?: string;
  name: string;
  value: number;
};

export type ReportRenderTable = Omit<ReportTableLayout, "id"> & {
  id: ReportTableLayout["id"] | "index-only";
  rows: ReportRenderRow[];
  indexOnly?: boolean;
};

export type GenerateReportPdfPayload = {
  report: ReportTemplate;
  reportDate: string;
  reportRangeLabel: string;
  tables: ReportRenderTable[];
  maxRows: number;
  filename?: string;
};

export type ReportBackup = {
  id: string;
  data: ReportTemplate[];
  createdAt?: Date;
  expiresAt?: Date;
};

export type ReportLogoAsset = {
  src: string;
  isCustom: boolean;
};

export interface ReportsService {
  getReports(forceRefresh?: boolean): Promise<ReportTemplate[]>;
  setReports(data: ReportTemplate[]): Promise<ReportTemplate[]>;
  getBackups(): Promise<ReportBackup[]>;
  restoreFromBackup(backup: ReportBackup): Promise<void>;
  deleteBackup(id: string): Promise<void>;
  getReportLogoAsset(): Promise<ReportLogoAsset>;
  uploadReportLogo(file: File): Promise<void>;
  deleteReportLogo(): Promise<void>;
  generateReportPdf(payload: GenerateReportPdfPayload): Promise<Blob>;
}

type ReportsGetResponse =
  | ReportTemplate[]
  | {
      reports?: unknown;
    };

type ReportsSetResponse = {
  saved?: boolean;
  reports?: unknown;
};

type ReportBackupsResponse = {
  backups?: Array<{
    id?: unknown;
    data?: unknown;
    createdAt?: unknown;
    expiresAt?: unknown;
  }>;
};

class ApiReportsService implements ReportsService {
  private async requestJson<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    return authFetch(path, init);
  }

  private async throwIfNotOk(
    response: Response,
    fallbackMessage: string,
  ): Promise<void> {
    if (response.ok) return;

    let message = fallbackMessage;
    try {
      const payload = (await response.clone().json()) as { message?: unknown };
      const candidate = String(payload?.message || "").trim();
      if (candidate) {
        message = candidate;
      }
    } catch {
      // Ignore malformed error payloads and use the fallback message.
    }

    throw new Error(message);
  }

  private toOptionalDate(value: unknown): Date | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return undefined;
  }

  private toPositiveInteger(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) return null;
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }

    return null;
  }

  private normalizeMetricType(value: unknown): ReportMetricType {
    const candidate = String(value || "").trim() as ReportMetricType;
    return allowedMetricTypes.includes(candidate)
      ? candidate
      : "countClosings";
  }

  private parseMetric(raw: unknown): ReportMetric {
    if (!raw || typeof raw !== "object") {
      return { type: "countClosings" };
    }

    const item = raw as Record<string, unknown>;
    return {
      type: this.normalizeMetricType(item.type),
    };
  }

  private parseTable(raw: unknown): ReportTableLayout | null {
    if (!raw || typeof raw !== "object") return null;

    const item = raw as Record<string, unknown>;
    const id = this.toPositiveInteger(item.id);
    if (id === null) return null;

    return {
      ...(item as unknown as Omit<ReportTableLayout, "id">),
      id,
      metric: this.parseMetric(item.metric),
    };
  }

  private parseReport(raw: unknown): ReportTemplate | null {
    if (!raw || typeof raw !== "object") return null;

    const item = raw as Record<string, unknown>;
    const id = this.toPositiveInteger(item.id);
    if (id === null) return null;

    const rawTables = Array.isArray(item.tables) ? item.tables : [];

    const rawLayoutMode = String(item.layoutMode || item.layout_mode || "").trim();
    const singleTable =
      typeof item.singleTable === "boolean"
        ? item.singleTable
        : typeof item.single_table === "boolean"
          ? (item.single_table as boolean)
          : undefined;
    const layoutMode: ReportLayoutMode =
      rawLayoutMode === "agencySummary" ||
      rawLayoutMode === "combinedFsc" ||
      rawLayoutMode === "separateLeaderboards"
        ? rawLayoutMode
        : singleTable
          ? "combinedFsc"
          : "separateLeaderboards";

    return {
      ...(item as unknown as Omit<ReportTemplate, "id" | "tables">),
      id,
      layoutMode,
      singleTable: layoutMode === "combinedFsc",
      tables: rawTables
        .map((table) => this.parseTable(table))
        .filter((table): table is ReportTableLayout => table !== null),
    };
  }

  private parseReports(raw: unknown): ReportTemplate[] {
    if (typeof raw === "string") {
      try {
        return this.parseReports(JSON.parse(raw));
      } catch {
        return [];
      }
    }

    if (!Array.isArray(raw)) return [];

    return raw
      .map((item) => this.parseReport(item))
      .filter((item): item is ReportTemplate => item !== null);
  }

  async getReports(_forceRefresh = false): Promise<ReportTemplate[]> {
    const payload = await this.requestJson<ReportsGetResponse>("/api/reports", {
      method: "GET",
    });

    if (Array.isArray(payload)) {
      return this.parseReports(payload);
    }

    return this.parseReports(payload?.reports);
  }

  async setReports(data: ReportTemplate[]): Promise<ReportTemplate[]> {
    const payload = await this.requestJson<ReportsSetResponse>("/api/reports", {
      method: "PUT",
      body: JSON.stringify({ reports: data }),
    });

    return this.parseReports(payload?.reports ?? data);
  }

  async getBackups(): Promise<ReportBackup[]> {
    const payload = await this.requestJson<ReportBackupsResponse>(
      "/api/reports/backups",
      {
        method: "GET",
      },
    );

    const backups = Array.isArray(payload?.backups) ? payload.backups : [];

    return backups
      .map((item) => ({
        id: String(item?.id || ""),
        data: this.parseReports(item?.data),
        createdAt: this.toOptionalDate(item?.createdAt),
        expiresAt: this.toOptionalDate(item?.expiresAt),
      }))
      .filter((item) => item.id !== "");
  }

  async restoreFromBackup(backup: ReportBackup): Promise<void> {
    await this.setReports(backup.data);
  }

  async deleteBackup(id: string): Promise<void> {
    await this.requestJson<{ deleted: boolean }>(
      `/api/reports/backups/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    );
  }

  async getReportLogoAsset(): Promise<ReportLogoAsset> {
    const response = await this.request("/api/reports/logo", {
      method: "GET",
    });

    if (response.status === 404) {
      return {
        src: DEFAULT_REPORT_LOGO_PATH,
        isCustom: false,
      };
    }

    await this.throwIfNotOk(response, "Unable to load report logo");
    const source =
      (response.headers.get("X-Report-Logo-Source") || "").toLowerCase();
    const blob = await response.blob();

    return {
      src: URL.createObjectURL(blob),
      isCustom: source === "custom",
    };
  }

  async uploadReportLogo(file: File): Promise<void> {
    const body = new FormData();
    body.append("file", file);

    const response = await this.request("/api/reports/logo", {
      method: "POST",
      body,
    });

    await this.throwIfNotOk(response, "Unable to upload report logo");
  }

  async deleteReportLogo(): Promise<void> {
    const response = await this.request("/api/reports/logo", {
      method: "DELETE",
    });

    await this.throwIfNotOk(response, "Unable to delete report logo");
  }

  async generateReportPdf(payload: GenerateReportPdfPayload): Promise<Blob> {
    const response = await this.request("/api/reports/render-pdf", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    await this.throwIfNotOk(response, "Unable to generate report PDF");
    return response.blob();
  }
}

export const reportsService: ReportsService = new ApiReportsService();
