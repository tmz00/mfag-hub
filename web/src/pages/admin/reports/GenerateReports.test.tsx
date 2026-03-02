import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};
type LoadingProps = { label?: string };
type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: JSX.Element;
};
type DateFieldProps = {
  id: string;
  value: string;
  onChange: (nextValue: string) => void;
};

const {
  getClosingsMock,
  getClosingsDateRangeMock,
  getCurrentUserAccessLevelMock,
  getTeamDataMock,
  getSourcesMock,
  getProductsMock,
  getReportsMock,
  getReportLogoAssetMock,
  loadImageMock,
  buildReportCanvasMock,
  jsPdfCtorMock,
  pdfAddImageMock,
  pdfOutputMock,
  pdfSaveMock,
} = vi.hoisted(() => ({
  getClosingsMock: vi.fn(),
  getClosingsDateRangeMock: vi.fn(),
  getCurrentUserAccessLevelMock: vi.fn(),
  getTeamDataMock: vi.fn(),
  getSourcesMock: vi.fn(),
  getProductsMock: vi.fn(),
  getReportsMock: vi.fn(),
  getReportLogoAssetMock: vi.fn(),
  loadImageMock: vi.fn(),
  buildReportCanvasMock: vi.fn(),
  jsPdfCtorMock: vi.fn(),
  pdfAddImageMock: vi.fn(),
  pdfOutputMock: vi.fn(),
  pdfSaveMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineArrowLeft: Icon,
    TbOutlineChartBar: Icon,
    TbOutlineBell: Icon,
    TbOutlinePackage: Icon,
    TbOutlineUsers: Icon,
    TbOutlineBook: Icon,
    TbOutlineFileText: Icon,
    TbOutlineHistory: Icon,
    TbOutlineList: Icon,
    TbOutlinePlus: Icon,
    TbOutlinePencil: Icon,
    TbOutlineBuilding: Icon,
    TbOutlineArrowsUpDown: Icon,
    TbOutlineTrash: Icon,
    TbOutlineDownload: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/admin/reports" }),
  useNavigate: () => () => undefined,
}));

vi.mock("../../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <div>{props.children}</div>,
  PageHeader: (props: HeaderProps) => (
    <header>
      <h1>{props.title}</h1>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
  LoadingState: (props: LoadingProps) => <div>{props.label || "Loading..."}</div>,
  Button: (props: ButtonProps) => {
    const buttonProps = { ...props };
    delete buttonProps.children;
    return <button {...buttonProps}>{props.children}</button>;
  },
  DateField: (props: DateFieldProps) => {
    const [year, month, day] = props.value.split("-");
    const displayValue =
      year && month && day ? `${day}/${month}/${year}` : props.value;

    return (
      <input
        id={props.id}
        type="text"
        value={displayValue}
        onInput={(event) => {
          const [nextDay, nextMonth, nextYear] =
            event.currentTarget.value.split("/");
          if (nextDay && nextMonth && nextYear) {
            props.onChange(`${nextYear}-${nextMonth}-${nextDay}`);
            return;
          }
          props.onChange(event.currentTarget.value);
        }}
      />
    );
  },
  IconButton: (props: ButtonProps) => {
    const buttonProps = { ...props };
    delete buttonProps.children;
    return <button {...buttonProps}>{props.children}</button>;
  },
  Spinner: (props: { class?: string }) => (
    <span data-testid="download-spinner" class={props.class} />
  ),
}));

vi.mock("../../../services/closingsService", () => ({
  closingsService: {
    getClosings: (...args: unknown[]) => getClosingsMock(...args),
    getClosingsDateRange: (...args: unknown[]) => getClosingsDateRangeMock(...args),
  },
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
    getTeamData: (...args: unknown[]) => getTeamDataMock(...args),
  },
  isStaffUser: (fscCode?: string | null) => String(fscCode || "").startsWith("00"),
}));

vi.mock("../../../services/sourcesService", () => ({
  sourcesService: {
    getSources: (...args: unknown[]) => getSourcesMock(...args),
  },
}));

vi.mock("../../../services/reportsService", () => ({
  reportsService: {
    getReports: (...args: unknown[]) => getReportsMock(...args),
    getReportLogoAsset: (...args: unknown[]) => getReportLogoAssetMock(...args),
  },
}));

