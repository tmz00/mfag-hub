import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock, getCurrentUserMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
  getCaptchaAwareErrorMessage: (error: unknown, fallbackMessage: string) =>
    error instanceof Error && error.message.includes("https://mfag.sg")
      ? error.message
      : fallbackMessage,
  authService: {
    getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  },
}));

const loadTeamModule = async () => {
  vi.resetModules();
  return import("./teamService");
};

describe("teamService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
    getCurrentUserMock.mockReset();
    getCurrentUserMock.mockReturnValue({ accessLevel: "admin" });
  });

  it("recognizes staff FSC codes", async () => {
    const mod = await loadTeamModule();

    expect(mod.isStaffUser("00123")).toBe(true);
    expect(mod.isStaffUser("99123")).toBe(false);
    expect(mod.isStaffUser(undefined)).toBe(false);
  });

  it("returns lowercase access level and admin flag", async () => {
    const mod = await loadTeamModule();
    getCurrentUserMock.mockReturnValue({ accessLevel: "AdMiN" });

    await expect(mod.teamService.getCurrentUserAccessLevel()).resolves.toEqual({
      isAdmin: true,
      accessLevel: "admin",
    });
  });

  it("loads and normalizes team data payload", async () => {
    const mod = await loadTeamModule();
    authJsonMock.mockResolvedValue({
      users: [
        {
          id: 5,
          name: "Alias",
          email: "alias@example.test",
          accessLevel: "editor",
          fsc_code: "00123",
          agencyId: "AG1",
          birthDate: "2023-07-14",
          contract_date: "2022-01-09",
        },
        {
          id: "6",
          nickname: "Nick",
          fullName: "Nick Name",
          fsc: "12345",
          birth_month: "11",
          birth_day: "30",
          birth_year: "1999",
          contractDate: "20241225",
        },
      ],
      agencies: [
        { code: "A1", name: "Agency A", isDeleted: "1" },
        { agencyCode: "B2", agencyName: "Agency B", is_delete: "0" },
        { id: "C3", name: "Agency C", isActive: "maybe" },
      ],
    });

    const data = await mod.teamService.getTeamData();

    expect(data).toEqual({
      users: [
        {
          id: "5",
          nickname: "Alias",
          fullName: "Alias",
          email: "alias@example.test",
          accessLevel: "editor",
          fscCode: "00123",
          agencyCode: "AG1",
          birthMonth: 7,
          birthDay: 14,
          birthYear: 2023,
          contractMonth: 1,
          contractDay: 9,
          contractYear: 2022,
        },
        {
          id: "6",
          nickname: "Nick",
          fullName: "Nick Name",
          email: "",
          accessLevel: "",
          fscCode: "12345",
          agencyCode: "",
          birthMonth: 11,
          birthDay: 30,
          birthYear: 1999,
          contractMonth: 12,
          contractDay: 25,
          contractYear: 2024,
        },
      ],
      agencies: [
        { code: "A1", name: "Agency A", isActive: false, isDeleted: true },
        { code: "B2", name: "Agency B", isActive: true, isDeleted: false },
        { code: "C3", name: "Agency C", isActive: true, isDeleted: false },
      ],
    });
    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/team",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("hides email and access level for non-admin users", async () => {
    const mod = await loadTeamModule();
    getCurrentUserMock.mockReturnValue({ accessLevel: "manager" });
    authJsonMock.mockResolvedValue({
      users: [
        {
          id: "u1",
          nickname: "User One",
          email: "u1@example.test",
          accessLevel: "editor",
        },
      ],
      agencies: [],
    });

    const users = await mod.teamService.getUsers();

    expect(users).toHaveLength(1);
    expect(users[0].id).toBe("u1");
    expect(users[0]).not.toHaveProperty("email");
    expect(users[0]).not.toHaveProperty("accessLevel");
  });

  it("keeps email and access level for admin users", async () => {
    const mod = await loadTeamModule();
    getCurrentUserMock.mockReturnValue({ accessLevel: "admin" });
    authJsonMock.mockResolvedValue({
      users: [
        {
          id: "u1",
          nickname: "User One",
          email: "u1@example.test",
          accessLevel: "editor",
        },
      ],
      agencies: [],
    });

    const users = await mod.teamService.getUsers();

    expect(users[0]).toMatchObject({
      id: "u1",
      email: "u1@example.test",
      accessLevel: "editor",
    });
  });

  it("uses cached team data for user profiles", async () => {
    const mod = await loadTeamModule();
    authJsonMock.mockResolvedValue({
      users: [{ id: "u1", name: "Initial Name" }],
      agencies: [],
    });

    const first = await mod.teamService.getUserProfile("u1");
    const second = await mod.teamService.getUserProfile("u1");

    expect(first?.nickname).toBe("Initial Name");
    expect(second?.nickname).toBe("Initial Name");
    expect(authJsonMock).toHaveBeenCalledTimes(1);
  });

  it("clears cached team data after user update", async () => {
    const mod = await loadTeamModule();
    const payload = {
      uid: "a/b",
      email: "user@example.test",
      fscCode: "99123",
      agencyCode: "AG1",
      accessLevel: "editor",
    };

    authJsonMock
      .mockResolvedValueOnce({
        users: [{ id: "a/b", name: "Old Name" }],
        agencies: [],
      })
      .mockResolvedValueOnce({ uid: "a/b" })
      .mockResolvedValueOnce({
        users: [{ id: "a/b", name: "New Name" }],
        agencies: [],
      });

    const beforeUpdate = await mod.teamService.getUserProfile("a/b");
    await mod.teamService.updateUser(payload);
    const afterUpdate = await mod.teamService.getUserProfile("a/b");

    expect(beforeUpdate?.nickname).toBe("Old Name");
    expect(afterUpdate?.nickname).toBe("New Name");
    expect(authJsonMock).toHaveBeenNthCalledWith(
      2,
      "/api/team/users/a%2Fb",
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
      { defaultErrorMessage: "Request failed" },
    );
    expect(authJsonMock).toHaveBeenCalledTimes(3);
  });

  it("upserts agencies with normalized payload", async () => {
    const mod = await loadTeamModule();

    authJsonMock
      .mockResolvedValueOnce({
        users: [],
        agencies: [{ code: "A", name: "Agency A", isDeleted: true }],
      })
      .mockResolvedValueOnce({ updated: 2 });

    await mod.teamService.upsertAgency({ code: "  B  ", name: "  " });

    expect(authJsonMock).toHaveBeenNthCalledWith(
      2,
      "/api/agencies",
      {
        method: "PUT",
        body: JSON.stringify({
          agencies: [
            { code: "A", name: "Agency A", position: 0, isDeleted: true },
            { code: "B", name: "B", position: 1, isDeleted: false },
          ],
        }),
      },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("can request deleted agencies for legacy reporting screens", async () => {
    const mod = await loadTeamModule();
    authJsonMock.mockResolvedValue({
      users: [],
      agencies: [{ code: "A1", name: "Agency A", isDeleted: true }],
    });

    const data = await mod.teamService.getTeamData({ includeDeletedAgencies: true });

    expect(data.agencies).toEqual([
      { code: "A1", name: "Agency A", isActive: false, isDeleted: true },
    ]);
    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/team?includeDeletedAgencies=1",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("returns fallback backup behavior while migration is pending", async () => {
    const mod = await loadTeamModule();

    await expect(mod.teamService.getBackups()).resolves.toEqual([]);
    await expect(mod.teamService.restoreFromBackup({} as any)).rejects.toThrow(
      "Team backups are not migrated yet",
    );
    await expect(mod.teamService.deleteBackup("backup-1")).rejects.toThrow(
      "Team backups are not migrated yet",
    );
  });
});
