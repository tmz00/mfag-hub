import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamAgency, TeamUser } from "../../../services/teamService";
import ManageUsers from "./_ManageUsers";

const { createUserMock, updateUserMock, deleteUserMock } = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  updateUserMock: vi.fn(),
  deleteUserMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineArrowLeft: Icon,
    TbOutlineLoader2: Icon,
    TbOutlinePlus: Icon,
    TbOutlinePencil: Icon,
    TbOutlineTrash: Icon,
    TbOutlineBuilding: Icon,
    TbOutlineChevronDown: Icon,
  };
});

vi.mock("solid-icons/vs", () => ({
  VsSave: () => null,
}));

vi.mock("@solidjs/router", () => ({
  useBeforeLeave: () => {},
  A: () => null,
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    createUser: (...args: unknown[]) => createUserMock(...args),
    updateUser: (...args: unknown[]) => updateUserMock(...args),
    deleteUser: (...args: unknown[]) => deleteUserMock(...args),
  },
  isStaffUser: (fscCode?: string | null) => String(fscCode || "").startsWith("00"),
}));

type RenderOptions = {
  showForm?: boolean;
  editUser?: TeamUser | null;
  users?: TeamUser[];
  agencies?: TeamAgency[];
  onRefresh?: ReturnType<typeof vi.fn>;
};

const defaultAgencies: TeamAgency[] = [
  { code: "A01", name: "Agency One" },
  { code: "B02", name: "Agency Two" },
];

const renderManageUsers = (options: RenderOptions = {}) => {
  const onRefresh = options.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  const [showForm, setShowForm] = createSignal(options.showForm ?? true);
  const [editUser, setEditUser] = createSignal<TeamUser | null>(
    options.editUser ?? null,
  );
  const [addUserRequested, setAddUserRequested] = createSignal(false);

  const view = render(() => (
    <ManageUsers
      users={options.users ?? []}
      usersLoading={false}
      usersError={null}
      agencies={options.agencies ?? defaultAgencies}
      showForm={showForm}
      setShowForm={setShowForm}
      showList={false}
      addUserRequested={addUserRequested}
      setAddUserRequested={setAddUserRequested}
      editUser={editUser}
      setEditUser={setEditUser}
      onRefresh={onRefresh}
    />
  ));

  return { ...view, onRefresh };
};

describe("ManageUsers", () => {
  beforeEach(() => {
    createUserMock.mockResolvedValue(undefined);
    updateUserMock.mockResolvedValue(undefined);
    deleteUserMock.mockResolvedValue(undefined);
  });

  it("creates a user from the add form with normalized payload", async () => {
    const { container, onRefresh } = renderManageUsers();

    const emailInput = container.querySelector("input[type='email']") as HTMLInputElement;
    const fscInput = container.querySelector(
      "input[inputmode='numeric']",
    ) as HTMLInputElement;
    const selects = container.querySelectorAll("select");
    const agencySelect = selects[0] as HTMLSelectElement;
    const accessSelect = selects[1] as HTMLSelectElement;

    emailInput.value = "NEW.USER@Example.COM";
    fireEvent.input(emailInput);
    fscInput.value = "12a34b56";
    fireEvent.input(fscInput);
    agencySelect.value = "A01";
    fireEvent.change(agencySelect);
    accessSelect.value = "editor";
    fireEvent.change(accessSelect);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createUserMock).toHaveBeenCalledTimes(1);
    });

    expect(createUserMock).toHaveBeenCalledWith({
      email: "new.user@example.com",
      fscCode: "12345",
      agencyCode: "A01",
      accessLevel: "editor",
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps add form submission blocked for invalid FSC code", async () => {
    const { container } = renderManageUsers();

    const emailInput = container.querySelector("input[type='email']") as HTMLInputElement;
    const fscInput = container.querySelector(
      "input[inputmode='numeric']",
    ) as HTMLInputElement;
    const agencySelect = container.querySelector("select") as HTMLSelectElement;

    emailInput.value = "invalid-check@example.com";
    fireEvent.input(emailInput);
    fscInput.value = "1234";
    fireEvent.input(fscInput);
    fireEvent.blur(fscInput);
    agencySelect.value = "A01";
    fireEvent.change(agencySelect);

    await waitFor(() => {
      expect(
        screen.getByText("FSC code must be exactly 5 digits."),
      ).toBeTruthy();
    });

    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("updates edited user and converts date inputs to ISO format", async () => {
    const target: TeamUser = {
      id: "42",
      nickname: "OldNick",
      fullName: "Old Full Name",
      email: "old@example.com",
      accessLevel: "standard",
      fscCode: "12345",
      agencyCode: "A01",
    };

    const { container, onRefresh } = renderManageUsers({
      showForm: false,
      editUser: target,
    });

    await screen.findByText("Edit User");

    const nicknameInput = container.querySelector(
      "input[maxlength='15']",
    ) as HTMLInputElement;
    const dateInputs = screen.getAllByPlaceholderText(
      "DD/MM/YYYY",
    ) as HTMLInputElement[];

    nicknameInput.value = "FreshNick";
    fireEvent.input(nicknameInput);
    dateInputs[0].value = "01022000";
    fireEvent.input(dateInputs[0]);
    dateInputs[1].value = "15032024";
    fireEvent.input(dateInputs[1]);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledTimes(1);
    });

    expect(updateUserMock).toHaveBeenCalledWith({
      uid: "42",
      email: "old@example.com",
      nickname: "FreshNick",
      fullName: "Old Full Name",
      fscCode: "12345",
      agencyCode: "A01",
      accessLevel: "",
      birthDate: "2000-02-01",
      contractDate: "2024-03-15",
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
