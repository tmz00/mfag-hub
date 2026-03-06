import { render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Admin from "./Admin";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};
type LoadingProps = { label?: string };
type LinkProps = { href?: string; children?: JSX.Element };

const { getCurrentUserAccessLevelMock } = vi.hoisted(() => ({
  getCurrentUserAccessLevelMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
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
    TbOutlineSettings: Icon,
    TbOutlineScale: Icon,
    TbOutlineHourglass: Icon,
    TbOutlinePlant: Icon,
    TbOutlineCrosshair: Icon,
    TbOutlineShield: Icon,
    TbOutlinePercentage: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  A: (props: LinkProps) => <a href={props.href}>{props.children}</a>,
  useNavigate: () => () => undefined,
}));

vi.mock("../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <main>{props.children}</main>,
  PageHeader: (props: HeaderProps) => (
    <header>
      <h1>{props.title}</h1>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
  LoadingState: (props: LoadingProps) => <div>{props.label || "Loading..."}</div>,
}));

vi.mock("../../services/teamService", () => ({
  teamService: {
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
  },
}));

describe("Admin page", () => {
  beforeEach(() => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      isAdmin: true,
      accessLevel: "admin",
    });
  });

  it("shows loading state while admin access is being resolved", async () => {
    let resolveAccess:
      | ((value: { isAdmin: boolean; accessLevel: string }) => void)
      | undefined;
    getCurrentUserAccessLevelMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAccess = resolve;
      }),
    );

    render(() => <Admin />);

    expect(screen.getByText("Loading admin tools...")).toBeTruthy();

    resolveAccess?.({ isAdmin: true, accessLevel: "admin" });
    await waitFor(() => {
      expect(screen.getByText("Manage Team")).toBeTruthy();
    });
  });

  it("shows access error for non-admin and non-editor users", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      isAdmin: false,
      accessLevel: "standard",
    });

    render(() => <Admin />);

    await waitFor(() => {
      expect(
        screen.getByText("You do not have access to the admin area."),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Manage Team")).toBeNull();
  });

  it("limits available options for editor users", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      isAdmin: false,
      accessLevel: "editor",
    });

    render(() => <Admin />);

    await waitFor(() => {
      expect(screen.getByText("Manage Handbook")).toBeTruthy();
    });

    expect(screen.getByText("Manage Products")).toBeTruthy();
    expect(screen.getByText("Manage Closing Sources")).toBeTruthy();
    expect(screen.getByText("Manage Backups")).toBeTruthy();
    expect(screen.queryByText("Manage Team")).toBeNull();
    expect(screen.queryByText("Generate Reports")).toBeNull();
    expect(screen.queryByText("Manage Report Templates")).toBeNull();
    expect(screen.queryByText("Manage Notifications")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("shows all admin options for admin users", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      isAdmin: true,
      accessLevel: "admin",
    });

    render(() => <Admin />);

    await waitFor(() => {
      expect(screen.getByText("Generate Reports")).toBeTruthy();
    });

    expect(screen.getByText("Manage Report Templates")).toBeTruthy();
    expect(screen.getByText("Manage Notifications")).toBeTruthy();
    expect(screen.getByText("Manage Closing Sources")).toBeTruthy();
    expect(screen.getByText("Manage Products")).toBeTruthy();
    expect(screen.getByText("Manage Team")).toBeTruthy();
    expect(screen.getByText("Manage Handbook")).toBeTruthy();
    expect(screen.getByText("Manage Backups")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(8);
  });
});
