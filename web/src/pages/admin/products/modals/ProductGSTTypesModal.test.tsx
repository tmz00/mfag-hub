import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = { children?: JSX.Element };
type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: JSX.Element;
};
type EditModalProps = {
  title: string;
  onClose?: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: () => boolean;
  children?: JSX.Element;
};

const { setProductsMock } = vi.hoisted(() => ({
  setProductsMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlinePlus: Icon,
    TbOutlineTrash: Icon,
    TbOutlineArrowUp: Icon,
    TbOutlineArrowDown: Icon,
  };
});

vi.mock("../../../../components/ui", () => ({
  Button: (props: ButtonProps) => {
    const { children, ...buttonProps } = props;
    return <button {...buttonProps}>{children}</button>;
  },
  IconButton: (props: ButtonProps) => {
    const { children, ...buttonProps } = props;
    return <button {...buttonProps}>{children}</button>;
  },
  EditModal: (props: EditModalProps) => (
    <div>
      <h1>{props.title}</h1>
      {props.children}
      <button
        type="button"
        onClick={props.onSave}
        disabled={props.saveDisabled}
      >
        {props.saving?.() ? "Saving..." : "Save"}
      </button>
      <button type="button" onClick={props.onClose}>
        Close
      </button>
    </div>
  ),
  createConfirm: () => [() => null, vi.fn().mockResolvedValue(true)],
}));

vi.mock("../../../../services/productsService", () => ({
  productsService: {
    setProducts: (...args: unknown[]) => setProductsMock(...args),
  },
}));

const renderModal = async () => {
  const { default: ProductGSTTypesModal } = await import("./ProductGSTTypesModal");
  return render(() => (
    <ProductGSTTypesModal
      catalog={{
        gst: 9,
        types: {
          protection: "Protection",
          savings: "Savings",
          rider: "Rider",
        },
      }}
      onClose={() => undefined}
      onSaved={() => undefined}
      onError={() => undefined}
    />
  ));
};

describe("ProductGSTTypesModal", () => {
  beforeEach(() => {
    setProductsMock.mockReset();
    setProductsMock.mockResolvedValue(undefined);
  });

  it("reorders type definitions with up/down buttons before saving", async () => {
    await renderModal();

    const moveDownButtons = screen.getAllByRole("button", {
      name: "Move type down",
    });
    fireEvent.click(moveDownButtons[0]!);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setProductsMock).toHaveBeenCalledTimes(1);
    });

    const payload = setProductsMock.mock.calls[0]?.[0] as {
      types: Record<string, string>;
    };
    const snapshotTitle = setProductsMock.mock.calls[0]?.[1];

    expect(Object.keys(payload.types)).toEqual([
      "savings",
      "protection",
      "rider",
    ]);
    expect(snapshotTitle).toBe("Edit GST / Type Definitions");
  });
});
