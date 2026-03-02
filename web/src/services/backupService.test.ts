import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock, authFetchMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
  authFetchMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

import { backupService } from "./backupService";

describe("backupService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
    authFetchMock.mockReset();
  });

  it("normalizes snapshot entries from the wrapped API payload", async () => {
    authJsonMock.mockResolvedValue({
      snapshots: [
        {
          id: 7,
          feature: " handbook ",
          summary: " Restore handbook ",
          scopeKey: " 2026-02 ",
          createdAt: "2026-02-14T09:30:00.000Z",
          createdBy: " Editor ",
        },
        {
          id: null,
          feature: null,
          createdAt: "invalid-date",
          createdBy: " ",
        },
      ],
    });

    const snapshots = await backupService.getSnapshots();

    expect(snapshots).toEqual([
      {
        id: "7",
        feature: "handbook",
        summary: "Restore handbook",
        scopeKey: "2026-02",
        createdAt: new Date("2026-02-14T09:30:00.000Z"),
        createdBy: "Editor",
      },
      {
        id: "",
        feature: "",
        summary: undefined,
        scopeKey: undefined,
        createdAt: undefined,
        createdBy: undefined,
      },
    ]);
    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/backups/snapshots",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("encodes snapshot ids and rejects incomplete restore responses", async () => {
    authJsonMock.mockResolvedValue({ restored: false });

    await expect(backupService.restoreSnapshot("snapshot/2026-02")).rejects.toThrow(
      "Snapshot restore failed",
    );

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/backups/snapshots/snapshot%2F2026-02/restore",
      { method: "POST" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("downloads backups using the content-disposition filename", async () => {
    const originalCreateObjectURL = (
      URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }
    ).createObjectURL;
    const originalRevokeObjectURL = (
      URL as typeof URL & { revokeObjectURL?: typeof URL.revokeObjectURL }
    ).revokeObjectURL;
    const createObjectURLMock = vi.fn(() => "blob:backup-download");
    const revokeObjectURLMock = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURLMock,
    });

    const appendSpy = vi.spyOn(document.body, "appendChild");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    authFetchMock.mockResolvedValue(
      new Response(new Blob(["backup"], { type: "application/gzip" }), {
        status: 200,
        headers: {
          "Content-Disposition":
            "attachment; filename*=UTF-8''custom%20backup.sql.gz",
        },
      }),
    );

    try {
      await backupService.exportDatabaseBackup();
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    }

    expect(authFetchMock).toHaveBeenCalledWith("/api/backups/database/export", {
      method: "POST",
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:backup-download");

    const link = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement | undefined;
    expect(link).toBeInstanceOf(HTMLAnchorElement);
    expect(link?.download).toBe("custom backup.sql.gz");
    expect(link?.href).toBe("blob:backup-download");
  });

  it("uploads database backups as form data and validates restore responses", async () => {
    const file = new File(["backup"], "mfag.sql.gz", {
      type: "application/gzip",
    });

    authFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ restored: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await backupService.importDatabaseBackup(file);

    const [path, init] = authFetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/backups/database/import");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);

    authFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ restored: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(backupService.importDatabaseBackup(file)).rejects.toThrow(
      "Restore failed",
    );
  });
});
