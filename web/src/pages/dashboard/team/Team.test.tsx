import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};
type LoadingProps = { label?: string };
type AccordionProps = {
  id?: string;
  open: boolean;
  onToggle: () => void;
  header: JSX.Element;
  children: JSX.Element;
};

const {
  subscribeUsersMock,
  getCurrentUserAccessLevelMock,
  getAgencyNamesMock,
  getAgenciesMock,
  getUsersMock,
} = vi.hoisted(() => ({
  subscribeUsersMock: vi.fn(),
  getCurrentUserAccessLevelMock: vi.fn(),
  getAgencyNamesMock: vi.fn(),
  getAgenciesMock: vi.fn(),
  getUsersMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineCalendarEvent: Icon,
    TbOutlineBuilding: Icon,
    TbOutlineCake: Icon,
    TbOutlinePencil: Icon,
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
  useNavigate: () => vi.fn(),
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
  LoadingState: (props: LoadingProps) => <div>{props.label || "Loading..."}</div>,
  BackToTopFab: () => null,
  IconButton: (props: any) => <button {...props}>{props.children}</button>,
  AccordionCard: (props: AccordionProps) => (
    <section id={props.id}>
      <button type="button" onClick={props.onToggle}>
        {props.header}
      </button>
      {props.open ? <div>{props.children}</div> : null}
    </section>
  ),
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    subscribeUsers: (...args: unknown[]) => subscribeUsersMock(...args),
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
    getAgencyNames: (...args: unknown[]) => getAgencyNamesMock(...args),
    getAgencies: (...args: unknown[]) => getAgenciesMock(...args),
    getUsers: (...args: unknown[]) => getUsersMock(...args),
  },
  isStaffUser: (fscCode?: string | null) => String(fscCode || "").startsWith("00"),
}));

const renderTeam = async () => {
  vi.resetModules();
  const { default: Team } = await import("./Team");
  return render(() => <Team />);
};

describe("Team page", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.animate) {
      Object.defineProperty(HTMLElement.prototype, "animate", {
        writable: true,
        value: () => ({ cancel: () => {} }),
      });
    }
  });

  beforeEach(() => {
    getAgencyNamesMock.mockResolvedValue({
      A01: "Agency One",
      B02: "Agency Two",
    });
    getAgenciesMock.mockResolvedValue([
      { code: "A01", name: "Agency One" },
      { code: "B02", name: "Agency Two" },
    ]);
    getCurrentUserAccessLevelMock.mockResolvedValue({
      isAdmin: false,
      accessLevel: "standard",
    });
    getUsersMock.mockResolvedValue([]);
    subscribeUsersMock.mockImplementation((onChange: (list: any[]) => void) => {
      onChange([]);
      return () => {};
    });
  });

  it("shows loading state while team members are still loading", async () => {
    subscribeUsersMock.mockImplementation(() => () => {});

    await renderTeam();

    expect(screen.getByText("Loading team members...")).toBeTruthy();
  });

  it("shows error state when team subscription fails", async () => {
    subscribeUsersMock.mockImplementation(
      (_onChange: (list: any[]) => void, onError?: (error: unknown) => void) => {
        onError?.(new Error("boom"));
        return () => {};
      },
    );

    await renderTeam();

    await waitFor(() => {
      expect(screen.getByText("Unable to load team members right now.")).toBeTruthy();
    });
  });

  it("shows empty messages for birthday and agency views", async () => {
    subscribeUsersMock.mockImplementation((onChange: (list: any[]) => void) => {
      onChange([]);
      return () => {};
    });

    await renderTeam();

    await waitFor(() => {
      expect(screen.getByText("No birthdays to show yet.")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /agencies/i }));
    expect(screen.getByText("No team members to show yet.")).toBeTruthy();
  });

  it("groups birthday members, filters users without birth date, and sorts by day", async () => {
    const currentMonth = new Date().getMonth() + 1;

    subscribeUsersMock.mockImplementation((onChange: (list: any[]) => void) => {
      onChange([
        {
          id: "u1",
          nickname: "Alice",
          agencyCode: "A01",
          fscCode: "12345",
          birthMonth: currentMonth,
          birthDay: 20,
        },
        {
          id: "u2",
          nickname: "Bob",
          agencyCode: "B02",
          fscCode: "00111",
          birthMonth: currentMonth,
          birthDay: 5,
        },
        {
          id: "u3",
          nickname: "NoBirthday",
          agencyCode: "A01",
          fscCode: "99999",
        },
      ]);
      return () => {};
    });

    await renderTeam();

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeTruthy();
    });

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.queryByText("NoBirthday")).toBeNull();
    expect(screen.getByText(/B02 \/ staff/i)).toBeTruthy();

    const content = document.body.textContent || "";
    expect(content.indexOf("Bob")).toBeLessThan(content.indexOf("Alice"));
  });

  it("shows agency grouping, counts, and sorted members when agency accordion is opened", async () => {
    subscribeUsersMock.mockImplementation((onChange: (list: any[]) => void) => {
      onChange([
        {
          id: "u1",
          nickname: "Agent High",
          agencyCode: "A01",
          fscCode: "20000",
          birthMonth: 1,
          birthDay: 1,
        },
        {
          id: "u2",
          nickname: "Staff Alpha",
          agencyCode: "A01",
          fscCode: "00100",
          birthMonth: 1,
          birthDay: 2,
        },
        {
          id: "u3",
          nickname: "Agent Low",
          agencyCode: "A01",
          fscCode: "10000",
          birthMonth: 1,
          birthDay: 3,
        },
        {
          id: "u4",
          nickname: "Bee",
          agencyCode: "B02",
          fscCode: "30000",
          birthMonth: 2,
          birthDay: 4,
        },
      ]);
      return () => {};
    });

    await renderTeam();

    fireEvent.click(screen.getByRole("button", { name: /agencies/i }));

    await waitFor(() => {
      expect(screen.getByText(/A01 — Agency One/)).toBeTruthy();
    });

    expect(screen.getByText(/2 Agents, 1 Staff/)).toBeTruthy();
    expect(screen.getByText(/B02 — Agency Two/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /A01 — Agency One/i }));

    await waitFor(() => {
      expect(screen.getByText("Staff Alpha")).toBeTruthy();
    });

    expect(screen.getByText("Agent Low")).toBeTruthy();
    expect(screen.getByText("Agent High")).toBeTruthy();
    expect(screen.getByText(/A01 \/ staff/i)).toBeTruthy();

    const content = document.body.textContent || "";
    expect(content.indexOf("Staff Alpha")).toBeLessThan(content.indexOf("Agent Low"));
    expect(content.indexOf("Agent Low")).toBeLessThan(content.indexOf("Agent High"));
  });

  it("unsubscribes from team updates on unmount", async () => {
    const unsubscribe = vi.fn();
    subscribeUsersMock.mockImplementation((onChange: (list: any[]) => void) => {
      onChange([]);
      return unsubscribe;
    });

    const view = await renderTeam();
    view.unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
