import { render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminAccessGate, { hasAdminAccess } from "./AdminAccessGate";

type WrapperProps = { children?: JSX.Element };
type LoadingProps = { label?: string };

const { getCurrentUserAccessLevelMock } = vi.hoisted(() => ({
  getCurrentUserAccessLevelMock: vi.fn(),
}));

vi.mock("../../components/ui", () => ({
  LoadingState: (props: LoadingProps) => <div>{props.label || "Loading..."}</div>,
  PageShell: (props: WrapperProps) => <div>{props.children}</div>,
  PageBody: (props: WrapperProps) => <div>{props.children}</div>,
  PageHeader: (props: WrapperProps) => <div>{props.children}</div>,
}));

vi.mock("../../services/teamService", () => ({
  teamService: {
    getCurrentUserAccessLevel: (...args: unknown[]) =>
      getCurrentUserAccessLevelMock(...args),
  },
}));

describe("AdminAccessGate", () => {
  beforeEach(() => {
    getCurrentUserAccessLevelMock.mockReset();
  });

  it("recognizes admin-only and editor-capable access rules", () => {
    expect(hasAdminAccess("admin", false)).toBe(true);
    expect(hasAdminAccess("editor", false)).toBe(false);
    expect(hasAdminAccess("editor", false, true)).toBe(true);
    expect(hasAdminAccess("standard", false, true)).toBe(false);
  });

  it("shows a loading state while access is resolving", async () => {
    let resolveAccess:
      | ((value: { isAdmin: boolean; accessLevel: string }) => void)
      | undefined;
    getCurrentUserAccessLevelMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAccess = resolve;
      }),
    );

    render(() => (
      <AdminAccessGate>
        <div>Guarded Content</div>
      </AdminAccessGate>
    ));

    expect(screen.getByText("Loading admin tools...")).toBeTruthy();

    resolveAccess?.({ isAdmin: true, accessLevel: "admin" });
    await waitFor(() => {
      expect(screen.getByText("Guarded Content")).toBeTruthy();
    });
  });

  it("denies editors on admin-only routes", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      isAdmin: false,
      accessLevel: "editor",
    });

    render(() => (
      <AdminAccessGate deniedMessage="Only admins can access this page.">
        <div>Guarded Content</div>
      </AdminAccessGate>
    ));

    await waitFor(() => {
      expect(screen.getByText("Only admins can access this page.")).toBeTruthy();
    });
    expect(screen.queryByText("Guarded Content")).toBeNull();
  });

  it("allows editors on editor-capable routes", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      isAdmin: false,
      accessLevel: "editor",
    });

    render(() => (
      <AdminAccessGate allowEditor deniedMessage="Denied">
        <div>Guarded Content</div>
      </AdminAccessGate>
    ));

    await waitFor(() => {
      expect(screen.getByText("Guarded Content")).toBeTruthy();
    });
    expect(screen.queryByText("Denied")).toBeNull();
  });

  it("denies standard users on editor-capable routes", async () => {
    getCurrentUserAccessLevelMock.mockResolvedValue({
      isAdmin: false,
      accessLevel: "standard",
    });

    render(() => (
      <AdminAccessGate
        allowEditor
        deniedMessage="Only admins and editors can access this page."
      >
        <div>Guarded Content</div>
      </AdminAccessGate>
    ));

    await waitFor(() => {
      expect(
        screen.getByText("Only admins and editors can access this page."),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Guarded Content")).toBeNull();
  });
});
