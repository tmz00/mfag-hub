import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
}));

import { attendanceService } from "./attendanceService";

describe("attendanceService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
  });

  it("loads admin meetings from the attendance admin endpoint", async () => {
    authJsonMock.mockResolvedValue({
      meetings: [
        {
          id: "1",
          title: "Weekly Meeting",
          startsAt: "2026-06-09T02:00:00Z",
          presentCount: 3,
        },
      ],
    });

    const meetings = await attendanceService.getAdminMeetings();

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/attendance/admin/meetings",
      {},
      { defaultErrorMessage: "Attendance request failed" },
    );
    expect(meetings).toEqual([
      {
        id: "1",
        title: "Weekly Meeting",
        startsAt: "2026-06-09T02:00:00Z",
        presentCount: 3,
      },
    ]);
  });

  it("creates a meeting with selected attendee ids", async () => {
    authJsonMock.mockResolvedValue({
      meeting: {
        id: "9",
        title: "Training",
      },
    });

    const payload = {
      title: "Training",
      startsAt: "2026-06-09T02:00:00.000Z",
      endsAt: "2026-06-09T03:00:00.000Z",
      attendeeMode: "selected" as const,
      attendeeUserIds: ["u1", "u2"],
    };
    const meeting = await attendanceService.createMeeting(payload);

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/attendance/admin/meetings",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      { defaultErrorMessage: "Attendance request failed" },
    );
    expect(meeting.id).toBe("9");
  });

  it("checks in with a token and returns duplicate state", async () => {
    authJsonMock.mockResolvedValue({
      meeting: { id: "7", title: "Meeting" },
      duplicate: true,
    });

    const result = await attendanceService.checkIn("qr-token");

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/attendance/check-in",
      {
        method: "POST",
        body: JSON.stringify({ token: "qr-token" }),
      },
      { defaultErrorMessage: "Attendance request failed" },
    );
    expect(result.duplicate).toBe(true);
  });

  it("loads personal attendance history and normalizes missing arrays", async () => {
    authJsonMock.mockResolvedValueOnce({
      records: [
        {
          id: "1",
          meetingId: "2",
          userId: "3",
          status: "present",
          meeting: { id: "2", title: "Meeting" },
        },
      ],
    });

    await expect(attendanceService.getMyHistory()).resolves.toHaveLength(1);
    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/attendance/history",
      {},
      { defaultErrorMessage: "Attendance request failed" },
    );

    authJsonMock.mockResolvedValueOnce({});
    await expect(attendanceService.getMyHistory()).resolves.toEqual([]);
  });

  it("marks attendance through the admin meeting endpoint", async () => {
    authJsonMock.mockResolvedValue({ record: { id: "5" } });

    await attendanceService.markAttendance("meeting/1", {
      userId: "user/2",
      status: "excused",
      note: "Approved",
    });

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/attendance/admin/meetings/meeting%2F1/mark",
      {
        method: "PUT",
        body: JSON.stringify({
          userId: "user/2",
          status: "excused",
          note: "Approved",
        }),
      },
      { defaultErrorMessage: "Attendance request failed" },
    );
  });
});
