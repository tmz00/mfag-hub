import { authJson } from "./authService";

export type BasePlan = {
  id: string;
  category?: string;
  fullName?: string;
  shortName?: string;
  type?: string;
  notes?: string;
  optionTitle?: string;
  options?: Array<{ label: string; fycRate: string }>;
  fycRate?: string;
  frequencies?: string[];
  gst?: string;
  attachableRiders?: string[];
  countsTowardProduction?: string;
};

export type Rider = {
  id: string;
  category?: string;
  fullName?: string;
  shortName?: string;
  attachedSuffix?: string;
  type?: string;
  notes?: string;
  optionTitle?: string;
  options?: Array<{ label: string; fycRate: string }>;
  fycRate?: string;
  frequencies?: string[];
  gst?: string;
  countsTowardProduction?: string;
};

export type ProductCatalog = {
  gst?: number;
  basePlanCategories?: string[];
  riderCategories?: string[];
  types?: Record<string, string>;
  basePlans?: BasePlan[];
  riders?: Rider[];
  updatedBy?: string;
  updatedAt?: string;
};

export type ProductBackup = {
  id: string;
  data: ProductCatalog;
  createdAt?: Date;
  expiresAt?: Date;
};

export type ProductItem = BasePlan | Rider;

export interface ProductsService {
  getProducts(forceRefresh?: boolean): Promise<ProductCatalog>;
  setProducts(data: ProductCatalog, snapshotTitle?: string): Promise<void>;
  getBackups(): Promise<ProductBackup[]>;
  restoreFromBackup(backup: ProductBackup): Promise<void>;
  deleteBackup(id: string): Promise<void>;
}

class ApiProductsService implements ProductsService {
  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
  }

  private normalizeCatalog(input: ProductCatalog): ProductCatalog {
    const basePlans = Array.isArray(input.basePlans) ? input.basePlans : [];
    const riders = Array.isArray(input.riders) ? input.riders : [];

    const basePlanCategories = Array.from(
      new Set(basePlans.map((p) => String(p.category || "").trim()).filter(Boolean))
    );
    const riderCategories = Array.from(
      new Set(riders.map((r) => String(r.category || "").trim()).filter(Boolean))
    );

    const normalizedTypes =
      input.types && typeof input.types === "object" && !Array.isArray(input.types)
        ? Object.fromEntries(
            Object.entries(input.types)
              .map(([k, v]) => [String(k).trim(), String(v ?? "").trim()])
              .filter(([k, v]) => k && v)
          )
        : undefined;

    return {
      ...input,
      types: normalizedTypes,
      basePlans,
      riders,
      basePlanCategories,
      riderCategories,
    };
  }

  async getProducts(_forceRefresh = false): Promise<ProductCatalog> {
    const payload = await this.requestJson<ProductCatalog>("/api/products", {
      method: "GET",
    });
    return this.normalizeCatalog(payload || {});
  }

  async setProducts(data: ProductCatalog, snapshotTitle?: string): Promise<void> {
    const payload = this.normalizeCatalog(data);
    await this.requestJson<{ saved: boolean }>("/api/products", {
      method: "PUT",
      body: JSON.stringify({
        gst: payload.gst,
        types: payload.types || {},
        basePlans: payload.basePlans || [],
        riders: payload.riders || [],
        snapshotTitle: String(snapshotTitle || "").trim() || undefined,
      }),
    });
  }

  async getBackups(): Promise<ProductBackup[]> {
    return [];
  }

  async restoreFromBackup(backup: ProductBackup): Promise<void> {
    await this.setProducts(backup.data, "Manage Products Backups");
  }

  async deleteBackup(_id: string): Promise<void> {
    return;
  }
}

export const productsService: ProductsService = new ApiProductsService();
