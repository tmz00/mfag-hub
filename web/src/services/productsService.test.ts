import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
  getCaptchaAwareErrorMessage: (error: unknown, fallbackMessage: string) =>
    error instanceof Error && error.message.includes("https://mfag.sg")
      ? error.message
      : fallbackMessage,
}));

import { productsService } from "./productsService";

describe("productsService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
  });

  it("loads and normalizes product catalog metadata", async () => {
    authJsonMock.mockResolvedValue({
      gst: 9,
      types: {
        " regular ": " Regular ",
        " ": "ignore",
        rider: "   ",
      },
      basePlans: [
        { id: "bp1", category: " Savings " },
        { id: "bp2", category: "" },
        { id: "bp3", category: "Protection" },
        { id: "bp4", category: "Savings" },
      ],
      riders: [
        { id: "r1", category: " Accident " },
        { id: "r2", category: "Accident" },
        { id: "r3", category: " " },
      ],
    });

    const data = await productsService.getProducts();

    expect(data).toEqual({
      gst: 9,
      types: {
        regular: "Regular",
      },
      basePlans: [
        { id: "bp1", category: " Savings " },
        { id: "bp2", category: "" },
        { id: "bp3", category: "Protection" },
        { id: "bp4", category: "Savings" },
      ],
      riders: [
        { id: "r1", category: " Accident " },
        { id: "r2", category: "Accident" },
        { id: "r3", category: " " },
      ],
      basePlanCategories: ["Savings", "Protection"],
      riderCategories: ["Accident"],
    });

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/products",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("returns safe defaults when product payload has invalid arrays", async () => {
    authJsonMock.mockResolvedValue({
      types: [],
      basePlans: null,
      riders: undefined,
    });

    const data = await productsService.getProducts();

    expect(data).toEqual({
      types: undefined,
      basePlans: [],
      riders: [],
      basePlanCategories: [],
      riderCategories: [],
    });
  });

  it("saves normalized products payload", async () => {
    authJsonMock.mockResolvedValue({ saved: true });

    await productsService.setProducts({
      gst: 8,
      types: {
        " regular ": " Regular ",
        " ": "ignore",
        rider: "",
      },
      basePlans: null as unknown as Array<{ id: string }>,
      riders: [{ id: "r1", category: "Protection" }],
    }, "Edit GST / Type Definitions");

    expect(authJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = authJsonMock.mock.calls[0] as [
      string,
      { method: string; body: string },
      { defaultErrorMessage: string },
    ];

    expect(path).toBe("/api/products");
    expect(init.method).toBe("PUT");
    expect(options).toEqual({ defaultErrorMessage: "Request failed" });
    expect(JSON.parse(init.body)).toEqual({
      gst: 8,
      types: {
        regular: "Regular",
      },
      basePlans: [],
      riders: [{ id: "r1", category: "Protection" }],
      snapshotTitle: "Edit GST / Type Definitions",
    });
  });

  it("returns empty backups, restores via setProducts, and resolves delete", async () => {
    authJsonMock.mockResolvedValue({ saved: true });

    await expect(productsService.getBackups()).resolves.toEqual([]);
    await expect(productsService.deleteBackup("backup-1")).resolves.toBeUndefined();

    await productsService.restoreFromBackup({
      id: "backup-1",
      data: {
        gst: 9,
        types: { savings: "Savings" },
        basePlans: [{ id: "bp1" }],
        riders: [],
      },
    });

    const [path, init] = authJsonMock.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(path).toBe("/api/products");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      gst: 9,
      types: { savings: "Savings" },
      basePlans: [{ id: "bp1" }],
      riders: [],
      snapshotTitle: "Manage Products Backups",
    });
  });
});
