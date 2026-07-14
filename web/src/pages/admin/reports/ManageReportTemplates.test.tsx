import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { splitProps, type JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};
type LoadingProps = { label?: string };
type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: JSX.Element;
};
type ReorderListProps<T = unknown> = {
  items?: T[];
  renderLabel?: (item: T) => JSX.Element;
};
type EditModalProps = {
  title: string;
  onClose?: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  saveLabel?: string;
  savingLabel?: string;
  saving?: () => boolean;
  footerLeft?: JSX.Element;
  children?: JSX.Element;
};

const {
  getReportsMock,
  setReportsMock,
  getReportLogoAssetMock,
  uploadReportLogoMock,
  deleteReportLogoMock,
  getCurrentUserAccessLevelMock,
  getTeamDataMock,
  getSourcesMock,
  getProductsMock,
  buildReportCanvasMock,
  loadImageMock,
} = vi.hoisted(() => ({
  getReportsMock: vi.fn(),
  setReportsMock: vi.fn(),
  getReportLogoAssetMock: vi.fn(),
  uploadReportLogoMock: vi.fn(),
  deleteReportLogoMock: vi.fn(),
  getCurrentUserAccessLevelMock: vi.fn(),
  getTeamDataMock: vi.fn(),
  getSourcesMock: vi.fn(),
  getProductsMock: vi.fn(),
  buildReportCanvasMock: vi.fn(),
  loadImageMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineArrowLeft: Icon,
    TbOutlineChartBar: Icon,
    TbOutlineBell: Icon,
    TbOutlinePackage: Icon,
    TbOutlineUsers: Icon,
    TbOutlineCalendarCheck: Icon,
    TbOutlineBook: Icon,
    TbOutlineFileText: Icon,
    TbOutlineHistory: Icon,
    TbOutlineList: Icon,
    TbOutlinePlus: Icon,
    TbOutlinePencil: Icon,
    TbOutlineBuilding: Icon,
    TbOutlineArrowsUpDown: Icon,
    TbOutlineTrash: Icon,
    TbOutlineX: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/admin/report-templates" }),
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
    const [local, buttonProps] = splitProps(props, ["children"]);
    return <button {...buttonProps}>{local.children}</button>;
  },
  EditModal: (props: EditModalProps) => (
    <div>
      <div>{props.title}</div>
      {props.children}
      {props.footerLeft}
      {props.onSave ? (
        <button
          type="button"
          onClick={props.onSave}
          disabled={props.saveDisabled}
        >
          {props.saving?.()
            ? props.savingLabel || "Saving..."
            : props.saveLabel || "Save"}
        </button>
      ) : null}
    </div>
  ),
  IconButton: (props: ButtonProps) => {
    const [local, buttonProps] = splitProps(props, ["children"]);
    return <button {...buttonProps}>{local.children}</button>;
  },
  ReorderList: <T,>(props: ReorderListProps<T>) => (
    <div>
      {(props.items || []).map((item) => props.renderLabel?.(item) || null)}
    </div>
  ),
  createConfirm: () => [() => null, vi.fn().mockResolvedValue(undefined)],
}));

vi.mock("../../../services/reportsService", () => ({
  DEFAULT_REPORT_LOGO_PATH: "/api/reports/logo",
  reportsService: {
    getReports: (...args: unknown[]) => getReportsMock(...args),
    setReports: (...args: unknown[]) => setReportsMock(...args),
    getReportLogoAsset: (...args: unknown[]) => getReportLogoAssetMock(...args),
    uploadReportLogo: (...args: unknown[]) => uploadReportLogoMock(...args),
    deleteReportLogo: (...args: unknown[]) => deleteReportLogoMock(...args),
  },
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
    getTeamData: (...args: unknown[]) => getTeamDataMock(...args),
  },
}));

vi.mock("../../../services/sourcesService", () => ({
  sourcesService: {
    getSources: (...args: unknown[]) => getSourcesMock(...args),
  },
}));

vi.mock("../../../services/productsService", () => ({
  productsService: {
    getProducts: (...args: unknown[]) => getProductsMock(...args),
  },
}));

