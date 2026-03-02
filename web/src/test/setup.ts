import { cleanup } from "@solidjs/testing-library";
import { afterEach, vi } from "vitest";

if (typeof ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // Solid UI modals use ResizeObserver; provide a lightweight test stub.
  (globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserverMock })
    .ResizeObserver = ResizeObserverMock;
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    value: () => {},
    writable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
