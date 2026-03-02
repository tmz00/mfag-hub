import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Show, type JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type HeaderProps = {
  title?: JSX.Element | string;
  subtitle?: string;
};
type LoadingProps = { label?: string };
type ConfirmProps = {
  open: boolean;
  title: string;
  message?: unknown;
  confirmLabel?: string;
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const {
  getProductsMock,
  setProductsMock,
  getCurrentUserAccessLevelMock,
  navigateMock,
} = vi.hoisted(() => ({
  getProductsMock: vi.fn(),
  setProductsMock: vi.fn(),
  getCurrentUserAccessLevelMock: vi.fn(),
  navigateMock: vi.fn(),
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
  };
});

vi.mock("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/admin/products" }),
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
  LoadingState: (props: LoadingProps) => <div>{props.label || "Loading..."}</div>,
  ConfirmModal: (props: ConfirmProps) => (
    <Show when={props.open}>
      <div role="dialog">
        <h2>{props.title}</h2>
        <p>{String(props.message || "")}</p>
        <button type="button" onClick={props.onConfirm}>
          {props.confirmLabel || "Confirm"}
        </button>
        {props.hideCancel ? null : (
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </Show>
  ),
}));

vi.mock("./modals", () => ({
  ProductGSTTypesModal: (props: any) => (
    <div>
      <p>GST Modal</p>
      <button type="button" onClick={() => props.onSaved({ ...props.catalog, gst: 9 })}>
        Save GST
      </button>
      <button type="button" onClick={() => props.onError("Unable to save GST.")}>
        GST Error
      </button>
      <button type="button" onClick={props.onClose}>
        Close GST
      </button>
    </div>
  ),
  ProductPickerModal: (props: any) => (
    <div>
      <p>Picker Modal</p>
      <button
        type="button"
        onClick={() => props.onEditProduct("basePlans", props.catalog.basePlans[0], 0)}
      >
        Edit First
      </button>
      <button
        type="button"
        onClick={() => props.onDeleteProduct("basePlans", props.catalog.basePlans[0], 0)}
      >
        Delete First
      </button>
      <button type="button" onClick={props.onClose}>
        Close Picker
      </button>
    </div>
  ),
  ProductEditorModal: (props: any) => (
    <div>
      <p>Editor Modal</p>
      <button type="button" onClick={() => props.onSaved(props.catalog, "Starter Plan")}>
        Save Editor
      </button>
      <button type="button" onClick={() => props.onError("Unable to save product.")}>
        Editor Error
      </button>
      <button type="button" onClick={props.onClose}>
        Close Editor
      </button>
    </div>
  ),
  ProductReorderModal: (props: any) => (
    <div>
      <p>Reorder Modal</p>
      <button type="button" onClick={props.onSaved}>
        Save Reorder
      </button>
      <button type="button" onClick={() => props.onError("Unable to reorder products.")}>
        Reorder Error
      </button>
      <button type="button" onClick={props.onClose}>
        Close Reorder
      </button>
    </div>
  ),
}));

vi.mock("../../../services/productsService", () => ({
  productsService: {
    getProducts: (...args: unknown[]) => getProductsMock(...args),
    setProducts: (...args: unknown[]) => setProductsMock(...args),
  },
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
  },
}));

const renderManageProducts = async () => {
  const { default: ManageProducts } = await import("./ManageProducts");
  return render(() => <ManageProducts />);
};

const buildCatalog = () => ({
  gst: 8,
  basePlans: [
    {
      id: "bp1",
      category: "Savings",
      fullName: "Starter Plan",
      type: "regular",
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

const getEnabledActionButton = async (name: RegExp) => {
  await waitFor(() => {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
  return screen.getByRole("button", { name }) as HTMLButtonElement;
};

describe("ManageProducts admin page", () => {
  beforeEach(() => {
    getProductsMock.mockReset();
    setProductsMock.mockReset();
    getCurrentUserAccessLevelMock.mockReset();
    navigateMock.mockReset();

    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "editor",
      isAdmin: false,
    });
    getProductsMock.mockResolvedValue(buildCatalog());
    setProductsMock.mockResolvedValue(undefined);
  });

  it("blocks access for non-admin non-editor users", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      accessLevel: "standard",
      isAdmin: false,
    });

    await renderManageProducts();

    await waitFor(() => {
      expect(
        screen.getByText("You do not have access to manage products."),
      ).toBeTruthy();
    });
    expect(getProductsMock).not.toHaveBeenCalled();
  });

  it("loads products and handles action modal success messages", async () => {
    await renderManageProducts();

    await getEnabledActionButton(/Edit GST \/ Type Definitions/i);
    expect(getProductsMock).toHaveBeenCalledWith(true);

    fireEvent.click(
      await getEnabledActionButton(/Edit GST \/ Type Definitions/i),
    );

    await waitFor(() => {
      expect(screen.getByText("GST Modal")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save GST" }));

    await waitFor(() => {
      expect(
        screen.getByText("GST and type definitions updated successfully."),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    fireEvent.click(await getEnabledActionButton(/Add Base Plan/i));
    await waitFor(() => {
      expect(screen.getByText("Editor Modal")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Editor" }));

    await waitFor(() => {
      expect(screen.getByText("Saved Starter Plan.")).toBeTruthy();
    });
    expect(screen.queryByText("Editor Modal")).toBeNull();
  });

  it("deletes a selected product and persists updated catalog", async () => {
    await renderManageProducts();

    fireEvent.click(await getEnabledActionButton(/Edit Plan/i));
    await waitFor(() => {
      expect(screen.getByText("Picker Modal")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete First" }));

    await waitFor(() => {
      expect(setProductsMock).toHaveBeenCalledTimes(1);
    });

    const payload = setProductsMock.mock.calls[0]?.[0] as {
      basePlans?: unknown[];
      riders?: unknown[];
    };
    const snapshotTitle = setProductsMock.mock.calls[0]?.[1];
    expect(payload.basePlans).toHaveLength(0);
    expect(payload.riders).toHaveLength(1);
    expect(snapshotTitle).toBe("after deleting Starter Plan (ID#bp1)");

    await waitFor(() => {
      expect(screen.getByText("Deleted Starter Plan.")).toBeTruthy();
    });
  });

  it("shows error dialog when delete request fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setProductsMock.mockRejectedValueOnce(new Error("Delete failed"));

    await renderManageProducts();

    fireEvent.click(await getEnabledActionButton(/Edit Plan/i));
    await waitFor(() => {
      expect(screen.getByText("Picker Modal")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete First" }));

    await waitFor(() => {
      expect(setProductsMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("Unable to delete product.")).toBeTruthy();
    });
  });
});
