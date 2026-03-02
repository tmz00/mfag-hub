import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
}));

import { sourcesService } from "./sourcesService";

describe("sourcesService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
  });

  it("loads and normalizes sources with valid children only", async () => {
    authJsonMock.mockResolvedValue({
      sources: [
        {
          id: "  warm ",
          label: " Warm ",
          description: "desc",
          children: [
            { id: " a ", label: " A " },
            { id: " legacy ", label: " Legacy ", isDeleted: true },
            { id: "", label: "Invalid" },
            { id: "b", label: "" },
          ],
        },
        {
          id: "missing-label",
          label: "",
          children: [],
        },
      ],
    });

    const data = await sourcesService.getSources();

    expect(data).toEqual([
      {
        id: "warm",
        label: "Warm",
        description: "desc",
        children: [
          { id: "a", label: "A" },
          { id: "legacy", label: "Legacy", isDeleted: true },
        ],
      },
    ]);
    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/sources",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("returns empty list when backend payload is not an array", async () => {
    authJsonMock.mockResolvedValue({ sources: null });

    const data = await sourcesService.getSources();

    expect(data).toEqual([]);
  });

  it("can request deleted source items for legacy reporting", async () => {
    authJsonMock.mockResolvedValue({ sources: [] });

    await sourcesService.getSources({ includeDeletedItems: true });

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/sources?includeDeletedItems=1",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("saves normalized sources payload and keeps new child items without ids", async () => {
    authJsonMock.mockResolvedValue({ saved: true });

    await sourcesService.saveSources([
      {
        id: "  referral ",
        label: " Referral ",
        description: "  keep spacing  ",
        children: [
          { id: " x ", label: " X " },
          { id: "", label: "invalid" },
        ],
      },
      {
        id: "",
        label: "Missing ID",
        children: [],
      },
    ]);

    expect(authJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = authJsonMock.mock.calls[0] as [
      string,
      { method: string; body: string },
      { defaultErrorMessage: string },
    ];
    expect(path).toBe("/api/sources");
    expect(init.method).toBe("PUT");
    expect(options).toEqual({ defaultErrorMessage: "Request failed" });
    expect(JSON.parse(init.body)).toEqual({
      sources: [
        {
          id: "referral",
          label: "Referral",
          description: "  keep spacing  ",
          children: [
            { id: "x", label: "X" },
            { id: "", label: "invalid" },
          ],
        },
      ],
    });
  });

  it("writes an empty payload when saving non-array input", async () => {
    authJsonMock.mockResolvedValue({ saved: true });

    await sourcesService.saveSources(
      null as unknown as Parameters<typeof sourcesService.saveSources>[0],
    );

    const [, init] = authJsonMock.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(JSON.parse(init.body)).toEqual({ sources: [] });
  });

  it("returns empty backups, rejects restore, and resolves delete", async () => {
    await expect(sourcesService.getBackups()).resolves.toEqual([]);
    await expect(sourcesService.deleteBackup("id-1")).resolves.toBeUndefined();
    await expect(sourcesService.restoreBackup("id-1")).rejects.toThrow(
      "Sources backups are not supported",
    );
  });
});
