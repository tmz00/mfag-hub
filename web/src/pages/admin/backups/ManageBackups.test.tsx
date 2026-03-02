import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Show, type JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManageBackups from "./ManageBackups";

type WrapperProps = { children?: JSX.Element };
type ModalProps = {
  open?: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  confirmLoading?: boolean;
  confirmLoadingLabel?: string;
  hideCancel?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
};

const {
  navigateMock,
  getCurrentUserAccessLevelMock,
  getSnapshotsMock,
  restoreSnapshotMock,
  exportDatabaseBackupMock,
  importDatabaseBackupMock,
  exportUploadedFilesBackupMock,
  importUploadedFilesBackupMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getCurrentUserAccessLevelMock: vi.fn(),
  getSnapshotsMock: vi.fn(),
  restoreSnapshotMock: vi.fn(),
  exportDatabaseBackupMock: vi.fn(),
  importDatabaseBackupMock: vi.fn(),
  exportUploadedFilesBackupMock: vi.fn(),
  importUploadedFilesBackupMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineCloudDownload: Icon,
    TbOutlineCloudUpload: Icon,
    TbOutlineHistory: Icon,
    TbOutlineRotateClockwise2: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/admin/backups" }),
  useNavigate: () => navigateMock,
}));

vi.mock("../adminOptions", () => ({
  adminOptionForPath: () => ({
    title: "Backups",
    description: "Export and restore backups",
    icon: () => null,
  }),
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
  },
}));

vi.mock("../../../services/backupService", () => ({
  backupService: {
    getSnapshots: (...args: unknown[]) => getSnapshotsMock(...args),
    restoreSnapshot: (...args: unknown[]) => restoreSnapshotMock(...args),
    exportDatabaseBackup: (...args: unknown[]) =>
      exportDatabaseBackupMock(...args),
    importDatabaseBackup: (...args: unknown[]) =>
      importDatabaseBackupMock(...args),
    exportUploadedFilesBackup: (...args: unknown[]) =>
      exportUploadedFilesBackupMock(...args),
    importUploadedFilesBackup: (...args: unknown[]) =>
      importUploadedFilesBackupMock(...args),
  },
}));

vi.mock("../../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <main>{props.children}</main>,
  PageHeader: (props: { title?: JSX.Element | string; subtitle?: string }) => (
    <header>
      <h1>{props.title}</h1>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
  Alert: (props: WrapperProps) => <div>{props.children}</div>,
  Button: (props: any) => (
    <button
      type="button"
      data-variant={props.variant}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  LoadingState: (props: { label?: string }) => <div>{props.label}</div>,
  Spinner: () => <span>Loading</span>,
  ConfirmModal: (props: ModalProps) => (
    <Show when={props.open}>
      <section>
        <h2>{props.title}</h2>
        <p>{props.message}</p>
        <button
          type="button"
          disabled={props.confirmLoading}
          onClick={props.onConfirm}
        >
          {props.confirmLoading
            ? props.confirmLoadingLabel || props.confirmLabel
            : props.confirmLabel}
        </button>
        {props.hideCancel ? null : (
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </section>
    </Show>
  ),
}));

describe("ManageBackups", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getCurrentUserAccessLevelMock.mockReset();
    getSnapshotsMock.mockReset();
    restoreSnapshotMock.mockReset();
    exportDatabaseBackupMock.mockReset();
    importDatabaseBackupMock.mockReset();
    exportUploadedFilesBackupMock.mockReset();
    importUploadedFilesBackupMock.mockReset();

    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "admin",
      isAdmin: true,
    });
    getSnapshotsMock.mockResolvedValue([]);
    restoreSnapshotMock.mockResolvedValue(undefined);
    exportDatabaseBackupMock.mockResolvedValue(undefined);
    importDatabaseBackupMock.mockResolvedValue(undefined);
    exportUploadedFilesBackupMock.mockResolvedValue(undefined);
    importUploadedFilesBackupMock.mockResolvedValue(undefined);
  });

  it("blocks non-admin and non-editor users before loading snapshots", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValueOnce({
      accessLevel: "standard",
      isAdmin: false,
    });

    render(() => <ManageBackups />);

    expect(
      await screen.findByText("Only admins and editors can access backup tools."),
    ).toBeTruthy();
    expect(getSnapshotsMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Backup & Restore")).toBeNull();
  });

  it("loads snapshots for admins and refreshes them after restoring a snapshot", async () => {
    getSnapshotsMock
      .mockResolvedValueOnce([
        {
          id: "snapshot-1",
          feature: "products",
          summary: "Quarter-end products",
          createdAt: new Date("2026-02-14T09:30:00.000Z"),
          createdBy: "Editor One",
        },
        {
          id: "snapshot-2",
          feature: "reports",
          summary: "after adding Monthly Winners",
          createdAt: new Date("2026-02-15T09:30:00.000Z"),
          createdBy: "Admin One",
        },
      ])
      .mockResolvedValueOnce([]);

    render(() => <ManageBackups />);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs[0]?.textContent).toContain("Report Templates");
    expect(tabs[1]?.textContent).toContain("Products");
    expect(
      await screen.findByText(
        "after adding Monthly Winners",
      ),
    ).toBeTruthy();
    expect((await screen.findAllByText("Report Templates")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Database" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Uploaded Files" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Export Database" }).getAttribute("data-variant"),
    ).toBe("admin");
    expect(
      screen.getByRole("button", { name: "Import Database" }).getAttribute("data-variant"),
    ).toBe("dangerSolid");
    expect(
      screen.getByRole("button", { name: "Export Files" }).getAttribute("data-variant"),
    ).toBe("admin");
    expect(
      screen.getByRole("button", { name: "Import Files" }).getAttribute("data-variant"),
    ).toBe("dangerSolid");
    expect(
      screen.getAllByRole("button", { name: "Restore" })[0]?.getAttribute("data-variant"),
    ).toBe("adminOutline");

    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]!);

    expect(await screen.findByText("Restore Snapshot?")).toBeTruthy();
    const restoreButtons = screen.getAllByRole("button", { name: "Restore" });
    fireEvent.click(restoreButtons[restoreButtons.length - 1]!);

    await waitFor(() => {
      expect(restoreSnapshotMock).toHaveBeenCalledWith("snapshot-2");
    });
    await waitFor(() => {
      expect(getSnapshotsMock).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByText("The selected snapshot was restored successfully."),
    ).toBeTruthy();
    expect(await screen.findByText("No recent snapshots yet.")).toBeTruthy();
  });

  it("hides database tools for editors and restores uploaded files from the selected archive", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValueOnce({
      accessLevel: "editor",
      isAdmin: false,
    });

    const { container } = render(() => <ManageBackups />);

    expect(
      await screen.findByText(/Database backup tools are limited to admins\./i),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Database" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Uploaded Files" })).toBeTruthy();

    const fileInput = container.querySelector(
      "input[type='file'][accept*='application/x-tar']",
    ) as HTMLInputElement;
    const archive = new File(["archive"], "uploaded-files.tar.gz", {
      type: "application/gzip",
    });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [archive],
    });

    fireEvent.change(fileInput);

    expect(await screen.findByText("Import Uploaded Files?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(importUploadedFilesBackupMock).toHaveBeenCalledWith(archive);
    });
    expect(
      await screen.findByText("The uploaded files archive was restored."),
    ).toBeTruthy();
  });
});
