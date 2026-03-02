import { authJson } from "./authService";

// ============ Types ============

export type PremiumFrequency =
  | "Annual"
  | "Semi-Annual"
  | "Quarterly"
  | "Mthly-1"
  | "Mthly-2"
  | "Single";

export type ClosingProductQuantityAndPremium = {
  quantity: number;
  premium: number;
  frequency?: PremiumFrequency;
};

export type ClosingProduct = {
  id?: string;
  isRider?: boolean;
  productId: string;
  fullName: string;
  shortName: string;
  premiumTermOrIssueAge?: string;
  type?: string;
  fycRate: number;
  gst: number;
  frequencies?: string[];
  quantitiesAndPremiums: ClosingProductQuantityAndPremium[];
  riders: ClosingProduct[];
  countsTowardProduction?: string;
};

// Define Closing type here to avoid circular dependency
export type Closing = {
  id: string;
  timestamp: Date | string;
  fscCode: string;
  fscName: string;
  isShared?: boolean;
  updatedBy?: string;
  updatedAt?: string;
  sharedFscCode?: string;
  sharedFscName?: string;
  sourceId: string;
  sourceLabel?: string;
  sourceItemId?: string;
  sourceItemLabel?: string;
  sourceComment?: string;
  referrals: number;
  referralsComment?: string;
  items: ClosingProduct[];
};

export type ClosingBackup = {
  id: string;
  monthKey: string;
  data: string;
  createdAt?: Date;
  expiresAt?: Date;
  createdBy?: string;
};

// Input type for creating/updating closings (no id required)
export type ClosingInput = Omit<Closing, "id"> & { id?: string };

export const premiumFrequencyLabels: Record<PremiumFrequency, string> = {
  Annual: "Annual",
  "Semi-Annual": "Semi-Annual",
  Quarterly: "Quarterly",
  "Mthly-1": "Monthly (1 month premium collected)",
  "Mthly-2": "Monthly (2 months premium collected)",
  Single: "Single",
};

// ============ Calculation Helpers ============

/**
 * Get annualized FYP (First Year Premium) based on frequency
 * GST is removed from premium before annualizing
 */
export function getAnnualizedFYP(
  premium: number,
  frequency: PremiumFrequency,
  gst: number = 0,
): number {
  let annualized: number;
  switch (frequency) {
    case "Annual":
    case "Single":
      annualized = premium;
      break;
    case "Semi-Annual":
      annualized = premium * 2;
      break;
    case "Quarterly":
      annualized = premium * 4;
      break;
    case "Mthly-1":
    case "Mthly-2":
      annualized = premium * 12;
      break;
    default:
      annualized = premium;
  }

  if (gst > 0) {
    annualized /= 1 + gst / 100;
  }
  return Math.round(annualized * 100) / 100;
}

/**
 * Get FYC (First Year Commission) based on premium collected
 * Mthly-1: 1 month collected, Mthly-2: 2 months collected
 */
export function getFYC(
  premium: number,
  frequency: PremiumFrequency,
  fycRate: number,
  gst: number = 0,
): number {
  let premiumCollected: number;
  switch (frequency) {
    case "Annual":
      premiumCollected = premium;
      break;
    case "Semi-Annual":
      premiumCollected = premium;
      break;
    case "Quarterly":
      premiumCollected = premium;
      break;
    case "Mthly-1":
      premiumCollected = premium; // 1 month collected
      break;
    case "Mthly-2":
      premiumCollected = premium * 2; // 2 months collected
      break;
    default:
      premiumCollected = premium;
  }

  let fyc = premiumCollected * (fycRate / 100);
  if (gst > 0) {
    fyc /= 1 + gst / 100;
  }
  return Math.ceil(fyc * 100) / 100;
}

/**
 * Service layer for Closings data fetching.
 */

export interface ClosingsQuery {
  startDate: string; // Preferred: YYYY-MM-DD local date (backend also accepts datetimes for legacy callers)
  endDate: string; // Preferred: YYYY-MM-DD inclusive local date (backend also accepts datetimes for legacy callers)
  fscCode?: string; // Optional filter for "My Closings"
}

export interface ClosingsService {
  getClosingsDateRange(): Promise<{
    minDate: string | null;
    maxDate: string | null;
  }>;
  getClosings(params: ClosingsQuery): Promise<Closing[]>;
  getClosingById(id: string): Promise<Closing | null>;
  createClosing(closing: ClosingInput): Promise<string>;
  updateClosing(closing: Closing): Promise<void>;
  deleteClosing(id: string): Promise<void>;
  getBackupsForMonth(monthKey: string): Promise<ClosingBackup[]>;
  getMonthData(monthKey: string): Promise<string>;
  setMonthData(monthKey: string, data: string): Promise<void>;
  deleteBackup(id: string): Promise<void>;
}