vi.mock("../../../services/productsService", () => ({
  productsService: {
    getProducts: (...args: unknown[]) => getProductsMock(...args),
  },
}));

vi.mock("./reportExport", () => ({
  loadImage: (...args: unknown[]) => loadImageMock(...args),
  buildReportCanvas: (...args: unknown[]) => buildReportCanvasMock(...args),
}));

vi.mock("jspdf", () => ({
  jsPDF: function (...args: unknown[]) {
    return jsPdfCtorMock(...args);
  },
}));

const buildTemplate = (id: number, title: string, filenameTemplate: string) => ({
  id,
  title,
  filenameTemplate,
  tableGap: 15,
  tableWidth: 170,
  indexTableWidth: 46,
  includeIndexTable: true,
  bottomFootnote: "",
  tables: [],
});

const renderExtractReports = async () => {
  const { default: GenerateReports } = await import("./GenerateReports");
  return render(() => <GenerateReports />);
};

describe("GenerateReports admin page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00"));

    getClosingsMock.mockReset();
    getClosingsDateRangeMock.mockReset();
    getCurrentUserAccessLevelMock.mockReset();
    getTeamDataMock.mockReset();
    getSourcesMock.mockReset();
    getProductsMock.mockReset();
    getReportsMock.mockReset();
    getReportLogoAssetMock.mockReset();
    loadImageMock.mockReset();
    buildReportCanvasMock.mockReset();
    jsPdfCtorMock.mockReset();
    pdfAddImageMock.mockReset();
    pdfOutputMock.mockReset();
    pdfSaveMock.mockReset();

    getClosingsMock.mockResolvedValue([]);
    getClosingsDateRangeMock.mockResolvedValue({
      minDate: null,
      maxDate: null,
    });
    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "admin",
      isAdmin: true,
    });
    getTeamDataMock.mockResolvedValue({
      users: [],
      agencies: [],
    });
    getSourcesMock.mockResolvedValue([]);
    getProductsMock.mockResolvedValue({
      types: {
        protection: "Protection",
        savings: "Savings",
      },
    });
    getReportsMock.mockResolvedValue([
      buildTemplate(1, "District Top", "{YYYYMMDD}_Custom_TOP"),
    ]);
    getReportLogoAssetMock.mockResolvedValue({
      src: "/images/mfag_banner.png",
      isCustom: false,
    });

    loadImageMock.mockResolvedValue({ width: 200, height: 50 });
    buildReportCanvasMock.mockReturnValue({
      canvas: {
        toDataURL: () => "data:image/png;base64,AAAA",
      },
      width: 1200,
      height: 800,
    });

    jsPdfCtorMock.mockImplementation(() => ({
      addImage: pdfAddImageMock,
      output: pdfOutputMock,
      save: pdfSaveMock,
    }));
    pdfOutputMock.mockReturnValue(new Blob(["pdf"], { type: "application/pdf" }));

    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads API report templates and downloads a PDF", async () => {
    getClosingsMock.mockResolvedValueOnce([
      {
        id: "closing-1",
        timestamp: "2026-02-10T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "roadshow",
        sourceLabel: "Roadshow",
        sourceItemId: "42",
        sourceItemLabel: "Expo 1",
        referrals: 0,
        items: [
          {
            productId: "prod-alpha",
            fullName: "Alpha Protector",
            shortName: "Alpha",
            fycRate: 0.5,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 2, premium: 1000, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-2",
        timestamp: "2026-02-11T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "roadshow",
        sourceLabel: "Roadshow",
        referrals: 0,
        items: [
          {
            productId: "prod-alpha",
            fullName: "Alpha Protector",
            shortName: "Alpha",
            fycRate: 0.5,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 1200, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
    ]);

    await renderExtractReports();

    expect(screen.queryByText("20260214_Custom_TOP.pdf")).toBeNull();
    expect(getClosingsMock).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Start date") as HTMLInputElement).value,
    ).toBe("01/02/2026");
    expect(
      (screen.getByLabelText("End date") as HTMLInputElement).value,
    ).toBe("14/02/2026");

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("20260214_Custom_TOP.pdf")).toBeTruthy();
    });

    const params = getClosingsMock.mock.calls[0]?.[0] as {
      startDate: string;
      endDate: string;
    };
    expect(params).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-14",
    });
    expect(screen.getByText("Source Breakdown")).toBeTruthy();
    expect(screen.getByText(/Roadshow/)).toBeTruthy();
    expect(screen.getAllByText("FYC 16.00")).toHaveLength(2);
    expect(screen.getAllByText("AFYP 3,200.00")).toHaveLength(2);
    expect(screen.queryByText("Expo 1")).toBeNull();
    expect(
      screen.queryByText("Some closings in this source were saved without a selected item."),
    ).toBeNull();
    expect(screen.queryByText("General")).toBeNull();
    expect(screen.getByText("Product Breakdown")).toBeTruthy();
    expect(screen.getByText(/Alpha/)).toBeTruthy();
    expect(screen.getAllByText("3 cases")).toHaveLength(3);
    expect(screen.queryByText("2 line items")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show breakdown" }));

    expect(screen.getByText("Expo 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide breakdown" })).toBeTruthy();
    expect(screen.getByText("AFYP 2,000.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide breakdown" }));

    expect(screen.queryByText("Expo 1")).toBeNull();

    fireEvent.click(screen.getByTitle("Download report"));

    expect(screen.getByTestId("download-spinner")).toBeTruthy();

    await vi.waitFor(() => {
      expect(getReportLogoAssetMock).toHaveBeenCalledTimes(1);
      expect(loadImageMock).toHaveBeenCalledWith("/images/mfag_banner.png");
      expect(pdfAddImageMock).toHaveBeenCalled();
      expect(pdfSaveMock).toHaveBeenCalledWith("20260214_Custom_TOP.pdf");
    });
  });

  it("lists every source and lets each breakdown section switch metrics", async () => {
    getClosingsMock.mockResolvedValueOnce([
      {
        id: "closing-1",
        timestamp: "2026-02-10T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "warm",
        sourceLabel: "Warm",
        referrals: 0,
        items: [
          {
            productId: "prod-alpha",
            fullName: "Alpha Protect",
            shortName: "Alpha",
            fycRate: 1,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 1000, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-2",
        timestamp: "2026-02-10T10:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "existing",
        sourceLabel: "Existing",
        referrals: 0,
        items: [
          {
            productId: "prod-beta",
            fullName: "Beta Save",
            shortName: "Beta",
            fycRate: 0.1,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 2, premium: 150, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-3",
        timestamp: "2026-02-10T11:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "referral",
        sourceLabel: "Referral",
        referrals: 0,
        items: [
          {
            productId: "prod-gamma",
            fullName: "Gamma Guard",
            shortName: "Gamma",
            fycRate: 0.05,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 5, premium: 100, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-4",
        timestamp: "2026-02-10T12:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "seminar",
        sourceLabel: "Seminar",
        referrals: 0,
        items: [
          {
            productId: "prod-delta",
            fullName: "Delta Plan",
            shortName: "Delta",
            fycRate: 0.4,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 300, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-5",
        timestamp: "2026-02-10T13:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "cold",
        sourceLabel: "Cold",
        referrals: 0,
        items: [
          {
            productId: "prod-omega",
            fullName: "Omega Shield",
            shortName: "Omega",
            fycRate: 0.2,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 200, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-6",
        timestamp: "2026-02-10T14:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "roadshow",
        sourceLabel: "Roadshow",
        referrals: 0,
        items: [
          {
            productId: "prod-zeta",
            fullName: "Zeta Cover",
            shortName: "Zeta",
            fycRate: 0.15,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 150, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-7",
        timestamp: "2026-02-10T15:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "socialMedia",
        sourceLabel: "Social Media",
        referrals: 0,
        items: [
          {
            productId: "prod-sigma",
            fullName: "Sigma Plus",
            shortName: "Sigma",
            fycRate: 0.12,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 120, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("Top sources by cases")).toBeTruthy();
    });

    expect(screen.getByText("Top products by cases")).toBeTruthy();
    expect(screen.getByText(/Sigma/)).toBeTruthy();
    expect(screen.getAllByText("1 case").length).toBeGreaterThan(0);
    expect(screen.queryByText("1 cases")).toBeNull();
    expect(screen.queryByText("1 sources")).toBeNull();
    expect(screen.queryByText("Other sources")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Source breakdown by FYC" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Product breakdown by FYC" }),
    );

    expect(screen.getByText("Top sources by FYC")).toBeTruthy();
    expect(screen.getByText("Top products by FYC")).toBeTruthy();
  });

  it("excludes rider items from the product breakdown", async () => {
    getClosingsMock.mockResolvedValueOnce([
      {
        id: "closing-1",
        timestamp: "2026-02-10T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "warm",
        sourceLabel: "Warm",
        referrals: 0,
        items: [
          {
            productId: "prod-alpha",
            fullName: "Alpha Protect",
            shortName: "Alpha",
            fycRate: 0.5,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 2, premium: 1000, frequency: "Annual" }],
            riders: [
              {
                isRider: true,
                productId: "prod-rider",
                fullName: "Alpha Shield Rider",
                shortName: "Shield Rider",
                fycRate: 0.5,
                gst: 0,
                quantitiesAndPremiums: [{ quantity: 5, premium: 100, frequency: "Annual" }],
                riders: [],
              },
            ],
          },
          {
            isRider: true,
            productId: "prod-standalone-rider",
            fullName: "Standalone Booster",
            shortName: "Booster",
            fycRate: 0.5,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 3, premium: 150, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("Product Breakdown")).toBeTruthy();
    });

    expect(screen.getByText(/Alpha/)).toBeTruthy();
    expect(screen.getAllByText("2 cases")).toHaveLength(3);
    expect(screen.queryByText("Shield Rider")).toBeNull();
    expect(screen.queryByText("Booster")).toBeNull();
    expect(screen.queryByText("7 cases")).toBeNull();
    expect(screen.queryByText("3 cases")).toBeNull();
  });

  it("opens generated PDFs in a separate tab on iPad instead of replacing the app page", async () => {
    const originalUserAgent = window.navigator.userAgent;
    const originalMaxTouchPoints = window.navigator.maxTouchPoints;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    const previewDocument = document.implementation.createHTMLDocument("");
    const previewWindow = {
      document: previewDocument,
      location: { href: "" },
      closed: false,
      close: vi.fn(),
    } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(previewWindow);
    const createObjectUrlMock = vi.fn(() => "blob:generated-report");
    const revokeObjectUrlMock = vi.fn();
    const anchorClickMock = vi.fn();

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrlMock,
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value: anchorClickMock,
    });

    try {
      await renderExtractReports();
      fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

      await waitFor(() => {
        expect(screen.getByText("20260214_Custom_TOP.pdf")).toBeTruthy();
      });

      fireEvent.click(screen.getByTitle("Download report"));

      await vi.waitFor(() => {
        expect(openSpy).toHaveBeenCalledWith("", "_blank");
        expect(pdfSaveMock).not.toHaveBeenCalled();
        expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
        expect(anchorClickMock).toHaveBeenCalledTimes(1);
        expect(previewDocument.title).toBe("20260214_Custom_TOP.pdf");
        expect(
          previewDocument.body.textContent?.includes(
            "Download 20260214_Custom_TOP.pdf",
          ),
        ).toBe(true);
        const downloadLink = previewDocument.querySelector("a");
        expect(downloadLink?.getAttribute("download")).toBe(
          "20260214_Custom_TOP.pdf",
        );
        expect(downloadLink?.getAttribute("href")).toBe("blob:generated-report");
        const frame = previewDocument.querySelector("iframe");
        expect(frame?.getAttribute("src")).toBe("blob:generated-report");
      });
    } finally {
      openSpy.mockRestore();
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: originalUserAgent,
      });
      Object.defineProperty(window.navigator, "maxTouchPoints", {
        configurable: true,
        value: originalMaxTouchPoints,
      });
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
      Object.defineProperty(HTMLAnchorElement.prototype, "click", {
        configurable: true,
        value: originalAnchorClick,
      });
    }
  });

  it("uses the template default for footer total rows", async () => {
    getReportsMock.mockResolvedValueOnce([
      {
        id: 2,
        title: "Case Count",
        filenameTemplate: "{YYYYMMDD} Case Count Stats",
        tableGap: 15,
        tableWidth: 170,
        indexTableWidth: 46,
        includeIndexTable: true,
        bottomFootnote: "",
        tables: [
          {
            id: 10,
            titleLines: ["CASE COUNT"],
            valueLabel: "Cases",
            includeFooterTotalRow: true,
            highlightMin: false,
            includeAllAgencies: true,
            includeAllAdvisors: true,
            rookieFilter: "all",
            rookieYears: 2,
            metric: { type: "countCases" },
          },
        ],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("20260214 Case Count Stats.pdf")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Download report"));

    await vi.waitFor(() => {
      expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
    });

    const renderArgs = buildReportCanvasMock.mock.calls[0]?.[0] as {
      tables: Array<{ includeFooterTotalRow?: boolean }>;
    };

    expect(
      renderArgs.tables.some((table) => table.includeFooterTotalRow === true),
    ).toBe(true);
  });

  it("does not inject a separate index-only column in single-table mode", async () => {
    getReportsMock.mockResolvedValueOnce([
      {
        id: 3,
        title: "Single Table Report",
        filenameTemplate: "{YYYYMMDD}_Single",
        tableGap: 15,
        tableWidth: 170,
        indexTableWidth: 46,
        includeIndexTable: true,
        singleTable: true,
        bottomFootnote: "",
        tables: [
          {
            id: 10,
            titleLines: ["AFYP"],
            valueLabel: "AFYP ($)",
            highlightMin: false,
            includeAllAgencies: true,
            includeAllAdvisors: true,
            rookieFilter: "all",
            rookieYears: 2,
            metric: { type: "afyp" },
          },
        ],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("20260214_Single.pdf")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Download report"));

    await vi.waitFor(() => {
      expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
    });

    const renderArgs = buildReportCanvasMock.mock.calls[0]?.[0] as {
      tables: Array<{ id: number | string }>;
    };

    expect(renderArgs.tables.some((table) => table.id === "index-only")).toBe(
      false,
    );
  });

  it("uses case count to count qualifying closings", async () => {
    getTeamDataMock.mockResolvedValueOnce({
      users: [
        {
          fscCode: "A123",
          nickname: "Alex Tan",
          agencyCode: "AG01",
          contractYear: 2024,
        },
      ],
      agencies: [],
    });
    getReportsMock.mockResolvedValueOnce([
      {
        id: 1,
        title: "Referral Report",
        filenameTemplate: "{YYYYMMDD}_Referral",
        tableGap: 15,
        tableWidth: 170,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [
          {
            id: 10,
            titleLines: ["CASE COUNT"],
            valueLabel: "Cases",
            highlightMin: false,
            includeAllAgencies: true,
            includeAllAdvisors: true,
            rookieFilter: "all",
            rookieYears: 1,
            metric: { type: "countClosings" },
          },
        ],
      },
    ]);
    getClosingsMock.mockResolvedValueOnce([
      {
        id: "closing-1",
        timestamp: "2026-02-10T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "source-abc123",
        sourceLabel: "Warm",
        referrals: 0,
        items: [],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("20260214_Referral.pdf")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Download report"));

    await vi.waitFor(() => {
      expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
    });

    const renderArgs = buildReportCanvasMock.mock.calls[0]?.[0] as {
      tables: Array<{ rows: Array<{ value: number }> }>;
    };

    expect(renderArgs.tables[0]?.rows[0]?.value).toBe(1);
  });

  it("applies source-item, product-type, include-keyword, and exclude-keyword filters to metrics", async () => {
    getTeamDataMock.mockResolvedValueOnce({
      users: [
        {
          fscCode: "A123",
          nickname: "Alex Tan",
          agencyCode: "AG01",
          contractYear: 2024,
        },
      ],
      agencies: [],
    });
    getReportsMock.mockResolvedValueOnce([
      {
        id: 1,
        title: "Filtered Report",
        filenameTemplate: "{YYYYMMDD}_Filtered",
        tableGap: 15,
        tableWidth: 170,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [
          {
            id: 10,
            titleLines: ["FILTERED FYC"],
            valueLabel: "FYC ($)",
            highlightMin: false,
            includeAllAgencies: true,
            includeAllAdvisors: true,
            rookieFilter: "all",
            rookieYears: 2,
            sources: ["warm"],
            sourceItemIds: ["ref-item-2"],
            productTypeKeys: ["protection"],
            includeProductKeywords: "alpha",
            excludeProductKeywords: "shield, legacy",
            metric: { type: "fyc" },
          },
        ],
      },
    ]);
    getClosingsMock.mockResolvedValueOnce([
      {
        id: "closing-1",
        timestamp: "2026-02-10T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "referral",
        sourceItemId: "ref-item-1",
        sourceLabel: "Referral",
        referrals: 0,
        items: [
          {
            productId: "P1",
            fullName: "Alpha Protect",
            shortName: "Alpha",
            type: "protection",
            fycRate: 50,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 1000, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-2",
        timestamp: "2026-02-10T10:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "referral",
        sourceItemId: "ref-item-2",
        sourceLabel: "Referral",
        referrals: 0,
        items: [
          {
            productId: "P2",
            fullName: "Savings Builder",
            shortName: "Builder",
            type: "savings",
            fycRate: 50,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 1000, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-3",
        timestamp: "2026-02-10T11:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "referral",
        sourceItemId: "ref-item-2",
        sourceLabel: "Referral",
        referrals: 0,
        items: [
          {
            productId: "P3",
            fullName: "Shield Protect",
            shortName: "Shield",
            type: "protection",
            fycRate: 50,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 1000, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
      {
        id: "closing-4",
        timestamp: "2026-02-10T12:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "referral",
        sourceItemId: "ref-item-2",
        sourceLabel: "Referral",
        referrals: 0,
        items: [
          {
            productId: "P4",
            fullName: "Alpha Protect",
            shortName: "Alpha",
            type: "protection",
            fycRate: 50,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 1000, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("20260214_Filtered.pdf")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Download report"));

    await vi.waitFor(() => {
      expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
    });

    const renderArgs = buildReportCanvasMock.mock.calls[0]?.[0] as {
      tables: Array<{ rows: Array<{ value: number }> }>;
    };

    expect(renderArgs.tables[0]?.rows[0]?.value).toBe(500);
  });

  it("uses case count to total top-level non-rider product quantities and ignores riders", async () => {
    getTeamDataMock.mockResolvedValueOnce({
      users: [
        {
          fscCode: "A123",
          nickname: "Alex Tan",
          agencyCode: "AG01",
          contractYear: 2024,
        },
      ],
      agencies: [],
    });
    getReportsMock.mockResolvedValueOnce([
      {
        id: 1,
        title: "Case Count Report",
        filenameTemplate: "{YYYYMMDD}_CaseCount",
        tableGap: 15,
        tableWidth: 170,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [
          {
            id: 10,
            titleLines: ["CASE COUNT"],
            valueLabel: "Cases",
            highlightMin: false,
            includeAllAgencies: true,
            includeAllAdvisors: true,
            rookieFilter: "all",
            rookieYears: 2,
            metric: { type: "countCases" },
          },
        ],
      },
    ]);
    getClosingsMock.mockResolvedValueOnce([
      {
        id: "closing-1",
        timestamp: "2026-02-10T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "warm",
        sourceLabel: "Warm",
        referrals: 0,
        items: [
          {
            productId: "P1",
            fullName: "Alpha Protect",
            shortName: "Alpha",
            type: "protection",
            fycRate: 50,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 2, premium: 1000, frequency: "Annual" }],
            riders: [
              {
                isRider: true,
                productId: "R1",
                fullName: "Alpha Rider",
                shortName: "Rider",
                type: "protection",
                fycRate: 50,
                gst: 0,
                quantitiesAndPremiums: [{ quantity: 5, premium: 100, frequency: "Annual" }],
                riders: [],
              },
            ],
          },
          {
            isRider: true,
            productId: "P2",
            fullName: "Beta Save",
            shortName: "Beta",
            type: "savings",
            fycRate: 50,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 3, premium: 800, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("20260214_CaseCount.pdf")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Download report"));

    await vi.waitFor(() => {
      expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
    });

    const renderArgs = buildReportCanvasMock.mock.calls[0]?.[0] as {
      tables: Array<{ rows: Array<{ value: number }> }>;
    };

    expect(renderArgs.tables[0]?.rows[0]?.value).toBe(2);
  });

  it("keeps zero-value rookies in rookie-only tables", async () => {
    getTeamDataMock.mockResolvedValueOnce({
      users: [
        {
          fscCode: "A123",
          nickname: "Alex Tan",
          agencyCode: "AG01",
          contractYear: 2025,
        },
        {
          fscCode: "B456",
          nickname: "Blair Lee",
          agencyCode: "AG01",
          contractYear: 2025,
        },
      ],
      agencies: [],
    });
    getReportsMock.mockResolvedValueOnce([
      {
        id: 1,
        title: "Rookie Case Count Report",
        filenameTemplate: "{YYYYMMDD}_RookieCaseCount",
        tableGap: 15,
        tableWidth: 170,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [
          {
            id: 10,
            titleLines: ["ROOKIE CASE COUNT"],
            valueLabel: "Cases",
            highlightMin: false,
            includeAllAgencies: true,
            includeAllAdvisors: false,
            rookieFilter: "rookies",
            rookieYears: 2,
            metric: { type: "countCases" },
          },
        ],
      },
    ]);
    getClosingsMock.mockResolvedValueOnce([
      {
        id: "closing-1",
        timestamp: "2026-02-10T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        sourceId: "warm",
        sourceLabel: "Warm",
        referrals: 0,
        items: [
          {
            productId: "P1",
            fullName: "Alpha Protect",
            shortName: "Alpha",
            type: "protection",
            fycRate: 50,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 1000, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("20260214_RookieCaseCount.pdf")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Download report"));

    await vi.waitFor(() => {
      expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
    });

    const renderArgs = buildReportCanvasMock.mock.calls[0]?.[0] as {
      tables: Array<{ rows: Array<{ key: string; value: number }> }>;
    };

    expect(renderArgs.tables[0]?.rows).toEqual([
      expect.objectContaining({ key: "A123", value: 1 }),
      expect.objectContaining({ key: "B456", value: 0 }),
    ]);
  });

  it("does not halve shared values when only one adviser matches the table", async () => {
    getTeamDataMock.mockResolvedValueOnce({
      users: [
        {
          fscCode: "A123",
          nickname: "Alex Tan",
          agencyCode: "AG01",
          contractYear: 2025,
        },
        {
          fscCode: "B456",
          nickname: "Blair Lee",
          agencyCode: "AG01",
          contractYear: 2023,
        },
      ],
      agencies: [],
    });
    getReportsMock.mockResolvedValueOnce([
      {
        id: 1,
        title: "Rookie Case Count Report",
        filenameTemplate: "{YYYYMMDD}_RookieCaseCount",
        tableGap: 15,
        tableWidth: 170,
        indexTableWidth: 46,
        includeIndexTable: false,
        bottomFootnote: "",
        tables: [
          {
            id: 10,
            titleLines: ["ROOKIE CASE COUNT"],
            valueLabel: "Cases",
            highlightMin: false,
            includeAllAgencies: true,
            includeAllAdvisors: false,
            rookieFilter: "rookies",
            rookieYears: 2,
            metric: { type: "countCases" },
          },
        ],
      },
    ]);
    getClosingsMock.mockResolvedValueOnce([
      {
        id: "closing-1",
        timestamp: "2026-02-10T09:00:00.000Z",
        fscCode: "A123",
        fscName: "Alex Tan",
        isShared: true,
        sharedFscCode: "B456",
        sharedFscName: "Blair Lee",
        sourceId: "warm",
        sourceLabel: "Warm",
        referrals: 0,
        items: [
          {
            productId: "P1",
            fullName: "Alpha Protect",
            shortName: "Alpha",
            type: "protection",
            fycRate: 50,
            gst: 0,
            quantitiesAndPremiums: [{ quantity: 1, premium: 1000, frequency: "Annual" }],
            riders: [],
          },
        ],
      },
    ]);

    await renderExtractReports();

    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("20260214_RookieCaseCount.pdf")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Download report"));

    await vi.waitFor(() => {
      expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
    });

    const renderArgs = buildReportCanvasMock.mock.calls[0]?.[0] as {
      tables: Array<{ rows: Array<{ value: number }> }>;
    };

    expect(renderArgs.tables[0]?.rows[0]?.value).toBe(1);
  });

  it("shows the empty-state message when API returns no report layouts", async () => {
    getReportsMock.mockResolvedValueOnce([]);

    await renderExtractReports();
    fireEvent.click(screen.getByRole("button", { name: "Generate Reports" }));

    await waitFor(() => {
      expect(screen.getByText("No reports configured yet.")).toBeTruthy();
    });
  });

  it("defaults the start date to the first day of yesterday's month", async () => {
    vi.setSystemTime(new Date("2026-03-01T12:00:00"));

    await renderExtractReports();

    expect(
      (screen.getByLabelText("Start date") as HTMLInputElement).value,
    ).toBe("01/02/2026");
    expect(
      (screen.getByLabelText("End date") as HTMLInputElement).value,
    ).toBe("28/02/2026");
  });
});
