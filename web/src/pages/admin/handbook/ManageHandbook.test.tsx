import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Show, type JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};
type LoadingProps = { label?: string };
type AlertProps = { type?: "success" | "error"; children?: JSX.Element };
type ConfirmProps = {
  open: boolean;
  title: string;
  message?: unknown;
  confirmLabel?: string;
  confirmLoading?: boolean;
  confirmLoadingLabel?: string;
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};
type OverlayProps = {
  open: boolean;
  title: string;
  message?: string;
};

const {
  getCurrentUserAccessLevelMock,
  getCurrentUserMock,
  getHandbookEntriesMock,
  saveHandbookEntriesMock,
  uploadHandbookFileMock,
  deleteHandbookFileByPathMock,
  createConfirmMock,
} = vi.hoisted(() => ({
  getCurrentUserAccessLevelMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getHandbookEntriesMock: vi.fn(),
  saveHandbookEntriesMock: vi.fn(),
  uploadHandbookFileMock: vi.fn(),
  deleteHandbookFileByPathMock: vi.fn(),
  createConfirmMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineX: Icon,
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
  };
});

vi.mock("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/admin/handbook" }),
  useNavigate: () => () => undefined,
}));

vi.mock("../../../components/ui/createScrollLock", () => ({
  createScrollLock: vi.fn(),
}));

vi.mock("../../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <main>{props.children}</main>,
  PageHeader: (props: HeaderProps) => (
    <header>
      <h1>{props.title}</h1>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
  Alert: (props: AlertProps) => <div>{props.children}</div>,
  LoadingState: (props: LoadingProps) => <div>{props.label || "Loading..."}</div>,
  BlockingOverlay: (props: OverlayProps) => (
    <Show when={props.open}>
      <div>{props.title}</div>
      <p>{props.message}</p>
    </Show>
  ),
  ConfirmModal: (props: ConfirmProps) => (
    <Show when={props.open}>
      <div role="dialog">
        <h2>{props.title}</h2>
        <p>{String(props.message || "")}</p>
        <button type="button" onClick={props.onConfirm}>
          {props.confirmLoading
            ? props.confirmLoadingLabel || props.confirmLabel || "Confirm"
            : props.confirmLabel || "Confirm"}
        </button>
        {props.hideCancel ? null : (
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </Show>
  ),
  createConfirm: (options: { title: string }) => {
    const Modal = () => null;
    const confirm = () => createConfirmMock(options);
    return [Modal, confirm] as const;
  },
}));

vi.mock("./modals/HandbookEditModal", () => ({
  HandbookEditModal: (props: any) => (
    <div>
      <h2>{props.title}</h2>
      <button type="button" onClick={() => props.onCategoryChange("Retirement")}>
        Set Category
      </button>
      <button
        type="button"
        onClick={() => props.onContentChange("<p>Retirement details</p>")}
      >
        Set Content
      </button>
      <button type="button" onClick={props.onSave}>
        Save Entry
      </button>
      <button type="button" onClick={props.onClose}>
        Close Entry
      </button>
    </div>
  ),
}));

vi.mock("./modals/HandbookEditPickerModal", () => ({
  HandbookEditPickerModal: (props: any) => (
    <div>
      <p>Picker Modal</p>
      <button type="button" onClick={() => props.onEdit(0)}>
        Edit First
      </button>
      <button type="button" onClick={() => props.onDelete(0)}>
        Delete First
      </button>
      <button type="button" onClick={props.onClose}>
        Close Picker
      </button>
    </div>
  ),
}));

vi.mock("./modals/HandbookReorderModal", () => ({
  HandbookReorderModal: (props: any) => (
    <div>
      <p>Reorder Modal</p>
      <button type="button" onClick={props.onSave}>
        Save Reorder
      </button>
      <button type="button" onClick={props.onClose}>
        Close Reorder
      </button>
    </div>
  ),
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
  },
}));

vi.mock("../../../services/authService", () => ({
  authService: {
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  },
}));

vi.mock("../../../services/handbookContentService", () => ({
  getHandbookEntries: (...args: unknown[]) => getHandbookEntriesMock(...args),
  saveHandbookEntries: (...args: unknown[]) => saveHandbookEntriesMock(...args),
}));

