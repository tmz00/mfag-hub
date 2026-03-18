import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock, getSubscriptionMock, permissionStateMock, subscribeMock } =
  vi.hoisted(() => ({
    authJsonMock: vi.fn(),
    getSubscriptionMock: vi.fn(),
    permissionStateMock: vi.fn(),
    subscribeMock: vi.fn(),
  }));

vi.mock("./authService", () => ({
  authJson: authJsonMock,
}));

import { isTransientPushInitializationError, pushService } from "./pushService";

type ServiceWorkerReadyStub = {
  ready: Promise<{
    pushManager: {
      getSubscription: ReturnType<typeof vi.fn>;
      permissionState: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
    };
  }>;
};

describe("pushService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
    getSubscriptionMock.mockReset();
    permissionStateMock.mockReset();
    subscribeMock.mockReset();
    (pushService as unknown as { cachedPublicKey: string | null }).cachedPublicKey = null;
    (
      pushService as unknown as {
        subscriptionSyncPromise: Promise<boolean> | null;
        subscriptionSyncCanPrompt: boolean;
      }
    ).subscriptionSyncPromise = null;
    (
      pushService as unknown as {
        subscriptionSyncPromise: Promise<boolean> | null;
        subscriptionSyncCanPrompt: boolean;
      }
    ).subscriptionSyncCanPrompt = false;

    Object.defineProperty(window, "PushManager", {
      value: function PushManager() {},
      configurable: true,
    });
    Object.defineProperty(window, "Notification", {
      value: { permission: "granted" satisfies NotificationPermission },
      configurable: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: getSubscriptionMock,
            permissionState: permissionStateMock,
            subscribe: subscribeMock,
          },
        }),
      } satisfies ServiceWorkerReadyStub,
      configurable: true,
    });
  });

  it("detects Safari push initialization failures", () => {
    expect(
      isTransientPushInitializationError(
        new DOMException(
          "Push service initialization failed",
          "InvalidStateError",
        ),
      ),
    ).toBe(true);

    expect(
      isTransientPushInitializationError(
        new DOMException("Operation is not allowed", "InvalidStateError"),
      ),
    ).toBe(false);
  });

  it("reports an existing browser subscription", async () => {
    getSubscriptionMock.mockResolvedValue({ endpoint: "https://example.test/push" });

    await expect(pushService.hasBrowserSubscription()).resolves.toBe(true);
  });

  it("returns false when the push manager is temporarily unavailable", async () => {
    getSubscriptionMock.mockRejectedValue(
      new DOMException(
        "Push service initialization failed",
        "InvalidStateError",
      ),
    );

    await expect(pushService.hasBrowserSubscription()).resolves.toBe(false);
  });

  it("reuses the in-flight subscription sync instead of subscribing twice", async () => {
    let resolveSync: ((value: boolean) => void) | null = null;
    const syncPromise = new Promise<boolean>((resolve) => {
      resolveSync = resolve;
    });
    const internalSpy = vi
      .spyOn(
        pushService as unknown as {
          syncSubscriptionInternal: (options?: { askPermission?: boolean }) => Promise<boolean>;
        },
        "syncSubscriptionInternal",
      )
      .mockReturnValue(syncPromise);

    const first = pushService.syncSubscription({ askPermission: false });
    const second = pushService.syncSubscription({ askPermission: false });

    expect(internalSpy).toHaveBeenCalledTimes(1);
    resolveSync?.(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(internalSpy).toHaveBeenCalledTimes(1);
  });
});
