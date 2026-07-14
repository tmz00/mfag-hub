import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManageSources from "./ManageSources";

const { getSourcesMock, saveSourcesMock } = vi.hoisted(() => ({
  getSourcesMock: vi.fn(),
  saveSourcesMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineArrowLeft: Icon,
    TbOutlineChartBar: Icon,
    TbOutlineBell: Icon,
    TbOutlinePackage: Icon,
    TbOutlineUsers: Icon,
    TbOutlineCalendarCheck: Icon,
    TbOutlineBook: Icon,
    TbOutlineFileText: Icon,
    TbOutlineHistory: Icon,
    TbOutlineList: Icon,
    TbOutlinePlus: Icon,
    TbOutlinePencil: Icon,
    TbOutlineBuilding: Icon,
    TbOutlineArrowsUpDown: Icon,
    TbOutlineArrowUp: Icon,
    TbOutlineArrowDown: Icon,
    TbOutlineTrash: Icon,
    TbOutlineRefresh: Icon,
    TbOutlineLoader2: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/admin/sources" }),
  useBeforeLeave: () => {},
  useNavigate: () => () => undefined,
  Navigate: () => null,
  A: () => null,
}));

vi.mock("../../../services/sourcesService", () => ({
  sourcesService: {
    getSources: (...args: unknown[]) => getSourcesMock(...args),
    saveSources: (...args: unknown[]) => saveSourcesMock(...args),
    getBackups: vi.fn(),
    restoreBackup: vi.fn(),
    deleteBackup: vi.fn(),
  },
}));

