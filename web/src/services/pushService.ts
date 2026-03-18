import { authJson } from "./authService";

type PushPublicKeyResponse = {
  publicKey?: string;
  configured?: boolean;
};

function readErrorText(error: unknown, key: "name" | "message"): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function isTransientPushInitializationError(error: unknown): boolean {
  const name = readErrorText(error, "name");
  const message = readErrorText(error, "message");

  return (
    name === "InvalidStateError" &&
    /push service initialization failed/i.test(message)
  );
}

function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const normalized = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

class PushService {
  private cachedPublicKey: string | null = null;
  private subscriptionSyncPromise: Promise<boolean> | null = null;
  private subscriptionSyncCanPrompt = false;

  private mapPermissionState(
    state: PermissionState | NotificationPermission
  ): NotificationPermission {
    if (state === "granted" || state === "denied") return state;
    return "default";
  }

  private async getPushManagerPermission(): Promise<NotificationPermission | null> {
    if (!this.isSupported()) return null;
    try {
      const registration = await navigator.serviceWorker.ready;
      const pushManagerApi = registration.pushManager;
      if (!pushManagerApi || typeof pushManagerApi.permissionState !== "function") return null;

      try {
        const withOptions = await pushManagerApi.permissionState({
          userVisibleOnly: true,
        });
        return this.mapPermissionState(withOptions);
      } catch {
        const withoutOptions = await pushManagerApi.permissionState();
        return this.mapPermissionState(withoutOptions);
      }
    } catch {
      return null;
    }
  }

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  getPermission(): NotificationPermission {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "denied";
    }
    return Notification.permission;
  }

  async getPermissionFresh(): Promise<NotificationPermission> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "denied";
    }

    let permission = this.mapPermissionState(Notification.permission);

    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({
          name: "notifications" as PermissionName,
        });
        permission = this.mapPermissionState(status.state);
      } catch {
        // fall through to other permission probes
      }
    }

    const pushManagerPermission = await this.getPushManagerPermission();
    if (
      pushManagerPermission === "granted" ||
      pushManagerPermission === "denied"
    ) {
      return pushManagerPermission;
    }

    return permission;
  }

  async hasBrowserSubscription(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      return Boolean(existing);
    } catch {
      return false;
    }
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    return authJson<T>(path, init, {
      defaultErrorMessage: "Push request failed",
      suppressUnauthorizedSignOut: true,
    });
  }

  private async getVapidPublicKey(): Promise<string> {
    if (this.cachedPublicKey) {
      return this.cachedPublicKey;
    }

    const fromEnv = String(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || "").trim();
    if (fromEnv) {
      this.cachedPublicKey = fromEnv;
      return fromEnv;
    }

    const payload = await this.requestJson<PushPublicKeyResponse>(
      "/api/notifications/push/public-key",
      { method: "GET" }
    );
    const key = String(payload.publicKey || "").trim();
    if (!key) {
      throw new Error("Web push public key is not configured");
    }

    this.cachedPublicKey = key;
    return key;
  }

  private async syncSubscriptionInternal(options?: {
    askPermission?: boolean;
  }): Promise<boolean> {
    const askPermission = Boolean(options?.askPermission);
    if (!this.isSupported()) return false;

    const registration = await navigator.serviceWorker.ready;
    let permission = await this.getPermissionFresh();
    if (permission === "default" && askPermission) {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      await this.unsubscribeCurrentDevice().catch(() => undefined);
      return false;
    }

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToArrayBuffer(await this.getVapidPublicKey()),
      }));

    const json = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };

    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      throw new Error("Browser returned invalid push subscription");
    }

    await this.requestJson<{ ok: boolean }>("/api/notifications/push-subscriptions", {
      method: "POST",
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: {
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        },
        contentEncoding: "aes128gcm",
      }),
    });

    return true;
  }

  async syncSubscription(options?: { askPermission?: boolean }): Promise<boolean> {
    const askPermission = Boolean(options?.askPermission);

    if (this.subscriptionSyncPromise) {
      if (!askPermission || this.subscriptionSyncCanPrompt) {
        return this.subscriptionSyncPromise;
      }

      try {
        await this.subscriptionSyncPromise;
      } catch {
        // Let the prompted retry run even if the background attempt failed.
      }
    }

    this.subscriptionSyncCanPrompt = askPermission;
    const syncPromise = this.syncSubscriptionInternal({ askPermission }).finally(() => {
      if (this.subscriptionSyncPromise === syncPromise) {
        this.subscriptionSyncPromise = null;
        this.subscriptionSyncCanPrompt = false;
      }
    });
    this.subscriptionSyncPromise = syncPromise;
    return syncPromise;
  }

  async unsubscribeCurrentDevice(): Promise<void> {
    if (!this.isSupported()) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (!existing) return;

    const endpoint = existing.endpoint;
    try {
      await this.requestJson<{ ok: boolean }>("/api/notifications/push-subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint }),
      });
    } catch {
      // continue with browser unsubscribe even if API call fails
    }

    await existing.unsubscribe();
  }
}

export const pushService = new PushService();
