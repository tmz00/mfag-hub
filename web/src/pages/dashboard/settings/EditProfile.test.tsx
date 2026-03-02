import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Show, type JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WrapperProps = {
  children?: JSX.Element;
  title?: string;
  onSave?: () => void;
  saveDisabled?: boolean;
  hasUnsavedChanges?: () => boolean;
};

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
  navigateMock,
  getCurrentUserMock,
  signOutMock,
  getAgenciesMock,
  getUserProfileMock,
  updateUserMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  signOutMock: vi.fn(),
  getAgenciesMock: vi.fn(),
  getUserProfileMock: vi.fn(),
  updateUserMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../components/ui", () => ({
  EditModal: (props: WrapperProps) => (
    <div>
      <h1>{props.title}</h1>
      <div data-testid="dirty-state">
        {props.hasUnsavedChanges?.() ? "dirty" : "clean"}
      </div>
      <button
        type="button"
        disabled={props.saveDisabled}
        onClick={props.onSave}
      >
        Save
      </button>
      <div>{props.children}</div>
    </div>
  ),
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

vi.mock("../../../services/authService", () => ({
  authService: {
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
    signOut: (...args: unknown[]) => signOutMock(...args),
  },
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getAgencies: (...args: unknown[]) => getAgenciesMock(...args),
    getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
    updateUser: (...args: unknown[]) => updateUserMock(...args),
  },
}));

const renderEditProfile = async () => {
  const { default: EditProfile } = await import("./EditProfile");
  return render(() => <EditProfile />);
};

describe("EditProfile", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getCurrentUserMock.mockReset();
    signOutMock.mockReset();
    getAgenciesMock.mockReset();
    getUserProfileMock.mockReset();
    updateUserMock.mockReset();

    getCurrentUserMock.mockReturnValue({
      uid: "user-1",
      email: "user@example.com",
    });
    signOutMock.mockResolvedValue(undefined);
    getAgenciesMock.mockResolvedValue([
      { code: "AG01", name: "Agency One" },
    ]);
    getUserProfileMock.mockResolvedValue({
      nickname: "Nick",
      fullName: "User Name",
      agencyCode: "AG01",
      fscCode: "FSC1",
      accessLevel: "standard",
      birthDay: 1,
      birthMonth: 2,
      birthYear: 1990,
      contractDay: 3,
      contractMonth: 4,
      contractYear: 2020,
    });
    updateUserMock.mockResolvedValue(undefined);
  });

  it("marks the form clean again after a successful save", async () => {
    await renderEditProfile();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Nick")).toBeTruthy();
      expect(screen.getByTestId("dirty-state").textContent).toBe("clean");
    });

    fireEvent.input(screen.getByPlaceholderText("Your nickname"), {
      currentTarget: { value: "Updated Nick" },
      target: { value: "Updated Nick" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("dirty-state").textContent).toBe("dirty");
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          nickname: "Updated Nick",
          email: "user@example.com",
          agencyCode: "AG01",
        }),
      );
      expect(
        screen.getByText("Your profile was saved successfully."),
      ).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByTestId("dirty-state").textContent).toBe("clean");
    });
  });
});
