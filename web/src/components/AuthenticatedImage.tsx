import {
  Component,
  JSX,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";

import {
  fetchHandbookFile,
  isHandbookApiFileUrl,
  resolveHandbookFileUrl,
} from "../services/handbookFilesService";

type Props = JSX.ImgHTMLAttributes<HTMLImageElement>;

type CachedHandbookImage = {
  objectUrl: string;
  expiresAt: number;
  lastUsedAt: number;
};

const HANDBOOK_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const HANDBOOK_IMAGE_CACHE_MAX_ENTRIES = 120;
const handbookImageCache = new Map<string, CachedHandbookImage>();
const pendingHandbookImageRequests = new Map<string, Promise<string>>();

const canCreateObjectUrl = (): boolean =>
  typeof window !== "undefined"
  && typeof window.URL?.createObjectURL === "function"
  && typeof window.URL?.revokeObjectURL === "function";

const revokeObjectUrl = (url: string) => {
  if (!url || !canCreateObjectUrl()) {
    return;
  }

  window.URL.revokeObjectURL(url);
};

const removeCachedHandbookImage = (cacheKey: string) => {
  const existing = handbookImageCache.get(cacheKey);
  if (!existing) {
    return;
  }

  handbookImageCache.delete(cacheKey);
  revokeObjectUrl(existing.objectUrl);
};

const pruneHandbookImageCache = () => {
  const now = Date.now();

  for (const [cacheKey, entry] of handbookImageCache.entries()) {
    if (entry.expiresAt <= now) {
      removeCachedHandbookImage(cacheKey);
    }
  }

  if (handbookImageCache.size <= HANDBOOK_IMAGE_CACHE_MAX_ENTRIES) {
    return;
  }

  const lruEntries = [...handbookImageCache.entries()].sort(
    (a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
  );

  for (const [cacheKey] of lruEntries) {
    if (handbookImageCache.size <= HANDBOOK_IMAGE_CACHE_MAX_ENTRIES) {
      break;
    }

    removeCachedHandbookImage(cacheKey);
  }
};

const getCachedHandbookImageObjectUrl = (source: string): string | null => {
  const cacheKey = resolveHandbookFileUrl(source);
  const now = Date.now();
  const entry = handbookImageCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= now) {
    removeCachedHandbookImage(cacheKey);
    return null;
  }

  entry.lastUsedAt = now;
  entry.expiresAt = now + HANDBOOK_IMAGE_CACHE_TTL_MS;
  handbookImageCache.set(cacheKey, entry);
  return entry.objectUrl;
};

const setCachedHandbookImageObjectUrl = (source: string, objectUrl: string) => {
  const cacheKey = resolveHandbookFileUrl(source);
  const now = Date.now();
  const existing = handbookImageCache.get(cacheKey);

  if (existing && existing.objectUrl !== objectUrl) {
    revokeObjectUrl(existing.objectUrl);
  }

  handbookImageCache.set(cacheKey, {
    objectUrl,
    expiresAt: now + HANDBOOK_IMAGE_CACHE_TTL_MS,
    lastUsedAt: now,
  });

  pruneHandbookImageCache();
};

const fetchHandbookImageObjectUrl = async (source: string): Promise<string> => {
  const cacheKey = resolveHandbookFileUrl(source);
  const cachedObjectUrl = getCachedHandbookImageObjectUrl(cacheKey);
  if (cachedObjectUrl) {
    return cachedObjectUrl;
  }

  const inFlightRequest = pendingHandbookImageRequests.get(cacheKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const request = (async () => {
    const response = await fetchHandbookFile(cacheKey);
    if (!response.ok) {
      throw new Error(`Unable to load image (${response.status})`);
    }

    const blob = await response.blob();
    if (!canCreateObjectUrl()) {
      throw new Error("Object URLs are unavailable");
    }

    const objectUrl = window.URL.createObjectURL(blob);
    setCachedHandbookImageObjectUrl(cacheKey, objectUrl);
    return objectUrl;
  })();

  pendingHandbookImageRequests.set(cacheKey, request);

  try {
    return await request;
  } finally {
    pendingHandbookImageRequests.delete(cacheKey);
  }
};

export const AuthenticatedImage: Component<Props> = (props) => {
  const normalizedSrc = createMemo(() => String(props.src || "").trim());
  const initialResolvedSrc = (() => {
    const initialSource = normalizedSrc();
    if (!initialSource) {
      return "";
    }

    if (!isHandbookApiFileUrl(initialSource) || !canCreateObjectUrl()) {
      return initialSource;
    }

    return getCachedHandbookImageObjectUrl(initialSource) || "";
  })();
  const [resolvedSrc, setResolvedSrc] = createSignal(initialResolvedSrc);
  let activeSource = "";
  let requestVersion = 0;

  createEffect(() => {
    const source = normalizedSrc();
    if (source === activeSource) {
      return;
    }

    activeSource = source;
    requestVersion += 1;
    const currentRequest = requestVersion;

    if (!source) {
      setResolvedSrc("");
      return;
    }

    if (!isHandbookApiFileUrl(source)) {
      setResolvedSrc(source);
      return;
    }

    if (!canCreateObjectUrl()) {
      setResolvedSrc(source);
      return;
    }

    const cachedObjectUrl = getCachedHandbookImageObjectUrl(source);
    if (cachedObjectUrl) {
      setResolvedSrc(cachedObjectUrl);
      return;
    }

    setResolvedSrc("");

    void (async () => {
      try {
        const objectUrl = await fetchHandbookImageObjectUrl(source);
        if (currentRequest !== requestVersion || source !== activeSource) {
          return;
        }

        setResolvedSrc(objectUrl);
      } catch {
        if (currentRequest !== requestVersion || source !== activeSource) {
          return;
        }

        setResolvedSrc("");
      }
    })();
  });

  onCleanup(() => {
    requestVersion += 1;
  });

  return (
    <Show when={resolvedSrc()}>
      {(src) => <img {...props} src={src()} />}
    </Show>
  );
};
