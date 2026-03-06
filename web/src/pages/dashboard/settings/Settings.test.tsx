import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};

const { navigateMock, signOutMock, checkForAppUpdateAndReloadMock } = vi.hoisted(
  () => ({
    navigateMock: vi.fn(),
    signOutMock: vi.fn(),
    checkForAppUpdateAndReloadMock: vi.fn(),
  }),
);

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineLogout: Icon,
    TbOutlineRefresh: Icon,
    TbOutlineUsers: Icon,
    TbOutlinePackage: Icon,
    TbOutlineSettings: Icon,
    TbOutlineScale: Icon,
    TbOutlineHourglass: Icon,
    TbOutlinePlant: Icon,
    TbOutlineCrosshair: Icon,
    TbOutlineBell: Icon,
    TbOutlineShield: Icon,
    TbOutlinePercentage: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
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
  Button: (props: any) => (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));

vi.mock("./ProfileCard", () => ({
  default: () => <div data-testid="profile-card">Profile card</div>,
}));

vi.mock("../../../services/authService", () => ({
  authService: {
    signOut: (...args: unknown[]) => signOutMock(...args),
  },
}));

vi.mock("../../../utils/appUpdate", () => ({
  checkForAppUpdateAndReload: (...args: unknown[]) =>
    checkForAppUpdateAndReloadMock(...args),
}));

const renderSettings = async () => {
  vi.resetModules();
  const { default: Settings } = await import("./Settings");
  return render(() => <Settings />);
};

describe("Settings page", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    signOutMock.mockReset();
    checkForAppUpdateAndReloadMock.mockReset();

    signOutMock.mockResolvedValue(undefined);
    checkForAppUpdateAndReloadMock.mockResolvedValue(undefined);
  });

  it("renders page metadata and profile details card", async () => {
    await renderSettings();

    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Update your preferences")).toBeTruthy();
    expect(screen.getByText(/^Version /)).toBeTruthy();
    expect(screen.getByTestId("profile-card")).toBeTruthy();
  });

  it("checks for app updates and disables the button while refreshing", async () => {
    let resolveUpdateCheck: (() => void) | undefined;
    checkForAppUpdateAndReloadMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdateCheck = resolve;
        }),
    );

    await renderSettings();

    const refreshButton = screen.getByRole("button", {
      name: /check for updates/i,
    }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(false);

    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(checkForAppUpdateAndReloadMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(refreshButton.disabled).toBe(true);
    });

    resolveUpdateCheck?.();
  });

  it("signs out before redirecting to the home route", async () => {
    let resolveSignOut: (() => void) | undefined;
    signOutMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
    );

    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(navigateMock).not.toHaveBeenCalled();

    resolveSignOut?.();

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledTimes(1);
      expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    });
  });
});
