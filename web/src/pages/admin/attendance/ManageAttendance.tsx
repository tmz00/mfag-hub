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
  TbOutlineQrcode,
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
import { teamService, type TeamUser } from "../../../services/teamService";

const formatDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const toLocalInputValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  const [team] = createResource(() =>
    teamService.getTeamData({ includeDeletedAgencies: false }),
  );
  const [selectedMeetingId, setSelectedMeetingId] = createSignal("");
  const [meetingDetail, setMeetingDetail] = createSignal<AttendanceMeeting | null>(null);
  const [attendance, setAttendance] = createSignal<AttendanceUserRecord[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal("");
  const [qrDataUrl, setQrDataUrl] = createSignal("");

  const [title, setTitle] = createSignal("");
  const [location, setLocation] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [startsAt, setStartsAt] = createSignal(toLocalInputValue(new Date()));
  const [endsAt, setEndsAt] = createSignal("");
  const [attendeeMode, setAttendeeMode] = createSignal<"all" | "selected">("all");
  const [selectedUserIds, setSelectedUserIds] = createSignal<string[]>([]);
  const [creating, setCreating] = createSignal(false);
  const [openStatusUserId, setOpenStatusUserId] = createSignal("");
  const [pendingStatusChange, setPendingStatusChange] = createSignal<{
    user: AttendanceUserRecord;
    status: AttendanceStatus;
  } | null>(null);
  const [markingStatus, setMarkingStatus] = createSignal(false);

  const activeUsers = () =>
    (team()?.users || []).filter((user) => String(user.fscCode || "").trim());

  const selectedMeeting = () => meetingDetail();

  onMount(() => {
    const token = new URLSearchParams(window.location.search).get("meeting");
    if (token) setSelectedMeetingId(token);
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
    const meeting = selectedMeeting();
    const value = getCheckInValue(meeting?.checkInToken);
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

  const toggleUser = (user: TeamUser) => {
    const id = user.id;
    setSelectedUserIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  const createMeeting = async () => {
    if (!title().trim()) {
      setError("Meeting title is required.");
      return;
    }
    if (!startsAt()) {
      setError("Meeting start time is required.");
      return;
    }
    if (attendeeMode() === "selected" && selectedUserIds().length === 0) {
      setError("Select at least one expected attendee or choose All users.");
      return;
    }

    setCreating(true);
    setError("");
    setSuccess("");
    try {
      const meeting = await attendanceService.createMeeting({
        title: title().trim(),
        location: location().trim(),
        description: description().trim(),
        startsAt: new Date(startsAt()).toISOString(),
        endsAt: endsAt() ? new Date(endsAt()).toISOString() : undefined,
        attendeeMode: attendeeMode(),
        attendeeUserIds: selectedUserIds(),
      });
      setTitle("");
      setLocation("");
      setDescription("");
      setEndsAt("");
      setSelectedUserIds([]);
      setAttendeeMode("all");
      setSelectedMeetingId(meeting.id);
      setSuccess("Meeting created.");
      await refetchMeetings();
      await loadMeeting(meeting.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create meeting");
    } finally {
      setCreating(false);
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
    if (!change) return;

    const meeting = selectedMeeting();
    if (!meeting) return;
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
        onBack={() => navigate("/admin")}
        icon={<TbOutlineCalendarCheck class="h-5 w-5" />}
        title="Attendance"
        subtitle="Create meeting QR codes and track attendance"
      />
      <PageBody>
        <div class="grid gap-5 xl:grid-cols-[minmax(340px,420px)_1fr]">
          <section class="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div>
              <h2 class="text-lg font-semibold text-gray-900">Create Meeting</h2>
              <p class="text-sm text-gray-500">Generate a QR code for FSC check-in.</p>
            </div>
            <div class="space-y-3">
              <label class="block">
                <span class="text-sm font-semibold text-gray-700">Title</span>
                <input
                  value={title()}
                  onInput={(event) => setTitle(event.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                />
              </label>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="block">
                  <span class="text-sm font-semibold text-gray-700">Starts</span>
                  <input
                    type="datetime-local"
                    value={startsAt()}
                    onInput={(event) => setStartsAt(event.currentTarget.value)}
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                  />
                </label>
                <label class="block">
                  <span class="text-sm font-semibold text-gray-700">Ends</span>
                  <input
                    type="datetime-local"
                    value={endsAt()}
                    onInput={(event) => setEndsAt(event.currentTarget.value)}
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                  />
                </label>
              </div>
              <label class="block">
                <span class="text-sm font-semibold text-gray-700">Location</span>
                <input
                  value={location()}
                  onInput={(event) => setLocation(event.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                />
              </label>
              <label class="block">
                <span class="text-sm font-semibold text-gray-700">Notes</span>
                <textarea
                  value={description()}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                  rows={2}
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                />
              </label>
              <div class="rounded-lg border border-gray-200 p-3">
                <div class="mb-2 text-sm font-semibold text-gray-700">Expected Attendees</div>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAttendeeMode("all")}
                    class={`rounded-lg border px-3 py-2 text-sm font-semibold ${attendeeMode() === "all" ? "border-admin-from bg-admin-from/10 text-admin-from" : "border-gray-200 text-gray-600"}`}
                  >
                    All users
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendeeMode("selected")}
                    class={`rounded-lg border px-3 py-2 text-sm font-semibold ${attendeeMode() === "selected" ? "border-admin-from bg-admin-from/10 text-admin-from" : "border-gray-200 text-gray-600"}`}
                  >
                    Selected
                  </button>
                </div>
                <Show when={attendeeMode() === "selected"}>
                  <div class="mt-3 max-h-48 space-y-1 overflow-auto rounded-lg bg-gray-50 p-2">
                    <For each={activeUsers()}>
                      {(user) => (
                        <label class="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-white">
                          <input
                            type="checkbox"
                            checked={selectedUserIds().includes(user.id)}
                            onChange={() => toggleUser(user)}
                          />
                          <span>{user.fscCode} · {user.nickname || user.fullName || user.email}</span>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <Button
                type="button"
                variant="admin"
                fullWidth
                onClick={() => void createMeeting()}
                disabled={creating()}
              >
                <TbOutlineQrcode class="h-5 w-5" />
                {creating() ? "Creating..." : "Create QR Meeting"}
              </Button>
            </div>
          </section>

          <section class="space-y-4">
            <Show when={error()}>
              <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-base text-red-700">{error()}</div>
            </Show>
            <Show when={success()}>
              <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-base text-emerald-700">{success()}</div>
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
            </div>

            <Show when={selectedMeeting()} fallback={<div class="rounded-lg border border-gray-200 bg-white p-4 text-gray-500">Create or select a meeting.</div>}>
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
                                          openStatusUserId() === row.userId
                                            ? ""
                                            : row.userId,
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
          </section>
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
