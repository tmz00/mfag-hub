import {
  Component,
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onMount,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  TbOutlineCalendarCheck,
  TbOutlineChevronDown,
  TbOutlinePlus,
  TbOutlineRefresh,
} from "solid-icons/tb";
import { toDataURL } from "qrcode";

import {
  Button,
  ConfirmModal,
  LoadingState,
  PageBody,
  PageHeader,
  PageShell,
} from "../../../components/ui";
import {
  attendanceService,
  type AttendanceMeeting,
  type AttendanceUserRecord,
} from "../../../services/attendanceService";

const formatDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const getCheckInValue = (token?: string) => {
  const clean = String(token || "").trim();
  if (!clean) return "";
  if (typeof window === "undefined") return clean;
  return `${window.location.origin}/attendance?token=${encodeURIComponent(clean)}`;
};

const statusClass = (status: string) => {
  switch (status) {
    case "present":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "late":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "excused":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    default:
      return "bg-gray-100 text-gray-600 ring-gray-200";
  }
};

const attendanceStatuses = ["present", "late", "excused", "absent"] as const;
type AttendanceStatus = (typeof attendanceStatuses)[number];

const statusLabel = (status: string) =>
  status ? status.charAt(0).toUpperCase() + status.slice(1) : "";

const ManageAttendance: Component = () => {
  const navigate = useNavigate();
  const [meetings, { refetch: refetchMeetings }] = createResource(() =>
    attendanceService.getAdminMeetings(),
  );
  const [selectedMeetingId, setSelectedMeetingId] = createSignal("");
  const [meetingDetail, setMeetingDetail] = createSignal<AttendanceMeeting | null>(null);
  const [attendance, setAttendance] = createSignal<AttendanceUserRecord[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [qrDataUrl, setQrDataUrl] = createSignal("");
  const [openStatusUserId, setOpenStatusUserId] = createSignal("");
  const [pendingStatusChange, setPendingStatusChange] = createSignal<{
    user: AttendanceUserRecord;
    status: AttendanceStatus;
  } | null>(null);
  const [markingStatus, setMarkingStatus] = createSignal(false);

  const selectedMeeting = () => meetingDetail();

  onMount(() => {
    const meetingId = new URLSearchParams(window.location.search).get("meeting");
    if (meetingId) setSelectedMeetingId(meetingId);
  });

  createEffect(() => {
    const first = meetings()?.[0];
    if (!selectedMeetingId() && first) {
      setSelectedMeetingId(first.id);
    }
  });

  createEffect(() => {
    const id = selectedMeetingId();
    if (!id) return;
    void loadMeeting(id);
  });

  createEffect(() => {
    const value = getCheckInValue(selectedMeeting()?.checkInToken);
    if (!value) {
      setQrDataUrl("");
      return;
    }

    toDataURL(value, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#ffffff" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  });

  const loadMeeting = async (id: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const payload = await attendanceService.getAdminMeeting(id);
      setMeetingDetail(payload.meeting);
      setAttendance(payload.attendance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load meeting");
    } finally {
      setDetailLoading(false);
    }
  };

  const requestStatusChange = (
    user: AttendanceUserRecord,
    status: AttendanceStatus,
  ) => {
    setOpenStatusUserId("");
    if (user.status === status) return;
    setPendingStatusChange({ user, status });
  };

  const confirmStatusChange = async () => {
    const change = pendingStatusChange();
    const meeting = selectedMeeting();
    if (!change || !meeting) return;

    setError("");
    setMarkingStatus(true);
    try {
      await attendanceService.markAttendance(meeting.id, {
        userId: change.user.userId,
        status: change.status,
        note: "Manual admin mark",
      });
      setPendingStatusChange(null);
      await loadMeeting(meeting.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update attendance");
    } finally {
      setMarkingStatus(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        onBack={() => navigate("/admin/attendance")}
        icon={<TbOutlineCalendarCheck class="h-5 w-5" />}
        title="Past Meetings"
        subtitle="View QR codes and manage attendance records"
        actions={
          <Button
            type="button"
            variant="adminOutline"
            size="sm"
            onClick={() => navigate("/admin/attendance/create")}
            class="!bg-white/10 !text-white hover:!bg-white/20"
          >
            <TbOutlinePlus class="h-4 w-4" />
            New
          </Button>
        }
      />
      <PageBody>
        <div class="space-y-4">
          <Show when={error()}>
            <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-base text-red-700">{error()}</div>
          </Show>

          <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-semibold text-gray-900">Meetings</h2>
                <p class="text-sm text-gray-500">Select a meeting to show its QR and attendance list.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => void refetchMeetings()}>
                <TbOutlineRefresh class="h-4 w-4" />
                Refresh
              </Button>
            </div>
            <Show when={!meetings.loading} fallback={<LoadingState label="Loading meetings..." />}>
              <Show
                when={(meetings() || []).length > 0}
                fallback={<div class="rounded-lg bg-gray-50 p-4 text-gray-500">No meetings yet.</div>}
              >
                <select
                  value={selectedMeetingId()}
                  onChange={(event) => setSelectedMeetingId(event.currentTarget.value)}
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                >
                  <For each={meetings() || []}>
                    {(meeting) => (
                      <option value={meeting.id}>
                        {meeting.title} · {formatDateTime(meeting.startsAt)}
                      </option>
                    )}
                  </For>
                </select>
              </Show>
            </Show>
          </div>

          <Show when={selectedMeeting()}>
            {(meeting) => (
              <div class="grid gap-4 lg:grid-cols-[360px_1fr]">
                <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <h2 class="text-lg font-semibold text-gray-900">{meeting().title}</h2>
                  <div class="mt-1 text-sm text-gray-500">{formatDateTime(meeting().startsAt)}</div>
                  <Show when={meeting().location}>
                    <div class="mt-1 text-sm text-gray-500">{meeting().location}</div>
                  </Show>
                  <div class="mt-4 flex justify-center rounded-lg bg-white p-3 ring-1 ring-gray-200">
                    <Show when={qrDataUrl()} fallback={<div class="py-20 text-sm text-gray-500">Generating QR...</div>}>
                      <img src={qrDataUrl()} alt="Attendance QR code" class="h-72 w-72" />
                    </Show>
                  </div>
                  <div class="mt-3 break-all rounded-lg bg-gray-50 p-2 text-xs text-gray-500">
                    {getCheckInValue(meeting().checkInToken)}
                  </div>
                </div>

                <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div class="mb-3 flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-gray-900">Attendance</h2>
                    <div class="text-sm text-gray-500">{attendance().filter((row) => row.status === "present" || row.status === "late").length} / {attendance().length}</div>
                  </div>
                  <Show when={!detailLoading()} fallback={<LoadingState label="Loading attendance..." />}>
                    <div class="overflow-x-auto">
                      <table class="min-w-full text-left text-sm">
                        <thead class="border-b border-gray-200 text-gray-500">
                          <tr>
                            <th class="py-2 pr-3 font-semibold">FSC</th>
                            <th class="py-2 pr-3 font-semibold">Name</th>
                            <th class="py-2 pr-3 font-semibold">Status</th>
                            <th class="py-2 pr-3 font-semibold">Checked In</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={attendance()}>
                            {(row) => (
                              <tr class="border-b border-gray-100">
                                <td class="py-2 pr-3 text-gray-700">{row.fscCode}</td>
                                <td class="py-2 pr-3 text-gray-900">{row.nickname || row.fullName || row.email}</td>
                                <td class="relative py-2 pr-3">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenStatusUserId(
                                        openStatusUserId() === row.userId ? "" : row.userId,
                                      )
                                    }
                                    class={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ring-1 transition hover:brightness-95 ${statusClass(row.status)}`}
                                  >
                                    {statusLabel(row.status)}
                                    <TbOutlineChevronDown class="h-3.5 w-3.5" />
                                  </button>
                                  <Show when={openStatusUserId() === row.userId}>
                                    <div class="absolute left-0 top-9 z-20 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                                      <For each={attendanceStatuses}>
                                        {(status) => (
                                          <button
                                            type="button"
                                            disabled={row.status === status}
                                            onClick={() => requestStatusChange(row, status)}
                                            class="block w-full px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:bg-gray-50 disabled:text-gray-400"
                                          >
                                            {statusLabel(status)}
                                          </button>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </td>
                                <td class="py-2 pr-3 text-gray-600">{formatDateTime(row.checkedInAt)}</td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </div>
      </PageBody>
      <ConfirmModal
        open={Boolean(pendingStatusChange())}
        title="Update Attendance?"
        message={
          pendingStatusChange()
            ? `Change ${
                pendingStatusChange()?.user.nickname ||
                pendingStatusChange()?.user.fullName ||
                pendingStatusChange()?.user.email ||
                "this user"
              } from ${statusLabel(
                pendingStatusChange()?.user.status || "",
              )} to ${statusLabel(pendingStatusChange()?.status || "")}?`
            : ""
        }
        confirmLabel="Update"
        cancelLabel="Cancel"
        variant="admin"
        confirmLoading={markingStatus()}
        confirmLoadingLabel="Updating..."
        onConfirm={() => void confirmStatusChange()}
        onCancel={() => {
          if (!markingStatus()) setPendingStatusChange(null);
        }}
      />
    </PageShell>
  );
};

export default ManageAttendance;