vi.mock("../../../services/handbookFilesService", () => ({
  uploadHandbookFile: (...args: unknown[]) => uploadHandbookFileMock(...args),
  deleteHandbookFileByPath: (...args: unknown[]) =>
    deleteHandbookFileByPathMock(...args),
}));

const buildEntries = () => [
  {
    category: "Claims",
    imageUrl: "",
    imagePath: "",
    content: "<p>Claims overview</p>",
  },
  {
    category: "Policy",
    imageUrl: "",
    imagePath: "",
    content: "<p>Policy details</p>",
  },
];

const renderManageHandbook = async () => {
  const { default: ManageHandbook } = await import("./ManageHandbook");
  return render(() => <ManageHandbook />);
};

describe("ManageHandbook admin page", () => {
  beforeEach(() => {
    getCurrentUserAccessLevelMock.mockReset();
    getCurrentUserMock.mockReset();
    getHandbookEntriesMock.mockReset();
    saveHandbookEntriesMock.mockReset();
    uploadHandbookFileMock.mockReset();
    deleteHandbookFileByPathMock.mockReset();
    createConfirmMock.mockReset();

    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "editor",
      isAdmin: false,
    });
    getCurrentUserMock.mockReturnValue({ nickname: "Test Editor" });
    getHandbookEntriesMock.mockResolvedValue(buildEntries());
    saveHandbookEntriesMock.mockResolvedValue(undefined);
    uploadHandbookFileMock.mockResolvedValue({
      id: 1,
      path: "handbook/categories/image.png",
      name: "image.png",
      sizeBytes: 200,
      mimeType: "image/png",
      url: "/api/handbook/file/1",
    });
    deleteHandbookFileByPathMock.mockResolvedValue(undefined);
    createConfirmMock.mockResolvedValue(true);
  });

  it("blocks access for non-admin non-editor users", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "standard",
      isAdmin: false,
    });

    await renderManageHandbook();

    await waitFor(() => {
      expect(
        screen.getByText("You do not have access to manage the handbook."),
      ).toBeTruthy();
    });
    expect(getHandbookEntriesMock).not.toHaveBeenCalled();
  });

  it("adds a category and persists handbook entries", async () => {
    await renderManageHandbook();

    fireEvent.click(await screen.findByRole("button", { name: /add category/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Entry" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set Category" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Content" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Entry" }));

    await waitFor(() => {
      expect(saveHandbookEntriesMock).toHaveBeenCalledTimes(1);
    });

    const payload = saveHandbookEntriesMock.mock.calls[0]?.[0] as Array<{
      category: string;
      content?: string;
      updatedBy?: string;
      updatedAt?: string;
    }>;
    expect(payload).toHaveLength(3);
    expect(payload[2]).toMatchObject({
      category: "Retirement",
      content: "<p>Retirement details</p>",
      updatedBy: "Test Editor",
    });
    expect(typeof payload[2]?.updatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(payload[2]?.updatedAt || ""))).toBe(false);

    await waitFor(() => {
      expect(
        screen.getByText("Handbook category updated successfully."),
      ).toBeTruthy();
    });
  });

  it("deletes a selected category and saves the updated list", async () => {
    await renderManageHandbook();

    fireEvent.click(await screen.findByRole("button", { name: /edit category/i }));
    await waitFor(() => {
      expect(screen.getByText("Picker Modal")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete First" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(saveHandbookEntriesMock).toHaveBeenCalledTimes(1);
    });

    const payload = saveHandbookEntriesMock.mock.calls[0]?.[0] as Array<{
      category: string;
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.category).toBe("Policy");

    await waitFor(() => {
      expect(screen.getByText("Handbook category deleted successfully.")).toBeTruthy();
    });
  });

  it("does not show a manual cleanup action", async () => {
    await renderManageHandbook();

    await screen.findByRole("button", { name: /add category/i });

    expect(
      screen.queryByRole("button", { name: /clean up unused files/i }),
    ).toBeNull();
  });
});
