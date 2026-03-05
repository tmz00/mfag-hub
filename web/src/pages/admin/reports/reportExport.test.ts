import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildReportCanvas, type RenderTable } from "./reportExport";

function createContext(fillTextMock: ReturnType<typeof vi.fn>) {
  const ctx = {
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
    fillText: (text: string, x: number, y: number) => {
      fillTextMock(text, x, y, ctx.font);
    },
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };

  return ctx as unknown as CanvasRenderingContext2D;
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
    const tableTitleCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "TOP ROOKIE",
    );

    expect(tableTitleCall?.[2]).toBe(224);
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

  it("supports higher export pixel scales without changing layout size", () => {
    const result = buildReportCanvas({
      report: {
        id: 25,
        title: "High Res",
        filenameTemplate: "{YYYYMMDD}_High_Res",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 26,
          titleLines: ["TOP"],
          valueLabel: "Cases",
          rows: [{ name: "Alex", value: 1 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
      pixelScale: 4,
    });

    expect(result).not.toBeNull();
    expect(result?.canvas.width).toBe((result?.width ?? 0) * 4);
    expect(result?.canvas.height).toBe((result?.height ?? 0) * 4);
    expect(result?.canvas.style.width).toBe(`${result?.width}px`);
    expect(result?.canvas.style.height).toBe(`${result?.height}px`);
  });

  it("skips blank second and third title lines while preserving the second line exactly", () => {
    buildReportCanvas({
      report: {
        id: 27,
        title: "Title Lines",
        filenameTemplate: "{YYYYMMDD}_Title_Lines",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 28,
          titleLines: ["TOP", "(SECOND LINE)", ""],
          valueLabel: "Cases",
          rows: [{ name: "Alex", value: 1 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const drawText = fillTextMock.mock.calls.map((call) => call[0]);
    const secondLineCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "(SECOND LINE)",
    );

    expect(drawText).toContain("(SECOND LINE)");
    expect(drawText).not.toContain("SECOND LINE");
    expect(drawText.filter((text) => text === "")).toHaveLength(0);
    expect(secondLineCall?.[3]).toBe('600 12px "Aptos Narrow", sans-serif');
  });

  it("renders single-table title lines with the same formatting rules as standard tables", () => {
    buildReportCanvas({
      report: {
        id: 32,
        title: "Single Table",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        singleTable: true,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 33,
          titleLines: ["TOP", "(SECOND LINE)", "(THIRD LINE)"],
          valueLabel: "Header",
          rows: [{ key: "a", name: "Alex", value: 1 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const secondLineCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "(SECOND LINE)",
    );
    const thirdLineCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "THIRD LINE",
    );
    const drawText = fillTextMock.mock.calls.map((call) => call[0]);

    expect(drawText).not.toContain("(THIRD LINE)");
    expect(secondLineCall?.[3]).toBe('600 12px "Aptos Narrow", sans-serif');
    expect(thirdLineCall?.[3]).toBe('italic 600 12px "Aptos Narrow", sans-serif');
  });

  it("wraps long text in single-table title rows", () => {
    buildReportCanvas({
      report: {
        id: 34,
        title: "Single Table",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        singleTable: true,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 35,
          titleLines: ["TOP", "ONE TWO THREE FOUR FIVE SIX SEVEN"],
          valueLabel: "ALPHA BETA GAMMA DELTA EPSILON",
          rows: [{ key: "a", name: "Alex", value: 1 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const drawText = fillTextMock.mock.calls.map((call) => call[0]);

    expect(drawText).toContain("ALPHA BETA GAMMA DELTA");
    expect(drawText).toContain("EPSILON");
    expect(drawText).toContain("ONE TWO THREE FOUR FIVE SIX");
    expect(drawText).toContain("SEVEN");
    expect(drawText).not.toContain("ALPHA BETA GAMMA DELTA EPSILON");
    expect(drawText).not.toContain("ONE TWO THREE FOUR FIVE SIX SEVEN");
  });

  it("keeps the single-table top header row visible when headers are blank", () => {
    const withHeader = buildReportCanvas({
      report: {
        id: 36,
        title: "Single Table",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        singleTable: true,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 37,
          titleLines: ["TOP"],
          valueLabel: "Header",
          rows: [{ key: "a", name: "Alex", value: 1 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const withoutHeader = buildReportCanvas({
      report: {
        id: 38,
        title: "Single Table",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        singleTable: true,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 39,
          titleLines: ["TOP"],
          valueLabel: "",
          rows: [{ key: "a", name: "Alex", value: 1 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    expect(withoutHeader?.height).toBe(withHeader?.height);
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

    expect(bottomFootnoteCall?.[2]).toBe(338);
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
    expect(drawText).toContain("AFYP ($)");
    expect(drawText).toContain("Cases");
    expect(drawText.indexOf("Alex")).toBeLessThan(drawText.indexOf("Blair"));
  });

  it("merges matching value labels across adjacent single-table columns", () => {
    buildReportCanvas({
      report: {
        id: 29,
        title: "Single Table",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        singleTable: true,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 30,
          titleLines: ["Monthly", "AFYP"],
          valueLabel: "Production",
          metric: { type: "afyp" },
          rows: [{ key: "a", name: "Alex", value: 1000 }],
        },
        {
          id: 31,
          titleLines: ["Quarterly", "Cases"],
          valueLabel: "Production",
          metric: { type: "countCases" },
          rows: [{ key: "a", name: "Alex", value: 2 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const titleCalls = fillTextMock.mock.calls.filter(
      (call) => call[0] === "Production",
    );

    expect(titleCalls).toHaveLength(1);
    expect(titleCalls[0]?.[1]).toBe(322);
    expect(titleCalls[0]?.[2]).toBe(210);
  });

  it("adds a table-gap spacer before every single-table header group, including blank groups", () => {
    const result = buildReportCanvas({
      report: {
        id: 40,
        title: "Single Table",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 12,
        tableWidth: 180,
        indexTableWidth: 46,
        includeIndexTable: false,
        singleTable: true,
        bottomFootnote: "",
        tables: [],
      },
      reportDate: new Date("2026-02-15T00:00:00.000Z"),
      tables: [
        {
          id: 41,
          titleLines: ["One"],
          valueLabel: "",
          rows: [{ key: "a", name: "Alex", value: 1 }],
        },
        {
          id: 42,
          titleLines: ["Two"],
          valueLabel: "",
          rows: [{ key: "a", name: "Alex", value: 1 }],
        },
        {
          id: 43,
          titleLines: ["Three"],
          valueLabel: "Beta",
          rows: [{ key: "a", name: "Alex", value: 1 }],
        },
        {
          id: 44,
          titleLines: ["Four"],
          valueLabel: "Beta",
          rows: [{ key: "a", name: "Alex", value: 1 }],
        },
      ],
      maxRows: 1,
      reportRangeLabel: "01 Feb 2026 - 15 Feb 2026",
      logo: null,
    });

    const betaCall = fillTextMock.mock.calls.find((call) => call[0] === "Beta");
    const thirdHeaderCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "Three",
    );
    const thirdValueCall = fillTextMock.mock.calls.find(
      (call) => call[0] === "1" && call[1] === 720,
    );

    expect(betaCall?.[1]).toBe(712);
    expect(betaCall?.[2]).toBe(210);
    expect(thirdHeaderCall?.[1]).toBe(619);
    expect(thirdValueCall).toBeTruthy();
    expect(result?.width).toBe(944);
  });
});
