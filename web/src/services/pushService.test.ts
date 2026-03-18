import { beforeEach, describe, expect, it, vi } from "vitest";

import { isTransientPushInitializationError, pushService } from "./pushService";

type ServiceWorkerReadyStub = {
  ready: Promise<{
    pushManager: {
      getSubscription: ReturnType<typeof vi.fn>;
    };
  }>;
};

const { getSubscriptionMock } = vi.hoisted(() => ({
  getSubscriptionMock: vi.fn(),
}));

describe("pushService", () => {
  beforeEach(() => {
    getSubscriptionMock.mockReset();

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
});
