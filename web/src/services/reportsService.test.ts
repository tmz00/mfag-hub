import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock, authFetchMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
  authFetchMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

import { reportsService } from "./reportsService";

describe("reportsService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
    authFetchMock.mockReset();
  });

  it("loads reports from wrapped API payload", async () => {
    authJsonMock.mockResolvedValue({
      reports: [
        {
          id: 1,
          title: "Top Stats",
          filenameTemplate: "{YYYYMMDD}_District_TOP",
          tableGap: 15,
          tableWidth: 170,
          indexTableWidth: 46,
          includeIndexTable: true,
          single_table: true,
          tables: [
            {
              id: 10,
              titleLines: ["Case Count"],
              valueLabel: "Cases",
              includeFooterTotalRow: true,
              metric: { type: "countCases" },
            },
          ],
        },
      ],
    });

    const reports = await reportsService.getReports();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.id).toBe(1);
    expect(reports[0]?.singleTable).toBe(true);
    expect(reports[0]?.tables[0]?.includeFooterTotalRow).toBe(true);
    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/reports",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("parses stringified wrapped payloads and ignores malformed entries", async () => {
    authJsonMock.mockResolvedValue({
      reports: JSON.stringify([
        {
          id: 2,
          title: "Serialized Report",
          filenameTemplate: "{YYYYMMDD}_Serialized",
          tableGap: 12,
          tableWidth: 160,
          indexTableWidth: 40,
          includeIndexTable: true,
          tables: [],
        },
        {
          title: "Missing Id",
          filenameTemplate: "ignored",
          tableGap: 0,
          tableWidth: 0,
          indexTableWidth: 0,
          includeIndexTable: false,
          tables: [],
        },
      ]),
    });

    const reports = await reportsService.getReports();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.id).toBe(2);
  });

  it("normalizes removed metric types to case count", async () => {
    authJsonMock.mockResolvedValue({
      reports: [
        {
          id: 5,
          title: "Normalized Report",
          filenameTemplate: "{YYYYMMDD}_Normalized",
          tableGap: 15,
          tableWidth: 170,
          indexTableWidth: 46,
          includeIndexTable: true,
          tables: [
            {
              id: 10,
              titleLines: ["Legacy Metric"],
              valueLabel: "Value",
              metric: { type: "referralsClosed" },
            },
            {
              id: 11,
              titleLines: ["Legacy Field"],
              valueLabel: "Value",
              metric: { type: "field", field: "stats.value" },
            },
          ],
        },
      ],
    });

    const reports = await reportsService.getReports();

    expect(reports[0]?.tables[0]?.metric).toEqual({ type: "countClosings" });
    expect(reports[0]?.tables[1]?.metric).toEqual({ type: "countClosings" });
  });

  it("accepts legacy array payload response", async () => {
    authJsonMock.mockResolvedValue([
      {
        id: 3,
        title: "Legacy Report",
        filenameTemplate: "legacy",
        tableGap: 0,
        tableWidth: 0,
        indexTableWidth: 0,
        includeIndexTable: false,
        tables: [],
      },
    ]);

    const reports = await reportsService.getReports();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.id).toBe(3);
  });

  it("saves reports through the new API endpoint", async () => {
    authJsonMock.mockResolvedValue({ saved: true });

    await reportsService.setReports([
      {
        id: 4,
        title: "Monthly Summary",
        filenameTemplate: "{YYYYMM}_summary",
        tableGap: 10,
        tableWidth: 140,
        indexTableWidth: 40,
        includeIndexTable: true,
        tables: [],
      },
    ]);

    expect(authJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = authJsonMock.mock.calls[0] as [
      string,
      { method: string; body: string },
      { defaultErrorMessage: string },
    ];

    expect(path).toBe("/api/reports");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      reports: [
        {
          id: 4,
          title: "Monthly Summary",
          filenameTemplate: "{YYYYMM}_summary",
          tableGap: 10,
          tableWidth: 140,
          indexTableWidth: 40,
          includeIndexTable: true,
          tables: [],
        },
      ],
    });
    expect(options).toEqual({ defaultErrorMessage: "Request failed" });
  });

  it("loads backups, restores via setReports, and deletes backups", async () => {
    authJsonMock.mockResolvedValueOnce({
      backups: [
        {
          id: "backup-1",
          data: [
            {
              id: 1,
              title: "Top Stats",
              filenameTemplate: "{YYYYMMDD}_District_TOP",
              tableGap: 15,
              tableWidth: 170,
              indexTableWidth: 46,
              includeIndexTable: true,
              tables: [],
            },
          ],
          createdAt: "2026-02-01T10:00:00.000Z",
          expiresAt: "2026-05-01T10:00:00.000Z",
        },
      ],
    });

    const backups = await reportsService.getBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]?.id).toBe("backup-1");
    expect(backups[0]?.createdAt).toBeInstanceOf(Date);

    authJsonMock.mockResolvedValue({ saved: true });
    await reportsService.restoreFromBackup({
      id: "backup-1",
      data: backups[0]?.data || [],
    });

    const restoreCall = authJsonMock.mock.calls.find(
      (call) => call[0] === "/api/reports" && call[1]?.method === "PUT",
    );
    expect(restoreCall).toBeTruthy();

    authJsonMock.mockResolvedValue({ deleted: true });
    await reportsService.deleteBackup("backup-1");
    expect(authJsonMock).toHaveBeenLastCalledWith(
      "/api/reports/backups/backup-1",
      { method: "DELETE" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("loads the default report logo from backend", async () => {
    const originalCreateObjectURL = (
      URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }
    ).createObjectURL;
    const createObjectUrlMock = vi.fn(() => "blob:report-logo-default");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock,
    });

    const blob = new Blob(["logo"], { type: "image/png" });
    authFetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: vi.fn((name: string) =>
          name.toLowerCase() === "x-report-logo-source" ? "default" : null,
        ),
      },
      blob: vi.fn().mockResolvedValue(blob),
    });

    const logo = await reportsService.getReportLogoAsset();

    expect(logo).toEqual({
      src: "blob:report-logo-default",
      isCustom: false,
    });
    expect(authFetchMock).toHaveBeenCalledWith("/api/reports/logo", {
      method: "GET",
    });

    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
    } else {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("loads, uploads, and deletes a custom report logo", async () => {
    const originalCreateObjectURL = (
      URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }
    ).createObjectURL;
    const createObjectUrlMock = vi.fn(() => "blob:report-logo");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock,
    });

    const blob = new Blob(["logo"], { type: "image/png" });
    authFetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: {
        get: vi.fn((name: string) =>
          name.toLowerCase() === "x-report-logo-source" ? "custom" : null,
        ),
      },
      blob: vi.fn().mockResolvedValue(blob),
    });

    const logo = await reportsService.getReportLogoAsset();
    expect(logo).toEqual({
      src: "blob:report-logo",
      isCustom: true,
    });

    authFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({
        json: vi.fn().mockResolvedValue({}),
      }),
    });

    await reportsService.uploadReportLogo(
      new File(["logo"], "logo.png", { type: "image/png" }),
    );

    const uploadCall = authFetchMock.mock.calls[1] as [
      string,
      { method: string; body: FormData },
    ];
    expect(uploadCall[0]).toBe("/api/reports/logo");
    expect(uploadCall[1].method).toBe("POST");
    expect(uploadCall[1].body).toBeInstanceOf(FormData);

    authFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({
        json: vi.fn().mockResolvedValue({}),
      }),
    });

    await reportsService.deleteReportLogo();
    expect(authFetchMock).toHaveBeenLastCalledWith(
      "/api/reports/logo",
      { method: "DELETE" },
    );

    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
    } else {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("requests backend report PDF generation", async () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    authFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(blob),
    });

    const result = await reportsService.generateReportPdf({
      filename: "sample.pdf",
      reportDate: "2026-02-14T00:00:00.000Z",
      reportRangeLabel: "01 Feb 2026 - 14 Feb 2026",
      maxRows: 1,
      report: {
        id: 1,
        title: "Sample",
        filenameTemplate: "{YYYYMMDD}_Sample",
        tableGap: 15,
        tableWidth: 170,
        indexTableWidth: 46,
        includeIndexTable: true,
        tables: [],
      },
      tables: [
        {
          id: 10,
          titleLines: ["TOP ADVISER"],
          valueLabel: "FYC ($)",
          metric: { type: "fyc" },
          rows: [{ key: "A123", name: "Alex Tan", value: 1234.56 }],
        },
      ],
    });

    expect(result).toBe(blob);
    expect(authFetchMock).toHaveBeenCalledWith("/api/reports/render-pdf", {
      method: "POST",
      body: expect.any(String),
    });
  });
});
