import { authFetch, authJson } from "./authService";

export type BackupSnapshotEntry = {
  id: string;
  feature: string;
  summary?: string;
  scopeKey?: string;
  createdAt?: Date;
  createdBy?: string;
};

type SnapshotListResponse = {
  snapshots?: Array<Record<string, unknown>>;
};

type RestoreResponse = {
  restored?: boolean;
};

function toOptionalDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) return payload.message;
    } catch {
      // fall through
    }
  }

  try {
    const text = (await response.text()).trim();
    if (text) return text;
  } catch {
    // ignore
  }

  return "Request failed";
}

function parseDownloadFilename(response: Response, fallback: string): string {
  const header = response.headers.get("content-disposition") || "";
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const basicMatch = header.match(/filename="?([^"]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1];
  }

  return fallback;
}

class BackupService {
  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
  }

  private async downloadBackup(path: string, fallbackFilename: string): Promise<void> {
    const response = await authFetch(path, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const blob = await response.blob();
    const filename = parseDownloadFilename(response, fallbackFilename);

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private async uploadBackup(path: string, file: File): Promise<void> {
    const body = new FormData();
    body.set("file", file);

    const response = await authFetch(path, {
      method: "POST",
      body,
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as RestoreResponse;
      if (payload?.restored !== true) {
        throw new Error("Restore failed");
      }
    }
  }

  async getSnapshots(): Promise<BackupSnapshotEntry[]> {
    const payload = await this.requestJson<SnapshotListResponse>("/api/backups/snapshots", {
      method: "GET",
    });

    const rows = Array.isArray(payload?.snapshots) ? payload.snapshots : [];

    return rows.map((row) => ({
      id: String(row?.id || ""),
      feature: String(row?.feature || "").trim(),
      summary: String(row?.summary || "").trim() || undefined,
      scopeKey: String(row?.scopeKey || "").trim() || undefined,
      createdAt: toOptionalDate(row?.createdAt),
      createdBy: String(row?.createdBy || "").trim() || undefined,
    }));
  }

  async restoreSnapshot(snapshotId: string): Promise<void> {
    const payload = await this.requestJson<RestoreResponse>(
      `/api/backups/snapshots/${encodeURIComponent(snapshotId)}/restore`,
      { method: "POST" },
    );

    if (payload?.restored !== true) {
      throw new Error("Snapshot restore failed");
    }
  }

  async exportDatabaseBackup(): Promise<void> {
    await this.downloadBackup(
      "/api/backups/database/export",
      `mfag-database-${new Date().toISOString().slice(0, 10)}.sql.gz`,
    );
  }

  async importDatabaseBackup(file: File): Promise<void> {
    await this.uploadBackup("/api/backups/database/import", file);
  }

  async exportUploadedFilesBackup(): Promise<void> {
    await this.downloadBackup(
      "/api/backups/files/export",
      `mfag-uploaded-files-${new Date().toISOString().slice(0, 10)}.tar.gz`,
    );
  }

  async importUploadedFilesBackup(file: File): Promise<void> {
    await this.uploadBackup("/api/backups/files/import", file);
  }
}

export const backupService = new BackupService();
