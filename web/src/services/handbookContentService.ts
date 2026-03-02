import { authJson } from "./authService";

export type HandbookEntry = {
  id?: number;
  category?: string;
  content?: string;
  imageUrl?: string;
  imagePath?: string;
  updatedBy?: string;
  updatedAt?: string;
};

type HandbookContentResponse = {
  name: string;
  payload: HandbookEntry[];
  updatedAt: string | null;
};

async function requestJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
}

export async function getHandbookEntries(): Promise<HandbookEntry[]> {
  const data = await requestJson<HandbookContentResponse>("/api/handbook/content", {
    method: "GET",
  });
  return Array.isArray(data.payload) ? data.payload : [];
}

export async function saveHandbookEntries(entries: HandbookEntry[]): Promise<void> {
  await requestJson<{ success: boolean }>("/api/handbook/content", {
    method: "PUT",
    body: JSON.stringify({ payload: entries }),
  });
}
