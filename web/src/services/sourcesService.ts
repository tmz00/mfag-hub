import { authJson } from "./authService";

// ============ Types ============

export type SourceChild = {
  id: string;
  label: string;
  isDeleted?: boolean;
};

export type Source = {
  id: string;
  label: string;
  description?: string;
  isDeleted?: boolean;
  children: SourceChild[];
};

export type SourcesBackup = {
  id: string;
  data: string;
  createdAt?: Date;
  expiresAt?: Date;
  updatedBy?: string;
};

// ============ Service ============

export type GetSourcesOptions = {
  includeDeletedItems?: boolean;
};

export interface SourcesService {
  getSources(options?: GetSourcesOptions): Promise<Source[]>;
  saveSources(sources: Source[]): Promise<void>;
  getBackups(): Promise<SourcesBackup[]>;
  restoreBackup(backupId: string): Promise<void>;
  deleteBackup(backupId: string): Promise<void>;
}

class ApiSourcesService implements SourcesService {
  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
  }

  private normalizeSource(raw: any): Source {
    const childrenRaw = Array.isArray(raw?.children) ? raw.children : [];
    return {
      id: String(raw?.id || "").trim(),
      label: String(raw?.label || "").trim(),
      description: String(raw?.description || ""),
      ...(raw?.isDeleted === true ? { isDeleted: true } : {}),
      children: childrenRaw
        .map((child: any) => {
          const normalizedChild: SourceChild = {
            id: String(child?.id || "").trim(),
            label: String(child?.label || "").trim(),
          };

          if (child?.isDeleted === true) {
            normalizedChild.isDeleted = true;
          }

          return normalizedChild;
        })
        .filter((child: SourceChild) => child.id && child.label),
    };
  }

  async getSources(options: GetSourcesOptions = {}): Promise<Source[]> {
    const params = new URLSearchParams();
    if (options.includeDeletedItems) {
      params.set("includeDeletedItems", "1");
    }

    const path =
      params.size > 0 ? `/api/sources?${params.toString()}` : "/api/sources";
    const payload = await this.requestJson<{ sources?: any[] }>(path, {
      method: "GET",
    });

    const normalized = Array.isArray(payload?.sources)
      ? payload.sources.map((item) => this.normalizeSource(item))
      : [];

    return normalized.filter((source) => source.id && source.label);
  }

  async saveSources(sources: Source[]): Promise<void> {
    const payload = (Array.isArray(sources) ? sources : [])
      .map((source) => {
        const id = String(source?.id || "").trim();
        const label = String(source?.label || "").trim();
        const description = String(source?.description || "");
        const children = (Array.isArray(source?.children) ? source.children : [])
          .map((child) => ({
            id: String(child?.id || "").trim(),
            label: String(child?.label || "").trim(),
          }))
          .filter((child) => child.label);

        return {
          id,
          label,
          description,
          children,
        };
      })
      .filter((source) => source.id && source.label);

    await this.requestJson<{ saved: boolean }>("/api/sources", {
      method: "PUT",
      body: JSON.stringify({ sources: payload }),
    });
  }

  async getBackups(): Promise<SourcesBackup[]> {
    return [];
  }

  async restoreBackup(_backupId: string): Promise<void> {
    throw new Error("Sources backups are not supported");
  }

  async deleteBackup(_backupId: string): Promise<void> {
    return;
  }
}

export const sourcesService: SourcesService = new ApiSourcesService();
