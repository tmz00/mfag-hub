import { API_BASE, authFetch, authJson } from "./authService";

export type HandbookUploadedFile = {
  id: number;
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  url: string;
};

const handbookFileUrlPattern = /\/api\/handbook\/file\/\d+$/;

const toFileUrl = (id: number, name?: string): string => {
  const baseUrl = `${API_BASE}/api/handbook/file/${id}`;
  const normalizedName = String(name || "").trim();

  if (!normalizedName) {
    return baseUrl;
  }

  return `${baseUrl}?name=${encodeURIComponent(normalizedName)}`;
};

const toHandbookFilePath = (url: string): string | null => {
  const candidate = String(url || "").trim();
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate, "http://localhost");
    if (!handbookFileUrlPattern.test(parsed.pathname)) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

export function isHandbookApiFileUrl(url: string): boolean {
  return toHandbookFilePath(url) !== null;
}

export function resolveHandbookFileUrl(url: string): string {
  const path = toHandbookFilePath(url);
  if (!path) {
    return String(url || "").trim();
  }

  return API_BASE ? `${API_BASE}${path}` : path;
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
}

export async function uploadHandbookFile(file: File): Promise<HandbookUploadedFile> {
  const formData = new FormData();
  formData.append("file", file);

  const payload = await authJson<any>("/api/handbook/upload", {
    method: "POST",
    body: formData,
  }, { defaultErrorMessage: "Upload failed" });

  return {
    id: Number(payload.id || 0),
    path: String(payload.path || ""),
    name: String(payload.name || file.name || "file"),
    sizeBytes: Number(payload.sizeBytes || file.size || 0),
    mimeType: String(payload.mimeType || file.type || "application/octet-stream"),
    url: toFileUrl(
      Number(payload.id || 0),
      String(payload.name || file.name || "file"),
    ),
  };
}

export async function deleteHandbookFileById(id: number): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/handbook/file/${id}`, {
    method: "DELETE",
  });
}

export async function deleteHandbookFileByPath(path: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/handbook/file`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path }),
  });
}

export async function fetchHandbookFile(url: string): Promise<Response> {
  return authFetch(resolveHandbookFileUrl(url), { method: "GET" });
}
