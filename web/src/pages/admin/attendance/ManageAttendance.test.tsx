import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdminMeetingsMock,
  getAdminMeetingMock,
  markAttendanceMock,
  navigateMock,
  toDataUrlMock,
} = vi.hoisted(() => ({
  getAdminMeetingsMock: vi.fn(),
  getAdminMeetingMock: vi.fn(),
  markAttendanceMock: vi.fn(),
  navigateMock: vi.fn(),
  toDataUrlMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineArrowLeft: Icon,
    TbOutlineCalendarCheck: Icon,
    TbOutlineChevronDown: Icon,
    TbOutlineLoader2: Icon,
    TbOutlinePlus: Icon,
    TbOutlineRefresh: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("qrcode", () => ({
  toDataURL: (...args: unknown[]) => toDataUrlMock(...args),
}));

vi.mock("../../../services/attendanceService", () => ({
  attendanceService: {
    getAdminMeetings: (...args: unknown[]) => getAdminMeetingsMock(...args),
    getAdminMeeting: (...args: unknown[]) => getAdminMeetingMock(...args),
    markAttendance: (...args: unknown[]) => markAttendanceMock(...args),
  },
}));

import ManageAttendance from "./ManageAttendance";

describe("ManageAttendance", () => {
  beforeEach(() => {
    getAdminMeetingsMock.mockReset();
    getAdminMeetingMock.mockReset();
    markAttendanceMock.mockReset();
    navigateMock.mockReset();
    toDataUrlMock.mockReset();
    window.history.replaceState(null, "", "/admin/attendance/meetings");
    getAdminMeetingsMock.mockResolvedValue([
      {
        id: "meeting-1",
        title: "Weekly Meeting",
        startsAt: "2026-07-03T02:00:00.000Z",
        checkInToken: "token-1",
      },
    ]);
    getAdminMeetingMock.mockResolvedValue({
      meeting: {
        id: "meeting-1",
        title: "Weekly Meeting",
        startsAt: "2026-07-03T02:00:00.000Z",
        location: "HQ",
        checkInToken: "token-1",
      },
      attendance: [
        {
          userId: "user-1",
          fscCode: "10001",
          nickname: "Alice",
          status: "absent",
        },
      ],
    });
    toDataUrlMock.mockResolvedValue("data:image/png;base64,qr");
    markAttendanceMock.mockResolvedValue(undefined);
  });

  it("loads a past meeting, renders its QR, and only marks attendance after confirmation", async () => {
    render(() => <ManageAttendance />);

    expect(await screen.findByText("Weekly Meeting")).toBeTruthy();
    await waitFor(() => expect(getAdminMeetingMock).toHaveBeenCalledWith("meeting-1"));
    await waitFor(() =>
      expect(toDataUrlMock).toHaveBeenCalledWith(
        "http://localhost:3000/attendance?token=token-1",
        expect.objectContaining({ width: 360 }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Absent/i }));
    fireEvent.click(screen.getByRole("button", { name: "Excused" }));
    expect(markAttendanceMock).not.toHaveBeenCalled();

    expect(await screen.findByText("Update Attendance?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() =>
      expect(markAttendanceMock).toHaveBeenCalledWith("meeting-1", {
        userId: "user-1",
        status: "excused",
        note: "Manual admin mark",
      }),
    );
    expect(getAdminMeetingMock).toHaveBeenCalledTimes(2);
  });
});