class ApiClosingsService implements ClosingsService {
  private async requestJson<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
  }

  private toValidDate(value: unknown): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }

  private toOptionalDate(value: unknown): Date | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return undefined;
  }

  private toOptionalString(value: unknown): string | undefined {
    const text = String(value ?? "").trim();
    return text ? text : undefined;
  }

  private toOptionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
    }
    return undefined;
  }

  private normalizePremium(value: any): ClosingProductQuantityAndPremium {
    return {
      quantity: Math.max(1, Number(value?.quantity) || 1),
      premium: Number(value?.premium) || 0,
      frequency: this.toOptionalString(value?.frequency) as
        | PremiumFrequency
        | undefined,
    };
  }

  private normalizeProduct(value: any): ClosingProduct {
    const quantitiesAndPremiums = Array.isArray(value?.quantitiesAndPremiums)
      ? value.quantitiesAndPremiums.map((item: any) =>
          this.normalizePremium(item),
        )
      : [];
    const riders = Array.isArray(value?.riders)
      ? value.riders.map((item: any) => this.normalizeProduct(item))
      : [];
    const isRider = this.toOptionalBoolean(value?.isRider);

    return {
      id: this.toOptionalString(value?.id),
      isRider,
      productId: String(value?.productId || "").trim(),
      fullName: String(value?.fullName || "").trim(),
      shortName: String(value?.shortName || ""),
      premiumTermOrIssueAge: this.toOptionalString(
        value?.premiumTermOrIssueAge,
      ),
      type: this.toOptionalString(value?.type),
      fycRate: Number(value?.fycRate) || 0,
      gst: Number(value?.gst) || 0,
      frequencies: Array.isArray(value?.frequencies)
        ? value.frequencies.map((f: unknown) => String(f))
        : undefined,
      quantitiesAndPremiums,
      riders,
      countsTowardProduction: this.toOptionalString(
        value?.countsTowardProduction,
      ),
    };
  }

  private normalizeClosing(value: any): Closing {
    const items = Array.isArray(value?.items)
      ? value.items
          .map((item: any) => this.normalizeProduct(item))
          .filter((item: ClosingProduct) => item.productId && item.fullName)
      : [];
    const sharedFscCode = this.toOptionalString(value?.sharedFscCode);
    const sharedFscName = this.toOptionalString(value?.sharedFscName);
    const isShared =
      this.toOptionalBoolean(value?.isShared) ??
      Boolean(sharedFscCode || sharedFscName);
    const sourceId = String(value?.sourceId || "").trim();
    const sourceItemId = this.toOptionalString(value?.sourceItemId);

    return {
      id: String(value?.id || ""),
      timestamp: this.toValidDate(value?.timestamp),
      fscCode: String(value?.fscCode || "").trim(),
      fscName: String(value?.fscName || "").trim(),
      isShared,
      sharedFscCode,
      sharedFscName,
      sourceId,
      sourceLabel: this.toOptionalString(value?.sourceLabel),
      sourceItemId,
      sourceItemLabel: this.toOptionalString(value?.sourceItemLabel),
      sourceComment: this.toOptionalString(value?.sourceComment),
      referrals: Math.max(0, Number(value?.referrals) || 0),
      referralsComment: this.toOptionalString(value?.referralsComment),
      updatedBy: this.toOptionalString(value?.updatedBy),
      updatedAt: this.toOptionalString(value?.updatedAt),
      items,
    };
  }

  private serializePremium(
    value: ClosingProductQuantityAndPremium,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      quantity: Math.max(1, Number(value.quantity) || 1),
      premium: Number(value.premium) || 0,
    };
    if (value.frequency) payload.frequency = value.frequency;
    return payload;
  }

  private serializeProduct(value: ClosingProduct): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      productId: String(value.productId || "").trim(),
      fullName: String(value.fullName || "").trim(),
      shortName: String(value.shortName || ""),
      fycRate: Number(value.fycRate) || 0,
      gst: Number(value.gst) || 0,
      quantitiesAndPremiums: (Array.isArray(value.quantitiesAndPremiums)
        ? value.quantitiesAndPremiums
        : []
      ).map((item) => this.serializePremium(item)),
      riders: (Array.isArray(value.riders) ? value.riders : []).map((item) =>
        this.serializeProduct(item),
      ),
    };

    if (typeof value.isRider === "boolean") {
      payload.isRider = value.isRider;
    }

    if (value.premiumTermOrIssueAge) {
      payload.premiumTermOrIssueAge = String(
        value.premiumTermOrIssueAge,
      ).trim();
    }
    if (value.type) {
      payload.type = String(value.type).trim();
    }
    if (value.countsTowardProduction) {
      payload.countsTowardProduction = value.countsTowardProduction;
    }

    return payload;
  }

  private serializeClosing(value: ClosingInput): Record<string, unknown> {
    const inferredShared = Boolean(value.sharedFscCode || value.sharedFscName);
    const isShared = value.isShared ?? inferredShared;
    const payload: Record<string, unknown> = {
      timestamp: this.toValidDate(value.timestamp).toISOString(),
      fscCode: String(value.fscCode || "").trim(),
      fscName: String(value.fscName || "").trim(),
      isShared: Boolean(isShared),
      sourceId: String(value.sourceId || "").trim(),
      referrals: Math.max(0, Number(value.referrals) || 0),
      items: (Array.isArray(value.items) ? value.items : []).map((item) =>
        this.serializeProduct(item),
      ),
    };

    if (value.sharedFscCode)
      payload.sharedFscCode = String(value.sharedFscCode).trim();
    if (value.sharedFscName)
      payload.sharedFscName = String(value.sharedFscName).trim();
    if (value.sourceItemId)
      payload.sourceItemId = String(value.sourceItemId).trim();
    if (value.sourceComment)
      payload.sourceComment = String(value.sourceComment);
    if (value.referralsComment)
      payload.referralsComment = String(value.referralsComment);

    return payload;
  }

  private toDataString(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    return "[]";
  }

  async getClosingsDateRange(): Promise<{
    minDate: string | null;
    maxDate: string | null;
  }> {
    const payload = await this.requestJson<{
      minDate?: string | null;
      maxDate?: string | null;
    }>("/api/closings/date-range", { method: "GET" });
    return {
      minDate: payload?.minDate ?? null,
      maxDate: payload?.maxDate ?? null,
    };
  }

  async getClosings(params: ClosingsQuery): Promise<Closing[]> {
    const query = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.fscCode) {
      query.set("fscCode", params.fscCode);
    }

    const payload = await this.requestJson<{ closings?: any[] }>(
      `/api/closings?${query.toString()}`,
      { method: "GET" },
    );

    const closings = Array.isArray(payload?.closings)
      ? payload.closings.map((entry) => this.normalizeClosing(entry))
      : [];

    closings.sort(
      (a, b) =>
        this.toValidDate(b.timestamp).getTime() -
        this.toValidDate(a.timestamp).getTime(),
    );

    return closings;
  }

  async getClosingById(id: string): Promise<Closing | null> {
    try {
      const payload = await this.requestJson<{ closing?: any }>(
        `/api/closings/${id}`,
        {
          method: "GET",
        },
      );
      if (!payload?.closing) return null;
      return this.normalizeClosing(payload.closing);
    } catch (error) {
      if (error instanceof Error && /closing not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async createClosing(closing: ClosingInput): Promise<string> {
    const payload = await this.requestJson<{ id?: string | number }>(
      "/api/closings",
      {
        method: "POST",
        body: JSON.stringify(this.serializeClosing(closing)),
      },
    );
    const id = payload?.id;
    if (id === undefined || id === null || id === "") {
      throw new Error("Failed to create closing");
    }
    return String(id);
  }

  async updateClosing(closing: Closing): Promise<void> {
    if (!closing.id) {
      throw new Error("Invalid closing ID");
    }

    await this.requestJson<{ saved: boolean }>(`/api/closings/${closing.id}`, {
      method: "PUT",
      body: JSON.stringify(this.serializeClosing(closing)),
    });
  }

  async deleteClosing(id: string): Promise<void> {
    if (!id) throw new Error("Invalid closing ID");
    await this.requestJson<{ deleted: boolean }>(`/api/closings/${id}`, {
      method: "DELETE",
    });
  }

  async getBackupsForMonth(monthKey: string): Promise<ClosingBackup[]> {
    const payload = await this.requestJson<{ backups?: any[] }>(
      `/api/closings/months/${monthKey}/backups`,
      { method: "GET" },
    );

    const backups = Array.isArray(payload?.backups)
      ? payload.backups.map((entry: any) => ({
          id: String(entry?.id || ""),
          monthKey: String(entry?.monthKey || monthKey),
          data: this.toDataString(entry?.data),
          createdAt: this.toOptionalDate(entry?.createdAt),
          expiresAt: this.toOptionalDate(entry?.expiresAt),
          createdBy: this.toOptionalString(entry?.createdBy),
        }))
      : [];

    return backups.filter((backup) => backup.id);
  }

  async getMonthData(monthKey: string): Promise<string> {
    const payload = await this.requestJson<{ data?: string }>(
      "/api/closings/months/" + monthKey + "/data",
      {
        method: "GET",
      },
    );
    return this.toDataString(payload?.data);
  }

  async setMonthData(monthKey: string, data: string): Promise<void> {
    await this.requestJson<{ saved: boolean }>(
      `/api/closings/months/${monthKey}/data`,
      {
        method: "PUT",
        body: JSON.stringify({
          data: this.toDataString(data),
        }),
      },
    );
  }

  async deleteBackup(id: string): Promise<void> {
    if (!id) throw new Error("Invalid backup ID");
    await this.requestJson<{ deleted: boolean }>(
      `/api/closings/backups/${id}`,
      {
        method: "DELETE",
      },
    );
  }
}

export const closingsService: ClosingsService = new ApiClosingsService();