vi.mock("./reportExport", () => ({
  buildReportCanvas: (...args: unknown[]) => buildReportCanvasMock(...args),
  loadImage: (...args: unknown[]) => loadImageMock(...args),
}));

const buildTemplate = (
  id: number,
  title: string,
  tables: Array<Record<string, unknown>> = [],
) => ({
  id,
  title,
  filenameTemplate: "{YYYYMMDD}_District_TOP",
  tableGap: 15,
  tableWidth: 170,
  indexTableWidth: 46,
  includeIndexTable: true,
  bottomFootnote: "",
  tables,
});

const renderManageReportTemplates = async () => {
  const { default: ManageReportTemplates } = await import("./ManageReportTemplates");
  return render(() => <ManageReportTemplates />);
};

describe("ManageReportTemplates admin page", () => {
  beforeEach(() => {
    getReportsMock.mockReset();
    setReportsMock.mockReset();
    getReportLogoAssetMock.mockReset();
    uploadReportLogoMock.mockReset();
    deleteReportLogoMock.mockReset();
    getCurrentUserAccessLevelMock.mockReset();
    getTeamDataMock.mockReset();
    getSourcesMock.mockReset();
    getProductsMock.mockReset();
    buildReportCanvasMock.mockReset();
    loadImageMock.mockReset();

    getReportsMock.mockResolvedValue([
      buildTemplate(1, "Top Stats"),
      buildTemplate(2, "Top Rookie"),
    ]);
    setReportsMock.mockImplementation(async (payload: unknown) => payload);
    getReportLogoAssetMock.mockResolvedValue({
      src: "/api/reports/logo",
      isCustom: false,
    });
    uploadReportLogoMock.mockResolvedValue(undefined);
    deleteReportLogoMock.mockResolvedValue(undefined);
    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "admin",
      isAdmin: true,
    });
    getTeamDataMock.mockResolvedValue({
      users: [],
      agencies: [{ code: "AG01", name: "Agency 01" }],
    });
    getSourcesMock.mockResolvedValue([
      { id: "warm", label: "Warm", description: "", children: [] },
      { id: "existing", label: "Existing", description: "", children: [] },
      { id: "referral", label: "Referral", description: "", children: [] },
    ]);
    getProductsMock.mockResolvedValue({
      types: {
        protection: "Protection",
        savings: "Savings",
      },
    });
    buildReportCanvasMock.mockReturnValue({
      canvas: {
        toDataURL: () => "data:image/png;base64,preview",
      },
      width: 640,
      height: 480,
    });
    loadImageMock.mockResolvedValue({
      width: 1200,
      height: 240,
    });
  });

  it("blocks non-admin users", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "standard",
      isAdmin: false,
    });

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Admin access required.")).toBeTruthy();
    });
  });

  it("shows an empty list when API returns no report templates", async () => {
    getReportsMock.mockResolvedValueOnce([]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Add Report Template" }),
      ).toBeTruthy();
    });

    expect(screen.queryByText("Top Submission Stats")).toBeNull();
    expect(screen.queryByText("Case Count Submissions")).toBeNull();
    expect(screen.queryByText("Full Submission Stats")).toBeNull();
  });

  it("uploads a replacement report logo", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    const logoInput = screen.getByLabelText("Upload Logo") as HTMLInputElement;
    fireEvent.change(logoInput, {
      target: {
        files: [new File(["logo"], "custom-logo.png", { type: "image/png" })],
      },
    });

    await waitFor(() => {
      expect(uploadReportLogoMock).toHaveBeenCalledTimes(1);
    });
  });

  it("adds a report template and persists via reportsService", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });
    expect(screen.getByText("Report Templates")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });
    expect(screen.getByText("TOP ROOKIE")).toBeTruthy();
    expect(screen.getByLabelText("Index Column Width (px)")).toBeTruthy();
    expect(
      (screen.getByLabelText("Report Layout") as HTMLSelectElement).value,
    ).toBe("separateLeaderboards");
    expect(
      screen
        .getByLabelText("Filename Template")
        .compareDocumentPosition(screen.getByLabelText("Report Layout")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const includeIndexColumnCheckbox = screen.getByLabelText(
      "Include Index Column",
    ) as HTMLInputElement;
    expect(
      screen
        .getByLabelText("Report Layout")
        .compareDocumentPosition(includeIndexColumnCheckbox) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(includeIndexColumnCheckbox);
    expect(screen.queryByLabelText("Index Column Width (px)")).toBeNull();
    fireEvent.click(includeIndexColumnCheckbox);
    expect(screen.getByLabelText("Index Column Width (px)")).toBeTruthy();

    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    titleInput.value = "Monthly Winners";
    fireEvent.input(titleInput);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setReportsMock).toHaveBeenCalledTimes(1);
    });

    const payload = setReportsMock.mock.calls[0]?.[0] as Array<{
      id: number;
      title: string;
      tables: Array<{ titleLines?: string[]; rookieFilter?: string }>;
    }>;
    expect(payload).toHaveLength(3);
    expect(payload.some((item) => item.title === "Monthly Winners")).toBe(true);
    const newReport = payload.find((item) => item.title === "Monthly Winners");
    expect(typeof newReport?.id).toBe("number");
    expect(newReport?.tables).toHaveLength(1);
    expect(newReport?.tables[0]?.titleLines?.[0]).toBe("TOP ROOKIE");
    expect(newReport?.tables[0]?.rookieFilter).toBe("rookies");
  });

  it("saves the include footer total row setting per table", async () => {
    getReportsMock.mockResolvedValueOnce([
      buildTemplate(1, "Top Stats", [
        {
          id: 10,
          titleLines: ["TOP TABLE"],
          valueLabel: "Value",
          includeFooterTotalRow: false,
          metric: { type: "countClosings" },
          highlightMin: false,
          includeAllAgencies: true,
          includeAllAdvisors: true,
          rookieFilter: "all",
          rookieYears: 2,
          showIndex: false,
        },
      ]),
    ]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTitle("Edit report")[0]!);

    await waitFor(() => {
      expect(screen.getByText("Edit Report Template")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Edit leaderboard"));

    await waitFor(() => {
      expect(screen.getByText("Edit Leaderboard")).toBeTruthy();
    });

    const includeFooterTotalRowCheckbox = screen.getByLabelText(
      "Include Footer Total Row",
    ) as HTMLInputElement;
    expect(includeFooterTotalRowCheckbox.checked).toBe(false);

    fireEvent.click(includeFooterTotalRowCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save Leaderboard" }));

    await waitFor(() => {
      expect(screen.queryByText("Edit Leaderboard")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setReportsMock).toHaveBeenCalledTimes(1);
    });

    const payload = setReportsMock.mock.calls[0]?.[0] as Array<{
      id: number;
      tables?: Array<{ includeFooterTotalRow?: boolean }>;
    }>;
    expect(
      payload.find((item) => item.id === 1)?.tables?.[0]?.includeFooterTotalRow,
    ).toBe(true);
  });

  it("switches table labels to column labels for single-table templates", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Report Layout"), {
      target: { value: "combinedFsc" },
    });

    expect(screen.getByText("Metric Columns")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Metric Column" })).toBeTruthy();
    expect(screen.getByLabelText("Metric Column Gap (px)")).toBeTruthy();
    expect(screen.queryByLabelText("Leaderboard Gap (px)")).toBeNull();
  });

  it("labels value label as header for single-table columns", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Report Layout"), {
      target: { value: "combinedFsc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Metric Column" }));

    expect(screen.getByLabelText("Column Header")).toBeTruthy();
    expect(screen.queryByLabelText("Value Label")).toBeNull();
  });

  it("deletes a template and persists the updated list", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Rookie")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTitle("Delete report")[1]!);
    await waitFor(() => {
      expect(screen.getByText("Delete report?")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(setReportsMock).toHaveBeenCalledTimes(1);
    });

    const payload = setReportsMock.mock.calls[0]?.[0] as Array<{ id: number }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.id).toBe(1);
  });

  it("opens a preview modal for a template", async () => {
    getReportsMock.mockResolvedValueOnce([
      buildTemplate(1, "Top Stats", [
        {
          id: 10,
          titleLines: ["TOP TABLE"],
          valueLabel: "Value",
          metric: { type: "countClosings" },
        },
      ]),
    ]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]!);

    await waitFor(() => {
      expect(screen.getByText("Preview: Top Stats")).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByAltText("Preview for Top Stats")).toBeTruthy();
    });

    const preview = screen.getByAltText("Preview for Top Stats") as HTMLImageElement;
    expect(preview.getAttribute("src")).toBe("data:image/png;base64,preview");
    expect(loadImageMock).toHaveBeenCalledWith("/api/reports/logo");
    expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
  });

  it("opens a preview modal from the table editor using unsaved table changes", async () => {
    getReportsMock.mockResolvedValueOnce([
      buildTemplate(1, "Top Stats", [
        {
          id: 10,
          titleLines: ["TOP TABLE"],
          valueLabel: "Value",
          metric: { type: "countClosings" },
          minValue: 0,
          highlightMin: false,
          includeAllAgencies: true,
          includeAllAdvisors: true,
          rookieFilter: "all",
          rookieYears: 2,
          showIndex: false,
        },
      ]),
    ]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Edit report"));

    await waitFor(() => {
      expect(screen.getByText("Edit Report Template")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Edit leaderboard"));

    await waitFor(() => {
      expect(screen.getByText("Edit Leaderboard")).toBeTruthy();
    });

    const valueLabelInput = screen.getByLabelText("Value Label") as HTMLInputElement;
    valueLabelInput.value = "Updated Value";
    fireEvent.input(valueLabelInput);

    const previewButtons = screen.getAllByRole("button", { name: "Preview" });
    fireEvent.click(previewButtons[previewButtons.length - 1]!);

    await waitFor(() => {
      expect(screen.getByText("Preview: Top Stats")).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByAltText("Preview for Top Stats")).toBeTruthy();
    });

    expect(buildReportCanvasMock).toHaveBeenCalledTimes(1);
    const previewCall = buildReportCanvasMock.mock.calls[0]?.[0] as {
      report: { tables: Array<{ valueLabel: string }> };
    };
    expect(previewCall.report.tables[0]?.valueLabel).toBe("Updated Value");
  });

  it("renders the add table button below the existing table list in the editor", async () => {
    getReportsMock.mockResolvedValueOnce([
      buildTemplate(1, "Top Stats", [
        {
          id: 10,
          titleLines: ["TOP TABLE"],
          valueLabel: "Value",
          metric: { type: "countClosings" },
          minValue: 0,
          highlightMin: false,
          includeAllAgencies: true,
          includeAllAdvisors: true,
          rookieFilter: "all",
          rookieYears: 2,
          showIndex: false,
        },
      ]),
    ]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Edit report"));

    await waitFor(() => {
      expect(screen.getByText("Edit Report Template")).toBeTruthy();
    });

    const tableLabel = screen.getByText("TOP TABLE");
    const addTableButton = screen.getByRole("button", { name: "Add Leaderboard" });
    const bottomFootnoteLabel = screen.getByText("Bottom Footnote");

    expect(
      tableLabel.compareDocumentPosition(addTableButton)
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      addTableButton.compareDocumentPosition(bottomFootnoteLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("adds a new table with blank editable fields and default placeholders", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Leaderboard" }));

    const titleLinesInput = screen.getByLabelText(
      "Title Lines (one per line)",
    ) as HTMLTextAreaElement;
    const valueLabelInput = screen.getByLabelText("Value Label") as HTMLInputElement;
    const targetInput = screen.getByLabelText("Target") as HTMLInputElement;
    const footnoteInputs = screen.getAllByLabelText(
      /Footnote/,
    ) as HTMLTextAreaElement[];
    const footnoteInput = footnoteInputs[footnoteInputs.length - 1]!;

    expect(titleLinesInput.value).toBe("");
    expect(titleLinesInput.placeholder).toBe(
      "e.g. TOP ADVISER\n(TOTAL FYC)\nMinimum: $8,000",
    );
    expect(valueLabelInput.value).toBe("");
    expect(valueLabelInput.placeholder).toBe("e.g. FYC ($)");
    expect(targetInput.value).toBe("");
    expect(targetInput.placeholder).toBe("e.g. 8000");
    expect(footnoteInput.value).toBe("");
    expect(footnoteInput.getAttribute("placeholder")).toBeNull();
    expect(screen.queryByText("Rookie # years")).toBeNull();
    expect(
      screen.queryByText("Use {YYYY} to indicate rookie start year."),
    ).toBeNull();
    const includeAllAdvisorsCheckbox = screen.getByLabelText(
      "Include all advisors",
    ) as HTMLInputElement;
    const includeAllAdvisorsLabel = screen.getByText("Include all advisors");
    const includeAllAgenciesLabel = screen.getByText("Include all agencies");
    expect(screen.getByText("Include all non-legacy agencies")).toBeTruthy();
    const rookiesCheckbox = screen.getByLabelText("Rookies") as HTMLInputElement;
    const nonRookiesCheckbox = screen.getByLabelText(
      "Non-rookies",
    ) as HTMLInputElement;
    expect(includeAllAdvisorsCheckbox.checked).toBe(true);
    expect(rookiesCheckbox.checked).toBe(true);
    expect(nonRookiesCheckbox.checked).toBe(true);
    expect(rookiesCheckbox.disabled).toBe(false);
    expect(nonRookiesCheckbox.disabled).toBe(false);

    fireEvent.click(nonRookiesCheckbox);

    expect(includeAllAdvisorsCheckbox.checked).toBe(false);
    expect(rookiesCheckbox.checked).toBe(true);
    expect(nonRookiesCheckbox.checked).toBe(false);
    expect(screen.getByText("Rookie # years")).toBeTruthy();
    const footnoteHelper = screen.getByText(
      "Use {YYYY} to indicate rookie start year.",
    );
    expect(
      footnoteHelper.compareDocumentPosition(footnoteInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(includeAllAdvisorsLabel.textContent).toBe("Include all advisors");
    expect(includeAllAgenciesLabel.textContent).toBe("Include all agencies");
  });

  it("preserves spaces and blank lines while editing title lines", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Leaderboard" }));

    const titleLinesInput = screen.getByLabelText(
      "Title Lines (one per line)",
    ) as HTMLTextAreaElement;

    titleLinesInput.value = "TOP ";
    fireEvent.input(titleLinesInput);
    expect(titleLinesInput.value).toBe("TOP ");

    titleLinesInput.value = "TOP\n";
    fireEvent.input(titleLinesInput);
    expect(titleLinesInput.value).toBe("TOP\n");
  });

  it("treats empty source filters as all selected and edits them in the source picker modal", async () => {
    getSourcesMock.mockResolvedValueOnce([
      {
        id: "db-source",
        label: "Database Source",
        description: "",
        children: [
          { id: "db-item-1", label: "Database Item 1" },
          { id: "db-item-2", label: "Database Item 2" },
        ],
      },
      { id: "ref-source", label: "Referral Source", description: "", children: [] },
    ]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Leaderboard" }));

    await waitFor(() => {
      expect(screen.getByText("All sources and items")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Source Picker" }));

    await waitFor(() => {
      expect(screen.getByText("Select Sources")).toBeTruthy();
    });

    const databaseSourceCheckbox = screen.getByLabelText(
      "Database Source",
    ) as HTMLInputElement;
    const referralSourceCheckbox = screen.getByLabelText(
      "Referral Source",
    ) as HTMLInputElement;
    const databaseItemOneCheckbox = screen.getByLabelText(
      "Database Item 1",
    ) as HTMLInputElement;

    expect(databaseSourceCheckbox.checked).toBe(true);
    expect(referralSourceCheckbox.checked).toBe(true);
    expect(databaseItemOneCheckbox.checked).toBe(true);

    fireEvent.click(databaseSourceCheckbox);

    expect(databaseSourceCheckbox.checked).toBe(false);
    expect(referralSourceCheckbox.checked).toBe(true);
    expect(databaseItemOneCheckbox.checked).toBe(false);

    fireEvent.click(databaseSourceCheckbox);

    expect(databaseSourceCheckbox.checked).toBe(true);
    expect(referralSourceCheckbox.checked).toBe(true);
    expect(databaseItemOneCheckbox.checked).toBe(true);

    fireEvent.click(databaseItemOneCheckbox);

    expect(databaseSourceCheckbox.checked).toBe(false);
    expect(databaseItemOneCheckbox.checked).toBe(false);

    const addTableButtons = screen.getAllByRole("button", {
      name: "Add Leaderboard",
    });
    fireEvent.click(addTableButtons[addTableButtons.length - 1]!);

    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setReportsMock).toHaveBeenCalledTimes(1);
    });

    const payload = setReportsMock.mock.calls[0]?.[0] as Array<{
      tables: Array<{ sources?: string[]; sourceItemIds?: string[] }>;
    }>;
    const newReport = payload[payload.length - 1]!;
    const savedTable = newReport.tables[newReport.tables.length - 1]!;

    expect(savedTable.sources).toEqual(["ref-source"]);
    expect(savedTable.sourceItemIds).toEqual(["db-item-2"]);
  });

  it("marks deleted sources and source items as legacy in the source picker", async () => {
    getSourcesMock.mockResolvedValueOnce([
      {
        id: "roadshow",
        label: "Roadshow",
        description: "",
        isDeleted: true,
        children: [
          { id: "legacy-item", label: "Legacy Booth", isDeleted: true },
          { id: "active-item", label: "Current Booth" },
        ],
      },
    ]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    expect(getSourcesMock).toHaveBeenCalledWith({ includeDeletedItems: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Leaderboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Source Picker" }));

    await waitFor(() => {
      expect(screen.getByText("Legacy Booth (legacy)")).toBeTruthy();
    });

    expect(screen.getByText("Roadshow (legacy)")).toBeTruthy();
    expect(screen.getByLabelText("Roadshow (legacy)")).toBeTruthy();
    expect(screen.getByLabelText("Legacy Booth (legacy)")).toBeTruthy();
    expect(screen.getByLabelText("Current Booth")).toBeTruthy();
  });

  it("keeps agency checkboxes interactive when include all agencies is enabled", async () => {
    getTeamDataMock.mockResolvedValueOnce({
      users: [],
      agencies: [
        { code: "AG01", name: "Agency 01" },
        { code: "OLD1", name: "Legacy Agency", isDeleted: true },
      ],
    });

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Leaderboard" }));

    const includeAllAgenciesCheckbox = screen.getByLabelText(
      "Include all agencies",
    ) as HTMLInputElement;
    const includeAllNonLegacyAgenciesCheckbox = screen.getByLabelText(
      "Include all non-legacy agencies",
    ) as HTMLInputElement;
    const agencyCheckbox = screen.getByLabelText(/AG01/) as HTMLInputElement;
    const legacyAgencyCheckbox = screen.getByLabelText(/OLD1/) as HTMLInputElement;
    expect(includeAllAgenciesCheckbox.checked).toBe(true);
    expect(includeAllNonLegacyAgenciesCheckbox.checked).toBe(false);
    expect(agencyCheckbox.checked).toBe(true);
    expect(legacyAgencyCheckbox.checked).toBe(true);
    expect(agencyCheckbox.disabled).toBe(false);
    expect(screen.getByText("OLD1 — Legacy Agency (legacy)")).toBeTruthy();

    fireEvent.click(includeAllNonLegacyAgenciesCheckbox);

    expect(includeAllAgenciesCheckbox.checked).toBe(false);
    expect(includeAllNonLegacyAgenciesCheckbox.checked).toBe(true);
    expect(agencyCheckbox.checked).toBe(true);
    expect(legacyAgencyCheckbox.checked).toBe(false);

    fireEvent.click(agencyCheckbox);

    expect(includeAllAgenciesCheckbox.checked).toBe(false);
    expect(includeAllNonLegacyAgenciesCheckbox.checked).toBe(false);
    expect(agencyCheckbox.checked).toBe(false);
    expect(legacyAgencyCheckbox.checked).toBe(false);
  });

  it("shows selected legacy product types in the table editor", async () => {
    getReportsMock.mockResolvedValueOnce([
      buildTemplate(1, "Top Stats", [
        {
          id: 100,
          titleLines: ["LEGACY PRODUCT TYPE"],
          valueLabel: "Value",
          highlightMin: false,
          includeAllAgencies: true,
          includeAllAdvisors: true,
          rookieFilter: "all",
          rookieYears: 2,
          productTypeKeys: ["legacyType"],
          metric: { type: "countClosings" },
        },
      ]),
    ]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Edit report"));

    await waitFor(() => {
      expect(screen.getByText("Edit Report Template")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Edit leaderboard"));

    await waitFor(() => {
      expect(screen.getByText("Edit Leaderboard")).toBeTruthy();
    });

    expect(screen.getByLabelText("legacyType (legacy)")).toBeTruthy();
  });

  it("requires at least one agency and one advisor group, and non-rookies stays independent", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Leaderboard" }));

    const includeAllAgenciesCheckbox = screen.getByLabelText(
      "Include all agencies",
    ) as HTMLInputElement;
    const includeAllAdvisorsCheckbox = screen.getByLabelText(
      "Include all advisors",
    ) as HTMLInputElement;
    const rookiesCheckbox = screen.getByLabelText("Rookies") as HTMLInputElement;
    const nonRookiesCheckbox = screen.getByLabelText(
      "Non-rookies",
    ) as HTMLInputElement;
    const agencyCheckbox = screen.getByLabelText(/AG01/) as HTMLInputElement;
    const addTableButtons = screen.getAllByRole("button", {
      name: "Add Leaderboard",
    });
    const saveTableButton = addTableButtons[addTableButtons.length - 1] as HTMLButtonElement;

    fireEvent.click(includeAllAgenciesCheckbox);
    fireEvent.click(includeAllAdvisorsCheckbox);

    expect(includeAllAgenciesCheckbox.checked).toBe(false);
    expect(includeAllAdvisorsCheckbox.checked).toBe(false);
    expect(rookiesCheckbox.checked).toBe(false);
    expect(nonRookiesCheckbox.checked).toBe(false);
    expect(saveTableButton.disabled).toBe(true);
    expect(screen.getByText("Select at least one agency.")).toBeTruthy();
    expect(screen.getByText("Select at least one advisor group.")).toBeTruthy();

    fireEvent.click(nonRookiesCheckbox);

    expect(nonRookiesCheckbox.checked).toBe(true);
    expect(rookiesCheckbox.checked).toBe(false);
    expect(includeAllAdvisorsCheckbox.checked).toBe(false);
    expect(saveTableButton.disabled).toBe(true);
    expect(screen.queryByText("Select at least one advisor group.")).toBeNull();

    fireEvent.click(agencyCheckbox);

    expect(includeAllAgenciesCheckbox.checked).toBe(true);
    expect(agencyCheckbox.disabled).toBe(false);
    expect(saveTableButton.disabled).toBe(false);
    expect(screen.queryByText("Select at least one agency.")).toBeNull();
  });

  it("shows the updated metric options in the table editor", async () => {
    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add Report Template" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Leaderboard" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Metric Type")).toBeTruthy();
    });

    const metricSelect = screen.getByLabelText("Metric Type") as HTMLSelectElement;
    expect(Array.from(metricSelect.options).map((option) => option.textContent)).toEqual([
      "FYC",
      "AFYC",
      "FYP",
      "AFYP",
      "Referrals",
      "Case Count",
      "Closings",
    ]);
    expect(
      screen.queryByRole("option", { name: "Referrals Closed" }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: "Custom Field" })).toBeNull();
  });

  it("opens existing tables in a separate edit modal", async () => {
    getReportsMock.mockResolvedValueOnce([
      buildTemplate(1, "Top Stats", [
        {
          id: 10,
          titleLines: ["TOP TABLE"],
          valueLabel: "Value",
          metric: { type: "countClosings" },
          highlightMin: false,
          includeAllAgencies: true,
          includeAllAdvisors: true,
          rookieFilter: "all",
          rookieYears: 2,
          showIndex: false,
        },
      ]),
    ]);

    await renderManageReportTemplates();

    await waitFor(() => {
      expect(screen.getByText("Top Stats")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Edit report"));

    await waitFor(() => {
      expect(screen.getByText("Edit Report Template")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle("Edit leaderboard"));

    await waitFor(() => {
      expect(screen.getByText("Edit Leaderboard")).toBeTruthy();
    });

    expect(
      (screen.getByRole("button", { name: "Save Leaderboard" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByLabelText("Title Lines (one per line)"),
    ).toBeTruthy();
  });
});
