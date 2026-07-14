import { Component, For, Show, createEffect, createResource, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { TbOutlineCalendarCheck, TbOutlineQrcode } from "solid-icons/tb";

import { Button, LoadingState, PageBody, PageHeader, PageShell } from "../../../components/ui";
import { attendanceService } from "../../../services/attendanceService";
import { teamService, type TeamUser } from "../../../services/teamService";

const pad = (value: number) => String(value).padStart(2, "0");

const parseLocalDateTime = (dateValue: string, timeValue: string) => {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDefaultTitle = (date: Date) => {
  const month = date.toLocaleString("en-SG", { month: "long" });
  const year = date.getFullYear();
  return `${month} ${year} District Meeting`;
};

const CreateAttendanceMeeting: Component = () => {
  const navigate = useNavigate();
  const [team] = createResource(() =>
    teamService.getTeamData({ includeDeletedAgencies: false }),
  );
  const [title, setTitle] = createSignal("");
  const [autoTitle, setAutoTitle] = createSignal(false);
  const [description, setDescription] = createSignal("");
  const [startDate, setStartDate] = createSignal("");
  const [startTime, setStartTime] = createSignal("");
  const [expiryMinutes, setExpiryMinutes] = createSignal("15");
  const [selectedUserIds, setSelectedUserIds] = createSignal<string[]>([]);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal("");
  const [initializedAttendees, setInitializedAttendees] = createSignal(false);

  const activeUsers = () =>
    (team()?.users || []).filter((user) => {
      const fscCode = String(user.fscCode || "").trim();
      return fscCode && !fscCode.startsWith("00");
    });

  createEffect(() => {
    if (initializedAttendees()) return;
    const users = activeUsers();
    if (!users.length) return;
    setSelectedUserIds(users.map((user) => user.id));
    setInitializedAttendees(true);
  });

  const selectAllUsers = () => {
    setSelectedUserIds(activeUsers().map((user) => user.id));
  };

  const clearSelectedUsers = () => {
    setSelectedUserIds([]);
  };

  const toggleUser = (user: TeamUser) => {
    const id = user.id;
    setSelectedUserIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  const updateStartDate = (value: string) => {
    setStartDate(value);
    maybeFillTitle(value, startTime());
  };

  const updateStartTime = (value: string) => {
    setStartTime(value);
    maybeFillTitle(startDate(), value);
  };

  const maybeFillTitle = (dateValue: string, timeValue: string) => {
    if (title().trim() && !autoTitle()) return;
    const startsDate = parseLocalDateTime(dateValue, timeValue);
    if (!startsDate) return;
    setTitle(formatDefaultTitle(startsDate));
    setAutoTitle(true);
  };

  const updateTitle = (value: string) => {
    setTitle(value);
    setAutoTitle(false);
  };

  const createMeeting = async () => {
    if (!title().trim()) {
      setError("Meeting title is required.");
      return;
    }
    if (!startDate() || !startTime()) {
      setError("Meeting date and time are required.");
      return;
    }
    const startsDate = parseLocalDateTime(startDate(), startTime());
    if (!startsDate) {
      setError("Meeting start time is invalid.");
      return;
    }
    const expiry = Number(expiryMinutes());
    if (!Number.isFinite(expiry) || expiry <= 0) {
      setError("QR expiry must be at least 1 minute after the meeting starts.");
      return;
    }
    if (selectedUserIds().length === 0) {
      setError("Select at least one expected attendee.");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const meeting = await attendanceService.createMeeting({
        title: title().trim(),
        description: description().trim(),
        startsAt: startsDate.toISOString(),
        endsAt: new Date(startsDate.getTime() + Math.round(expiry) * 60_000).toISOString(),
        attendeeMode: "selected",
        attendeeUserIds: selectedUserIds(),
      });
      navigate(`/admin/attendance/meetings?meeting=${encodeURIComponent(meeting.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create meeting");
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        variant="admin"
        onBack={() => navigate("/admin/attendance")}
        icon={<TbOutlineCalendarCheck class="h-5 w-5" />}
        title="Create Meeting"
        subtitle="Set meeting details and expected attendees"
      />
      <PageBody>
        <div class="max-w-2xl rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <Show when={error()}>
            <div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-base text-red-700">{error()}</div>
          </Show>
          <div class="space-y-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="text-sm font-semibold text-gray-700">Date</span>
                <input
                  type="date"
                  value={startDate()}
                  onInput={(event) => updateStartDate(event.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                />
              </label>
              <label class="block">
                <span class="text-sm font-semibold text-gray-700">Time</span>
                <input
                  type="time"
                  step="60"
                  value={startTime()}
                  onInput={(event) => updateStartTime(event.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                />
              </label>
            </div>
            <label class="block">
              <span class="text-sm font-semibold text-gray-700">Title</span>
              <input
                value={title()}
                onInput={(event) => updateTitle(event.currentTarget.value)}
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              />
            </label>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="text-sm font-semibold text-gray-700">QR Expiry</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={expiryMinutes()}
                  onInput={(event) => setExpiryMinutes(event.currentTarget.value)}
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                />
                <span class="mt-1 block text-xs text-gray-500">minutes after meeting start</span>
              </label>
            </div>
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
              <Show when={!team.loading} fallback={<div class="mt-3"><LoadingState label="Loading users..." /></div>}>
                <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div class="text-sm text-gray-500">
                    {selectedUserIds().length}/{activeUsers().length} users selected
                  </div>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllUsers}
                      class="rounded-md border border-gray-200 px-2.5 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={clearSelectedUsers}
                      class="rounded-md border border-gray-200 px-2.5 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Clear All
                    </button>
                  </div>
                </div>
                <div class="mt-2 max-h-72 space-y-1 overflow-auto rounded-lg bg-gray-50 p-2">
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
        </div>
      </PageBody>
    </PageShell>
  );
};

export default CreateAttendanceMeeting;
