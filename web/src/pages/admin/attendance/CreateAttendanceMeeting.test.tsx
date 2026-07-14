import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMeetingMock, getTeamDataMock, navigateMock } = vi.hoisted(() => ({
  createMeetingMock: vi.fn(),
  getTeamDataMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineArrowLeft: Icon,
    TbOutlineCalendarCheck: Icon,
    TbOutlineLoader2: Icon,
    TbOutlineQrcode: Icon,
    TbOutlineRefresh: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../services/attendanceService", () => ({
  attendanceService: {
    createMeeting: (...args: unknown[]) => createMeetingMock(...args),
  },
}));

vi.mock("../../../services/teamService", () => ({
  teamService: {
    getTeamData: (...args: unknown[]) => getTeamDataMock(...args),
  },
}));

vi.mock("../../../components/ui", async () => {
  const actual = await vi.importActual<typeof import("../../../components/ui")>(
    "../../../components/ui",
  );
  return actual;
});

import CreateAttendanceMeeting from "./CreateAttendanceMeeting";

const inputForLabel = (label: string) =>
  screen.getByText(label).parentElement?.querySelector("input, textarea") as
    | HTMLInputElement
    | HTMLTextAreaElement;

describe("CreateAttendanceMeeting", () => {
  beforeEach(() => {
    createMeetingMock.mockReset();
    getTeamDataMock.mockReset();
    navigateMock.mockReset();
    getTeamDataMock.mockResolvedValue({
      users: [
        {
          id: "user-1",
          fscCode: "10001",
          nickname: "Alice",
          fullName: "Alice Tan",
          email: "alice@example.test",
        },
        {
          id: "user-2",
          fscCode: "10002",
          nickname: "Ben",
          fullName: "Ben Lim",
          email: "ben@example.test",
        },
        {
          id: "staff-no-fsc",
          nickname: "No FSC",
          fscCode: "",
        },
        {
          id: "staff-00",
          nickname: "Staff",
          fscCode: "00123",
        },
      ],
      agencies: [],
    });
  });

  it("requires at least one attendee before creating a meeting", async () => {
    render(() => <CreateAttendanceMeeting />);

    fireEvent.input(inputForLabel("Title"), {
      target: { value: "Monday Meeting" },
    });
    fireEvent.input(inputForLabel("Date"), {
      target: { value: "2026-07-03" },
    });
    fireEvent.input(inputForLabel("Time"), {
      target: { value: "09:30" },
    });
    await screen.findByText("10001 · Alice");
    expect(screen.queryByText("00123 · Staff")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    fireEvent.click(screen.getByRole("button", { name: /Create QR Meeting/i }));

    expect(await screen.findByText("Select at least one expected attendee.")).toBeTruthy();
    expect(createMeetingMock).not.toHaveBeenCalled();
  });

  it("creates a meeting with default all attendees and redirects to its QR view", async () => {
    createMeetingMock.mockResolvedValue({ id: "meeting/123" });
    render(() => <CreateAttendanceMeeting />);

    fireEvent.input(inputForLabel("Title"), {
      target: { value: "  Product Training  " },
    });
    fireEvent.input(inputForLabel("Notes"), {
      target: { value: "Bring laptops" },
    });
    fireEvent.input(inputForLabel("Date"), {
      target: { value: "2026-07-03" },
    });
    fireEvent.input(inputForLabel("Time"), {
      target: { value: "09:30" },
    });
    expect(inputForLabel("QR Expiry").value).toBe("15");
    fireEvent.input(inputForLabel("QR Expiry"), {
      target: { value: "30" },
    });

    await screen.findByText("10001 · Alice");
    expect(screen.queryByText("00123 · Staff")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Create QR Meeting/i }));

    await waitFor(() => expect(createMeetingMock).toHaveBeenCalledTimes(1));
    const payload = createMeetingMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: "Product Training",
      description: "Bring laptops",
      attendeeMode: "selected",
      attendeeUserIds: ["user-1", "user-2"],
    });
    expect(payload.startsAt).toContain("2026-07-03T");
    expect(new Date(payload.endsAt).getTime() - new Date(payload.startsAt).getTime()).toBe(30 * 60 * 1000);
    expect(navigateMock).toHaveBeenCalledWith(
      "/admin/attendance/meetings?meeting=meeting%2F123",
    );
  });

  it("auto-fills a blank title when date and time are selected", async () => {
    createMeetingMock.mockResolvedValue({ id: "meeting-auto-title" });
    render(() => <CreateAttendanceMeeting />);

    expect(inputForLabel("Date").value).toBe("");
    expect(inputForLabel("Time").value).toBe("");
    fireEvent.input(inputForLabel("Date"), {
      target: { value: "2026-07-03" },
    });
    fireEvent.input(inputForLabel("Time"), {
      target: { value: "09:30" },
    });
    fireEvent.input(inputForLabel("Notes"), {
      target: { value: "Auto title test" },
    });

    expect(inputForLabel("Title").value).toBe("Meeting on 03 Jul 2026, at 09:30 AM");

    await screen.findByText("10001 · Alice");
    fireEvent.click(screen.getByRole("button", { name: /Create QR Meeting/i }));

    await waitFor(() => expect(createMeetingMock).toHaveBeenCalledTimes(1));
    expect(createMeetingMock.mock.calls[0][0]).toMatchObject({
      title: "Meeting on 03 Jul 2026, at 09:30 AM",
      description: "Auto title test",
    });
  });

  it("requires a positive QR expiry duration", async () => {
    render(() => <CreateAttendanceMeeting />);

    fireEvent.input(inputForLabel("Title"), {
      target: { value: "Monday Meeting" },
    });
    fireEvent.input(inputForLabel("Date"), {
      target: { value: "2026-07-03" },
    });
    fireEvent.input(inputForLabel("Time"), {
      target: { value: "09:30" },
    });
    fireEvent.input(inputForLabel("QR Expiry"), {
      target: { value: "0" },
    });
    await screen.findByText("10001 · Alice");
    fireEvent.click(screen.getByRole("button", { name: /Create QR Meeting/i }));

    expect(await screen.findByText("QR expiry must be at least 1 minute after the meeting starts.")).toBeTruthy();
    expect(createMeetingMock).not.toHaveBeenCalled();
  });

  it("selects and clears every active user in the selected attendee list", async () => {
    createMeetingMock.mockResolvedValue({ id: "meeting-456" });
    render(() => <CreateAttendanceMeeting />);

    fireEvent.input(inputForLabel("Title"), {
      target: { value: "All Hands" },
    });
    fireEvent.input(inputForLabel("Date"), {
      target: { value: "2026-07-03" },
    });
    fireEvent.input(inputForLabel("Time"), {
      target: { value: "09:30" },
    });
    await screen.findByText("10001 · Alice");

    expect(screen.getByText("2/2 users selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(screen.getByText("0/2 users selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    fireEvent.click(screen.getByRole("button", { name: /Create QR Meeting/i }));

    await waitFor(() => expect(createMeetingMock).toHaveBeenCalledTimes(1));
    expect(createMeetingMock.mock.calls[0][0]).toMatchObject({
      attendeeMode: "selected",
      attendeeUserIds: ["user-1", "user-2"],
    });
  });
});
