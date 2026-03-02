import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};
type AccordionProps = {
  open: boolean;
  onToggle: () => void;
  header: JSX.Element;
  children: JSX.Element;
};
type BrowserProps = {
  basePlans: Array<Record<string, unknown>>;
  riders: Array<Record<string, unknown>>;
  renderItem: (
    item: Record<string, unknown>,
    index: number,
    tab: "basePlans" | "riders",
    highlight: (text: string) => JSX.Element,
  ) => JSX.Element;
  initialTab?: "basePlans" | "riders";
  loading?: boolean;
  loadingFallback?: JSX.Element;
  onTabChange?: (tab: "basePlans" | "riders") => void;
};

const { getProductsMock, getCurrentUserAccessLevelMock } = vi.hoisted(() => ({
  getProductsMock: vi.fn(),
  getCurrentUserAccessLevelMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineArrowLeft: Icon,
    TbOutlineUsers: Icon,
    TbOutlinePackage: Icon,
    TbOutlineSettings: Icon,
    TbOutlineScale: Icon,
    TbOutlineHourglass: Icon,
    TbOutlinePlant: Icon,
    TbOutlineCrosshair: Icon,
    TbOutlineBell: Icon,
    TbOutlineShield: Icon,
  };
});

vi.mock("../../../components/ui", () => ({
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <main>{props.children}</main>,
  PageHeader: (props: HeaderProps) => (
    <header>
      <h1>{props.title}</h1>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
  AccordionCard: (props: AccordionProps) => (
    <section>
      <button type="button" onClick={props.onToggle}>
        {props.header}
      </button>
      {props.open ? <div>{props.children}</div> : null}
    </section>
  ),
}));

vi.mock("../../../components/ProductCatalogBrowser", () => ({
  default: (props: BrowserProps) => (
    <div>
      <div data-testid="catalog-tab">{props.initialTab || "basePlans"}</div>
      <button type="button" onClick={() => props.onTabChange?.("riders")}>
        Switch To Riders
      </button>
      {props.loading ? (
        <div>{props.loadingFallback}</div>
      ) : (
        <>
          <section data-testid="base-plans">
            {props.basePlans.map((item, index) =>
              props.renderItem(
                item,
                index,
                "basePlans",
                (text: string) => text as unknown as JSX.Element,
              ),
            )}
          </section>
          <section data-testid="riders">
            {props.riders.map((item, index) =>
              props.renderItem(
                item,
                index,
                "riders",
                (text: string) => text as unknown as JSX.Element,
              ),
            )}
          </section>
        </>
      )}
    </div>
  ),
}));

vi.mock("../../../services/productsService", () => ({
  productsService: {
    getProducts: (...args: unknown[]) => getProductsMock(...args),
  },
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
  },
}));

const renderProducts = async () => {
  vi.resetModules();
  const { default: Products } = await import("./Products");
  return render(() => <Products />);
};

describe("Products dashboard page", () => {
  beforeAll(() => {
    if (!globalThis.requestAnimationFrame) {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        writable: true,
        value: (callback: FrameRequestCallback) =>
          window.setTimeout(() => callback(performance.now()), 0),
      });
    }
  });

  beforeEach(() => {
    getProductsMock.mockReset();
    getCurrentUserAccessLevelMock.mockReset();
    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "standard",
      isAdmin: false,
    });
  });

  it("renders product details with frequency fallback and rider/base-plan links", async () => {
    getProductsMock.mockResolvedValue({
      basePlans: [
        {
          id: "bp1",
          category: "Savings",
          fullName: "Starter Plan",
          type: "regular",
          gst: "Y",
          attachableRiders: ["r1"],
        },
      ],
      riders: [
        {
          id: "r1",
          category: "Protection",
          fullName: "Critical Care",
          type: "pa",
        },
      ],
    });

    await renderProducts();

    await waitFor(() => {
      expect(screen.getByText("Starter Plan")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Starter Plan/i }));

    await waitFor(() => {
      expect(screen.getByText("Accepted Premium Frequencies")).toBeTruthy();
    });
    expect(screen.getByText("Annual")).toBeTruthy();
    expect(screen.getByTitle("Critical Care")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Critical Care"));

    await waitFor(() => {
      expect(screen.getByTestId("catalog-tab").textContent).toBe("riders");
    });

    await waitFor(() => {
      expect(screen.getByText("Attachable to Base Plans")).toBeTruthy();
    });
    expect(screen.getByTitle("Starter Plan")).toBeTruthy();
  });

  it("defaults single-premium plans to the Single frequency", async () => {
    getProductsMock.mockResolvedValue({
      basePlans: [
        {
          id: "bp-single",
          category: "Savings",
          fullName: "Single Saver",
          type: "single",
        },
      ],
      riders: [],
    });

    await renderProducts();

    await waitFor(() => {
      expect(screen.getByText("Single Saver")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Single Saver/i }));

    await waitFor(() => {
      expect(screen.getByText("Accepted Premium Frequencies")).toBeTruthy();
    });
    expect(screen.getByText("Single")).toBeTruthy();
    expect(screen.queryByText("Annual")).toBeNull();
  });
});
