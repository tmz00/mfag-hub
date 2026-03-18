import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JSX } from "solid-js";
import type { DraftProduct } from "./SubmitClosing";
import PlanEditor from "./PlanEditor";
import { clearSavedState, setEditPlan } from "./_submitStore";

type WrapperProps = {
  children?: JSX.Element;
};

const { navigateMock, getProductsMock, skipGuardMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getProductsMock: vi.fn(),
  skipGuardMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineMinus: Icon,
    TbOutlinePlus: Icon,
    TbOutlinePencil: Icon,
    TbOutlineTrash: Icon,
    TbOutlinePuzzle: Icon,
    TbOutlineSearch: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../../components/ui", () => ({
  Button: (props: any) => (
    <button type={props.type ?? "button"} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  IconButton: (props: any) => (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props["aria-label"]}
      title={props.title}
    >
      {props.children}
    </button>
  ),
  PageHeader: (props: any) => (
    <header>
      <button type="button" onClick={props.onBack}>
        Back
      </button>
      {props.subtitle ? <p>{props.subtitle}</p> : null}
    </header>
  ),
  EditModal: (props: WrapperProps & { title: string; onClose: () => void; onSave?: () => void; saveLabel?: string }) => (
    <div>
      <h2>{props.title}</h2>
      <button type="button" onClick={props.onClose}>
        Close
      </button>
      <div>{props.children}</div>
      <button type="button" onClick={props.onSave}>
        {props.saveLabel || "Save"}
      </button>
    </div>
  ),
  createConfirm: () => [() => null, async () => true],
  createNavigationGuard: () => ({
    GuardModal: () => null,
    guardNavigate: (callback: () => void) => callback(),
    skipGuard: () => skipGuardMock(),
  }),
}));

vi.mock("../../../../services/productsService", () => ({
  productsService: {
    getProducts: (...args: unknown[]) => getProductsMock(...args),
  },
}));

vi.mock("./ProductPicker", () => ({
  default: () => null,
}));

describe("PlanEditor", () => {
  beforeEach(() => {
    clearSavedState();
    navigateMock.mockReset();
    getProductsMock.mockReset();
    skipGuardMock.mockReset();

    getProductsMock.mockResolvedValue({
      basePlans: [],
      riders: [],
      types: {
        regular: "Regular",
      },
    });

    const product: DraftProduct = {
      id: "plan-1",
      isRider: false,
      productId: "PLAN-1",
      fullName: "Starter Plan",
      shortName: "Starter",
      type: "regular",
      fycRate: 12,
      gst: false,
      premiumRows: [
        {
          id: "row-1",
          premium: 100,
          frequency: "Annual",
          quantity: 2,
        },
      ],
      riders: [],
    };

    setEditPlan({
      product,
      index: null,
      isAddon: false,
    });
  });

  afterEach(() => {
    clearSavedState();
  });

  it("supports editing quantity with inline stepper controls", async () => {
    render(() => <PlanEditor />);

    const summary = await screen.findByText("2 x $100.00 / Annual");
    fireEvent.click(summary.closest("button") as HTMLButtonElement);

    const quantityInput = screen.getByLabelText(
      "Quantity for entry 1",
    ) as HTMLInputElement;
    const incrementButton = screen.getByRole("button", {
      name: "Increase quantity for entry 1",
    });

    expect(quantityInput.value).toBe("2");
    expect(quantityInput.className).toContain("text-center");
    expect(quantityInput.className).toContain("px-0");

    fireEvent.click(incrementButton);
    expect(quantityInput.value).toBe("3");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("3 x $100.00 / Annual")).toBeTruthy();
    });
  });

  it("formats initial premium inputs with two decimal places", async () => {
    clearSavedState();
    setEditPlan({
      product: {
        id: "plan-1",
        isRider: false,
        productId: "PLAN-1",
        fullName: "Starter Plan",
        shortName: "Starter",
        type: "regular",
        fycRate: 12,
        gst: false,
        premiumRows: [
          {
            id: "row-1",
            premium: 550.5,
            frequency: "Annual",
            quantity: 1,
          },
        ],
        riders: [],
      },
      index: null,
      isAddon: false,
    });

    render(() => <PlanEditor />);

    const summary = await screen.findByText("1 x $550.50 / Annual");
    fireEvent.click(summary.closest("button") as HTMLButtonElement);

    const premiumInput = screen.getByDisplayValue("550.50") as HTMLInputElement;
    expect(premiumInput.value).toBe("550.50");
  });
});
