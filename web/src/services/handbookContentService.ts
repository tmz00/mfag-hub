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

type GetHandbookEntriesOptions = {
  forceRefresh?: boolean;
};

const HANDBOOK_CONTENT_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedHandbookEntries: HandbookEntry[] | null = null;
let handbookEntriesCacheExpiresAt = 0;
let pendingHandbookEntriesRequest: Promise<HandbookEntry[]> | null = null;

async function requestJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  return authJson<T>(path, init, { defaultErrorMessage: "Request failed" });
}

const cloneHandbookEntries = (entries: HandbookEntry[]): HandbookEntry[] =>
  entries.map((entry) => ({ ...entry }));

const setCachedHandbookEntries = (entries: HandbookEntry[]) => {
  cachedHandbookEntries = cloneHandbookEntries(entries);
  handbookEntriesCacheExpiresAt = Date.now() + HANDBOOK_CONTENT_CACHE_TTL_MS;
};

export function clearHandbookEntriesCache(): void {
  cachedHandbookEntries = null;
  handbookEntriesCacheExpiresAt = 0;
  pendingHandbookEntriesRequest = null;
}

export async function getHandbookEntries(
  options: GetHandbookEntriesOptions = {},
): Promise<HandbookEntry[]> {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();

  if (
    !forceRefresh
    && cachedHandbookEntries
    && handbookEntriesCacheExpiresAt > now
  ) {
    return cloneHandbookEntries(cachedHandbookEntries);
  }

  if (!forceRefresh && pendingHandbookEntriesRequest) {
    const sharedResult = await pendingHandbookEntriesRequest;
    return cloneHandbookEntries(sharedResult);
  }

  const request = (async () => {
    const data = await requestJson<HandbookContentResponse>("/api/handbook/content", {
      method: "GET",
    });
    const entries = Array.isArray(data.payload) ? data.payload : [];
    setCachedHandbookEntries(entries);
    return cloneHandbookEntries(entries);
  })();

  pendingHandbookEntriesRequest = request;

  try {
    const result = await request;
    return cloneHandbookEntries(result);
  } finally {
    if (pendingHandbookEntriesRequest === request) {
      pendingHandbookEntriesRequest = null;
    }
  }
}

export async function saveHandbookEntries(entries: HandbookEntry[]): Promise<void> {
  await requestJson<{ success: boolean }>("/api/handbook/content", {
    method: "PUT",
    body: JSON.stringify({ payload: entries }),
  });
  setCachedHandbookEntries(entries);
}