describe("ManageSources", () => {
  beforeEach(() => {
    getSourcesMock.mockReset();
    saveSourcesMock.mockReset();
    getSourcesMock.mockResolvedValue([
      { id: "warm", label: "Warm", description: "", children: [] },
    ]);
    saveSourcesMock.mockResolvedValue(undefined);
  });

  it("saves a newly added source", async () => {
    render(() => <ManageSources />);

    fireEvent.click(screen.getByRole("button", { name: /add source/i }));
    expect(screen.queryByText("Source ID")).toBeNull();

    const labelInput = (await screen.findByPlaceholderText(
      "e.g. Roadshow",
    )) as HTMLInputElement;
    labelInput.value = "Roadshow";
    fireEvent.input(labelInput);

    fireEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!);

    await waitFor(() => {
      expect(saveSourcesMock).toHaveBeenCalled();
    });

    const payload = saveSourcesMock.mock.calls[0]?.[0] as Array<{
      id: string;
      label: string;
      children: Array<{ id: string; label: string }>;
    }>;
    expect(payload).toHaveLength(2);
    expect(payload[1]).toMatchObject({
      id: "roadshow",
      label: "Roadshow",
      children: [],
    });

    await waitFor(() => {
      expect(screen.getByText("Source created successfully")).toBeTruthy();
    });
  });

  it("shows backend message when delete is rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    saveSourcesMock.mockRejectedValueOnce(
      new Error("Cannot remove sources used by existing closings: warm."),
    );

    render(() => <ManageSources />);

    fireEvent.click(screen.getByRole("button", { name: /edit source/i }));
    await screen.findByText("Warm");

    fireEvent.click(screen.getByLabelText("Delete"));
    await screen.findByText("Delete Source?");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);

    await waitFor(() => {
      expect(saveSourcesMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        screen.getByText("Cannot remove sources used by existing closings: warm."),
      ).toBeTruthy();
    });
  });

  it("disables save when editing a source with no changes", async () => {
    render(() => <ManageSources />);

    fireEvent.click(screen.getByRole("button", { name: /edit source/i }));
    await screen.findByText("Choose a source to edit");

    fireEvent.click(screen.getByLabelText("Edit"));
    await screen.findByDisplayValue("Warm");

    expect(
      (screen.getAllByRole("button", { name: "Save" }).at(-1) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("reorders source items before save", async () => {
    render(() => <ManageSources />);

    fireEvent.click(screen.getByRole("button", { name: /add source/i }));

    const labelInput = (await screen.findByPlaceholderText(
      "e.g. Roadshow",
    )) as HTMLInputElement;
    labelInput.value = "Roadshow";
    fireEvent.input(labelInput);

    fireEvent.click(screen.getByRole("button", { name: /\+ add item/i }));
    fireEvent.click(screen.getByRole("button", { name: /\+ add item/i }));

    const itemInputs = await screen.findAllByPlaceholderText("e.g. Absolute Fest");
    const firstItem = itemInputs[0] as HTMLInputElement;
    const secondItem = itemInputs[1] as HTMLInputElement;
    firstItem.value = "First";
    fireEvent.input(firstItem);
    secondItem.value = "Second";
    fireEvent.input(secondItem);

    const moveUpButtons = screen.getAllByRole("button", { name: "Move item up" });
    fireEvent.click(moveUpButtons[1]!);

    fireEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!);

    await waitFor(() => {
      expect(saveSourcesMock).toHaveBeenCalled();
    });

    const payload = saveSourcesMock.mock.calls[0]?.[0] as Array<{
      id: string;
      label: string;
      children: Array<{ id: string; label: string }>;
    }>;
    expect(payload[1]?.children.map((child) => child.label)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("includes newly added items when editing an existing source", async () => {
    getSourcesMock.mockResolvedValueOnce([
      {
        id: "roadshow",
        label: "Roadshow",
        description: "",
        children: [{ id: "17", label: "Expo" }],
      },
    ]);

    render(() => <ManageSources />);

    fireEvent.click(screen.getByRole("button", { name: /edit source/i }));
    await screen.findByText("Choose a source to edit");

    fireEvent.click(screen.getByLabelText("Edit"));
    await screen.findByDisplayValue("Roadshow");

    fireEvent.click(screen.getByRole("button", { name: /\+ add item/i }));

    const itemInputs = await screen.findAllByPlaceholderText("e.g. Absolute Fest");
    const newItemInput = itemInputs[itemInputs.length - 1] as HTMLInputElement;
    newItemInput.value = "Summit";
    fireEvent.input(newItemInput);

    fireEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!);

    await waitFor(() => {
      expect(saveSourcesMock).toHaveBeenCalled();
    });

    const payload = saveSourcesMock.mock.calls[0]?.[0] as Array<{
      id: string;
      label: string;
      children: Array<{ id: string; label: string }>;
    }>;
    expect(payload).toEqual([
      {
        id: "roadshow",
        label: "Roadshow",
        description: "",
        children: [
          { id: "17", label: "Expo" },
          { id: "", label: "Summit" },
        ],
      },
    ]);
  });

  it("returns to the source picker when backing out of edit source, but not after save", async () => {
    getSourcesMock.mockResolvedValueOnce([
      { id: "warm", label: "Warm", description: "", children: [] },
      { id: "referral", label: "Referral", description: "", children: [] },
    ]);

    render(() => <ManageSources />);

    fireEvent.click(screen.getByRole("button", { name: /edit source/i }));
    await screen.findByText("Choose a source to edit");

    fireEvent.click(screen.getAllByLabelText("Edit")[0]!);
    await screen.findByDisplayValue("Warm");

    const backButtons = screen.getAllByRole("button", { name: "Back" });
    fireEvent.click(backButtons.at(-1)!);

    await waitFor(() => {
      expect(screen.getByText("Choose a source to edit")).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText("e.g. Roadshow")).toBeNull();

    fireEvent.click(screen.getAllByLabelText("Edit")[0]!);
    const labelInput = (await screen.findByDisplayValue("Warm")) as HTMLInputElement;
    labelInput.value = "Warm Updated";
    fireEvent.input(labelInput);

    fireEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!);

    await waitFor(() => {
      expect(saveSourcesMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.queryByText("Choose a source to edit")).toBeNull();
    });
  });
});
