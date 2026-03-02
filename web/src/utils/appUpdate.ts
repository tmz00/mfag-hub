const UPDATE_TIMEOUT_MS = 8000;

const waitForControllerChange = (timeoutMs = UPDATE_TIMEOUT_MS) =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: number | undefined;

    const onControllerChange = () => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      resolve(true);
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      resolve(false);
    }, timeoutMs);
  });

const waitForWaitingWorker = (
  registration: ServiceWorkerRegistration,
  timeoutMs = UPDATE_TIMEOUT_MS,
) =>
  new Promise<ServiceWorker | null>((resolve) => {
    if (registration.waiting) {
      resolve(registration.waiting);
      return;
    }

    const installing = registration.installing;
    if (!installing) {
      resolve(null);
      return;
    }

    let settled = false;
    let timeoutId: number | undefined;
    const finish = (worker: ServiceWorker | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      installing.removeEventListener("statechange", onStateChange);
      resolve(worker);
    };

    const onStateChange = () => {
      if (registration.waiting) {
        finish(registration.waiting);
        return;
      }
      if (installing.state === "redundant") {
        finish(null);
      }
    };

    installing.addEventListener("statechange", onStateChange);
    timeoutId = window.setTimeout(() => finish(registration.waiting ?? null), timeoutMs);
    onStateChange();
  });

export async function checkForAppUpdateAndReload() {
  if (typeof window === "undefined") return;

  if (!("serviceWorker" in navigator)) {
    window.location.reload();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      window.location.reload();
      return;
    }

    await registration.update();
    const waitingWorker =
      registration.waiting ?? (await waitForWaitingWorker(registration));

    if (registration.active && waitingWorker) {
      const controllerChanged = waitForControllerChange();
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      if (await controllerChanged) {
        window.location.reload();
        return;
      }
    }
  } catch {
    // Fallback to plain reload when update check fails.
  }

  window.location.reload();
}
