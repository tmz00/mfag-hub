import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkInMock, getMyHistoryMock, navigateMock } = vi.hoisted(() => ({
  checkInMock: vi.fn(),
  getMyHistoryMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("solid-icons/tb", () => {
  const Icon = () => null;
  return {
    TbOutlineArrowLeft: Icon,
    TbOutlineCalendarCheck: Icon,
    TbOutlineCamera: Icon,
    TbOutlineLoader2: Icon,
    TbOutlineRefresh: Icon,
  };
});

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../services/attendanceService", () => ({
  attendanceService: {
    checkIn: (...args: unknown[]) => checkInMock(...args),
    getMyHistory: (...args: unknown[]) => getMyHistoryMock(...args),
  },
}));

import Attendance from "./Attendance";

class BarcodeDetectorMock {
  detect = vi.fn().mockResolvedValue([
    {
      rawValue: "https://mfag.test/attendance?token=scanned-token",
    },
  ]);
}

describe("Attendance", () => {
  beforeEach(() => {
    vi.useRealTimers();
    checkInMock.mockReset();
    getMyHistoryMock.mockReset();
    navigateMock.mockReset();
    getMyHistoryMock.mockResolvedValue([]);
    checkInMock.mockResolvedValue({
      duplicate: false,
      meeting: { id: "meeting-1", title: "Weekly Meeting" },
    });
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      writable: true,
      value: BarcodeDetectorMock,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    Object.defineProperties(HTMLMediaElement.prototype, {
      readyState: {
        configurable: true,
        get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
      },
      videoWidth: {
        configurable: true,
        get: () => 640,
      },
      videoHeight: {
        configurable: true,
        get: () => 480,
      },
    });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName.toLowerCase() === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });
  });

  it("scans a QR code, extracts the token, checks in, and refreshes history", async () => {
    vi.useFakeTimers();
    render(() => <Attendance />);

    fireEvent.click(await screen.findByRole("button", { name: "Scan QR" }));
    await vi.advanceTimersByTimeAsync(600);

    await waitFor(() => expect(checkInMock).toHaveBeenCalledWith("scanned-token"));
    expect(await screen.findByText("Attendance recorded for Weekly Meeting.")).toBeTruthy();
    expect(getMyHistoryMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("shows existing attendance history", async () => {
    getMyHistoryMock.mockResolvedValue([
      {
        id: "record-1",
        meetingId: "meeting-1",
        userId: "user-1",
        status: "present",
        checkedInAt: "2026-07-03T02:05:00.000Z",
        meeting: {
          id: "meeting-1",
          title: "Weekly Meeting",
          startsAt: "2026-07-03T02:00:00.000Z",
        },
      },
    ]);

    render(() => <Attendance />);

    expect(await screen.findByText("Weekly Meeting")).toBeTruthy();
    expect(screen.getByText("present")).toBeTruthy();
    expect(screen.getByText(/Checked in:/)).toBeTruthy();
  });
});
