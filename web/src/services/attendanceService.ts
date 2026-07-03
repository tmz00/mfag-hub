import { authJson } from "./authService";

export type AttendanceMeeting = {
  id: string;
  title: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  checkInToken?: string;
  expectedCount?: number | null;
  presentCount?: number | null;
};

export type AttendanceUserRecord = {
  userId: string;
  nickname?: string;
  fullName?: string;
  email?: string;
  fscCode?: string;
  agencyCode?: string;
  status: "present" | "late" | "absent" | "excused";
  checkedInAt?: string;
  note?: string;
  markedBy?: string;
};

export type AttendanceHistoryRecord = {
  id: string;
  meetingId: string;
  userId: string;
  status: "present" | "late" | "absent" | "excused";
  checkedInAt?: string;
  note?: string;
  meeting: AttendanceMeeting;
};

export type CreateAttendanceMeetingPayload = {
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  attendeeMode?: "all" | "selected";
  attendeeUserIds?: string[];
};

export type MarkAttendancePayload = {
  userId: string;
  status: "present" | "late" | "absent" | "excused";
  note?: string;
};

const requestJson = <T>(path: string, init: RequestInit = {}) =>
  authJson<T>(path, init, { defaultErrorMessage: "Attendance request failed" });

export const attendanceService = {
  async getAdminMeetings(): Promise<AttendanceMeeting[]> {
    const payload = await requestJson<{ meetings?: AttendanceMeeting[] }>(
      "/api/attendance/admin/meetings",
    );
    return Array.isArray(payload.meetings) ? payload.meetings : [];
  },

  async getAdminMeeting(id: string): Promise<{
    meeting: AttendanceMeeting;
    attendance: AttendanceUserRecord[];
  }> {
    const payload = await requestJson<{
      meeting?: AttendanceMeeting;
      attendance?: AttendanceUserRecord[];
    }>(`/api/attendance/admin/meetings/${encodeURIComponent(id)}`);
    return {
      meeting: payload.meeting || { id, title: "" },
      attendance: Array.isArray(payload.attendance) ? payload.attendance : [],
    };
  },

  async createMeeting(
    payload: CreateAttendanceMeetingPayload,
  ): Promise<AttendanceMeeting> {
    const response = await requestJson<{ meeting: AttendanceMeeting }>(
      "/api/attendance/admin/meetings",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    return response.meeting;
  },

  async checkIn(token: string): Promise<{
    meeting: AttendanceMeeting;
    duplicate: boolean;
  }> {
    return requestJson("/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  async getMyHistory(): Promise<AttendanceHistoryRecord[]> {
    const payload = await requestJson<{ records?: AttendanceHistoryRecord[] }>(
      "/api/attendance/history",
    );
    return Array.isArray(payload.records) ? payload.records : [];
  },

  async markAttendance(
    meetingId: string,
    payload: MarkAttendancePayload,
  ): Promise<void> {
    await requestJson(
      `/api/attendance/admin/meetings/${encodeURIComponent(meetingId)}/mark`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  },
};
