import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildReportCanvas, type RenderTable } from "./reportExport";

function createContext(fillTextMock: ReturnType<typeof vi.fn>) {
  return {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    measureText: (text: string) =>
      ({ width: text.length * 6 } as TextMetrics),
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: fillTextMock,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("reportExport", () => {
  let fillTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fillTextMock = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      return createContext(fillTextMock);
    });
  });

  it("renders a report canvas with formatted values and templated footnotes", () => {
    const tables: RenderTable[] = [
      {
        id: 6,
        titleLines: ["TOP ROOKIE"],
        valueLabel: "FYC ($)",
        minValue: 1000,
        highlightMin: true,
        includeAllAgencies: true,
        includeAllAdvisors: false,
        rookieFilter: "rookies",
        rookieYears: 2,
        showIndex: true,
        metric: { type: "fyc" },
        footnote: "Rookie from {YYYY}",
        rows: [{ name: "Alice", value: 1234.5 }],
      },
    ];

    const result = buildReportCanvas({
      report: {
        id: 4,
        title: "Monthly Winners",
        filenameTemplate: "{YYYYMMDD}_Monthly_Winners",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "Generated {YYYYMMDD}",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables,
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    expect(result).not.toBeNull();
    expect(result?.width).toBeGreaterThan(0);
    expect(result?.height).toBeGreaterThan(0);
    expect(result?.height).toBe(396);

    const drawText = fillTextMock.mock.calls.map((call) => call[0]);
    expect(drawText).toContain("Monthly Winners");
    expect(drawText).toContain("1,234.50");
    expect(drawText).toContain("Rookie from 2025");
    expect(drawText).toContain("Generated 20260215");

    const rookieFootnoteCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "Rookie from 2025",
    );
    const bottomFootnoteCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "Generated 20260215",
    );

    expect(rookieFootnoteCall?.[2]).toBe(320);
    expect(bottomFootnoteCall?.[1]).toBe(130);
    expect(bottomFootnoteCall?.[2]).toBe(358);
  });

  it("preserves half-case values for count metrics", () => {
    const tables: RenderTable[] = [
      {
        id: 7,
        titleLines: ["TOP CASE COUNT"],
        valueLabel: "Cases",
        highlightMin: false,
        includeAllAgencies: true,
        includeAllAdvisors: true,
        rookieFilter: "all",
        rookieYears: 2,
        showIndex: false,
        metric: { type: "countCases" },
        rows: [{ name: "Alex", value: 0.5 }],
      },
    ];

    const result = buildReportCanvas({
      report: {
        id: 5,
        title: "Case Count",
        filenameTemplate: "{YYYYMMDD}_Case_Count",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables,
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    expect(result).not.toBeNull();

    const drawText = fillTextMock.mock.calls.map((call) => call[0]);
    expect(drawText).toContain("0.5");
  });

  it("renders a footer total row when enabled", () => {
    const tables: RenderTable[] = [
      {
        id: 8,
        titleLines: ["TOP CASE COUNT"],
        valueLabel: "Cases",
        highlightMin: false,
        includeAllAgencies: true,
        includeAllAdvisors: true,
        rookieFilter: "all",
        rookieYears: 2,
        showIndex: false,
        includeFooterTotalRow: true,
        metric: { type: "countCases" },
        rows: [
          { name: "Alex", value: 2 },
          { name: "Blair", value: 3 },
        ],
      },
    ];

    buildReportCanvas({
      report: {
        id: 6,
        title: "Case Count",
        filenameTemplate: "{YYYYMMDD}_Case_Count",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables,
      maxRows: 2,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const drawText = fillTextMock.mock.calls.map((call) => call[0]);
    expect(drawText).toContain("Total");
    expect(drawText).toContain("5");
  });

  it("keeps the bottom footnote clear of a footer total row", () => {
    buildReportCanvas({
      report: {
        id: 16,
        title: "Case Count",
        filenameTemplate: "{YYYYMMDD}_Case_Count",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "Generated 20260215",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 17,
          titleLines: ["TOP CASE COUNT"],
          valueLabel: "Cases",
          highlightMin: false,
          includeAllAgencies: true,
          includeAllAdvisors: true,
          rookieFilter: "all",
          rookieYears: 2,
          showIndex: false,
          includeFooterTotalRow: true,
          metric: { type: "countCases" },
          rows: [{ name: "Alex", value: 2 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const bottomFootnoteCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "Generated 20260215",
    );

    expect(bottomFootnoteCall?.[2]).toBe(348);
  });

  it("keeps a modest bottom footnote gap when no content reaches the lower edge", () => {
    buildReportCanvas({
      report: {
        id: 7,
        title: "Summary",
        filenameTemplate: "{YYYYMMDD}_Summary",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "Generated 20260215",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 9,
          titleLines: ["TOP"],
          valueLabel: "Cases",
          highlightMin: false,
          includeAllAgencies: true,
          includeAllAdvisors: true,
          rookieFilter: "all",
          rookieYears: 2,
          showIndex: false,
          metric: { type: "countCases" },
          rows: [{ name: "Alex", value: 1 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const bottomFootnoteCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "Generated 20260215",
    );

    expect(bottomFootnoteCall?.[2]).toBe(326);
  });

  it("keeps a single-table bottom footnote clear of total rows", () => {
    buildReportCanvas({
      report: {
        id: 18,
        title: "Single Table",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        singleTable: true,
        bottomFootnote: "Generated 20260215",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 19,
          titleLines: ["AFYP"],
          valueLabel: "AFYP ($)",
          includeFooterTotalRow: true,
          metric: { type: "afyp" },
          rows: [
            { key: "a", name: "Alex", value: 1000 },
            { key: "b", name: "Blair", value: 2000 },
          ],
        },
        {
          id: 20,
          titleLines: ["Cases"],
          valueLabel: "Cases",
          includeFooterTotalRow: true,
          metric: { type: "countCases" },
          rows: [
            { key: "a", name: "Alex", value: 2 },
            { key: "b", name: "Blair", value: 1 },
          ],
        },
      ],
      maxRows: 2,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const bottomFootnoteCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "Generated 20260215",
    );

    expect(bottomFootnoteCall?.[2]).toBe(306);
  });

  it("does not reserve extra bottom space for a short rookie footnote inside the table body", () => {
    buildReportCanvas({
      report: {
        id: 21,
        title: "Summary",
        filenameTemplate: "{YYYYMMDD}_Summary",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "Generated 20260215",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 22,
          titleLines: ["TOP ROOKIE"],
          valueLabel: "Cases",
          includeAllAdvisors: false,
          rookieFilter: "rookies",
          footnote: "Rookie from {YYYY}",
          rows: [{ name: "Alex", value: 1 }],
        },
        {
          id: 23,
          titleLines: ["TOP CASES"],
          valueLabel: "Cases",
          rows: [
            { name: "Alex", value: 3 },
            { name: "Blair", value: 2 },
            { name: "Casey", value: 1 },
          ],
        },
      ],
      maxRows: 3,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const bottomFootnoteCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "Generated 20260215",
    );

    expect(bottomFootnoteCall?.[2]).toBe(374);
  });

  it("renders a single-table layout with FSC and column headers", () => {
    buildReportCanvas({
      report: {
        id: 8,
        title: "Single Table",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: true,
        singleTable: true,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 10,
          titleLines: ["AFYP"],
          valueLabel: "AFYP ($)",
          metric: { type: "afyp" },
          rows: [
            { key: "b", name: "Blair", value: 2000 },
            { key: "a", name: "Alex", value: 1000 },
          ],
        },
        {
          id: 11,
          titleLines: ["Cases"],
          valueLabel: "Cases",
          metric: { type: "countCases" },
          rows: [
            { key: "a", name: "Alex", value: 2 },
            { key: "b", name: "Blair", value: 1 },
          ],
        },
      ],
      maxRows: 2,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const drawText = fillTextMock.mock.calls.map((call) => call[0]);
    expect(drawText).toContain("FSC");
    expect(drawText).toContain("AFYP");
    expect(drawText).toContain("Cases");
    expect(drawText.indexOf("Alex")).toBeLessThan(drawText.indexOf("Blair"));
  });
});
