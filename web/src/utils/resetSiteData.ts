type IndexedDbFactoryWithDatabases = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string | null }>>;
};

function clearCurrentOriginCookies(): void {
  if (typeof document === "undefined") return;

  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const cookie of cookies) {
    const name = cookie.split("=")[0]?.trim();
    if (!name) continue;

    // Best-effort cookie deletion for the current origin.
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

async function clearServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(registrations.map((registration) => registration.unregister()));
  } catch {
    // no-op
  }
}

async function clearCacheStorage(): Promise<void> {
  if (typeof caches === "undefined") return;

  try {
    const keys = await caches.keys();
    await Promise.allSettled(keys.map((key) => caches.delete(key)));
  } catch {
    // no-op
  }
}

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearIndexedDbDatabases(): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const idb = indexedDB as IndexedDbFactoryWithDatabases;
  if (typeof idb.databases !== "function") return;

  try {
    const databases = await idb.databases();
    const jobs: Promise<void>[] = [];

    for (const entry of databases) {
      const name = String(entry?.name ?? "").trim();
      if (!name) continue;
      jobs.push(deleteIndexedDb(name));
    }

    await Promise.allSettled(jobs);
  } catch {
    // no-op
  }
}

/**
 * Best-effort reset for this app's current origin.
 * Browsers do not allow frontend JS to reliably clear another origin's full site data.
 */
export async function resetCurrentOriginSiteData(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    // no-op
  }

  try {
    sessionStorage.clear();
  } catch {
    // no-op
  }

  clearCurrentOriginCookies();

  await Promise.allSettled([
    clearServiceWorkers(),
    clearCacheStorage(),
    clearIndexedDbDatabases(),
  ]);
}
