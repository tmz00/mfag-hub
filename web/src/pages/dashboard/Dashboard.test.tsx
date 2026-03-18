import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  actions?: JSX.Element;
};
type LoadingProps = {
  label?: string;
};
type HandbookGridProps = {
  items: Array<{ id: string; label: string; imageUrl?: string }>;
  emptyMessage?: string;
  hrefForId?: (id: string) => string;
  viewTransitionNameForId?: (id: string) => string;
};

const {
  navigateMock,
  onAuthStateChangedMock,
  getCurrentUserMock,
  getHandbookEntriesMock,
  subscribeToUnreadCountMock,
  authUnsubscribeMock,
  notificationsUnsubscribeMock,
  handbookGridPropsMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  onAuthStateChangedMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getHandbookEntriesMock: vi.fn(),
  subscribeToUnreadCountMock: vi.fn(),
  authUnsubscribeMock: vi.fn(),
  notificationsUnsubscribeMock: vi.fn(),
  handbookGridPropsMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineSearch: Icon,
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
  A: (props: any) => <a href={props.href}>{props.children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock("../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <main>{props.children}</main>,
  PageHeader: (props: HeaderProps) => (
    <header>
      <h1>{props.title}</h1>
      {props.actions}
    </header>
  ),
  IconButton: (props: any) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
  LoadingState: (props: LoadingProps) => <div>{props.label || "Loading..."}</div>,
}));

vi.mock("../../components/HandbookCategoryGrid", () => ({
  HandbookCategoryGrid: (props: HandbookGridProps) => {
    handbookGridPropsMock(props);
    if (props.items.length === 0) {
      return <p>{props.emptyMessage || "No categories yet."}</p>;
    }
    return (
      <div>
        {props.items.map((item) => (
          <p>{item.label}</p>
        ))}
      </div>
    );
  },
}));

vi.mock("../../services/authService", () => ({
  authService: {
    onAuthStateChanged: (...args: unknown[]) => onAuthStateChangedMock(...args),
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  },
}));

vi.mock("../../services/handbookContentService", () => ({
  getHandbookEntries: (...args: unknown[]) => getHandbookEntriesMock(...args),
}));

vi.mock("../../services/notificationsService", () => ({
  notificationsService: {
    subscribeToUnreadCount: (...args: unknown[]) => subscribeToUnreadCountMock(...args),
  },
}));

const renderDashboard = async () => {
  vi.resetModules();
  const { default: Dashboard } = await import("./Dashboard");
  return render(() => <Dashboard />);
};

describe("Dashboard page", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    authUnsubscribeMock.mockReset();
    notificationsUnsubscribeMock.mockReset();
    handbookGridPropsMock.mockReset();

    onAuthStateChangedMock.mockImplementation((callback: (user: any) => void) => {
      callback({ uid: "user-1" });
      return authUnsubscribeMock;
    });
    getCurrentUserMock.mockReturnValue({
      uid: "user-1",
      accessLevel: "standard",
    });
    getHandbookEntriesMock.mockResolvedValue([
      { category: "Protection", imageUrl: "/images/protection.png" },
      { category: "Savings", imageUrl: "/images/savings.png" },
    ]);
    subscribeToUnreadCountMock.mockImplementation(
      (_uid: string, callback: (count: number) => void) => {
        callback(0);
        return notificationsUnsubscribeMock;
      },
    );
  });

  it("renders dashboard sections and hides admin quick access for standard users", async () => {
    await renderDashboard();

    expect(screen.getByText("Closings")).toBeTruthy();
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.getByText("Products")).toBeTruthy();
    expect(screen.queryByText("Admin")).toBeNull();

    expect(screen.getByText("BMI")).toBeTruthy();
    expect(screen.getByText("The Delay Tax")).toBeTruthy();
    expect(screen.getByText("The Compound Effect")).toBeTruthy();
    expect(screen.queryByText("Persistency")).toBeNull();

    await waitFor(() => {
      expect(screen.getByText("Protection")).toBeTruthy();
    });
    expect(screen.getByText("Savings")).toBeTruthy();
  });

  it("shows admin quick access for privileged users", async () => {
    getCurrentUserMock.mockReturnValue({
      uid: "user-1",
      accessLevel: "admin",
    });

    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Admin")).toBeTruthy();
    });
  });

  it("shows admin quick access for editor users", async () => {
    getCurrentUserMock.mockReturnValue({
      uid: "user-1",
      accessLevel: "editor",
    });

    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Admin")).toBeTruthy();
    });
  });

  it("navigates to handbook search from the search button", async () => {
    await renderDashboard();

    const searchButton = await screen.findByRole("button", {
      name: /search handbook/i,
    });
    fireEvent.click(searchButton);

    expect(navigateMock).toHaveBeenCalledWith("/handbook/search?returnTo=%2F");
  });

  it("shows unread badge and unsubscribes from listeners on unmount", async () => {
    subscribeToUnreadCountMock.mockImplementation(
      (_uid: string, callback: (count: number) => void) => {
        callback(120);
        return notificationsUnsubscribeMock;
      },
    );

    const view = await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("99+")).toBeTruthy();
    });
    expect(subscribeToUnreadCountMock).toHaveBeenCalledWith(
      "user-1",
      expect.any(Function),
    );

    view.unmount();

    expect(authUnsubscribeMock).toHaveBeenCalledTimes(1);
    expect(notificationsUnsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("shows handbook error when handbook categories cannot be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getHandbookEntriesMock.mockRejectedValueOnce(new Error("boom"));

    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Unable to load handbook categories")).toBeTruthy();
    });
  });

  it("uses 2 columns for even tool counts and 3 columns for odd tool counts", async () => {
    const { getToolsGridColumnsClass } = await import("./Dashboard");

    expect(getToolsGridColumnsClass(4)).toBe("lg:grid-cols-2");
    expect(getToolsGridColumnsClass(3)).toBe("lg:grid-cols-3");
  });
});
