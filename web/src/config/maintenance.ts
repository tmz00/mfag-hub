export const maintenanceSchedule = {
  // Edit only these two values. Leave either one blank to disable maintenance mode.
  // Supported local-time format: "YYYY-MM-DD HH:mm" (example: "2026-03-01 22:00")
  // ISO strings also work if you prefer an explicit timezone.
  time_start: "2026-03-01 12:00",
  time_end: "", // "2026-03-02 14:00",
  title: "System is under maintenance",
  message:
    "We're applying updates to improve stability. Please check back after some time. We apologize for the inconvenience.",
} as const;

export type MaintenanceWindowState = {
  configured: boolean;
  valid: boolean;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  msUntilEnd: number | null;
};

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)$/;

const parseScheduledTime = (value: string): number | null => {
  const input = value.trim();
  if (!input) return null;

  const localMatch = input.match(LOCAL_DATE_TIME_PATTERN);
  if (localMatch) {
    const [, year, month, day, hour, minute, second] = localMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? "0"),
      0,
    );

    const isValid =
      parsed.getFullYear() === Number(year) &&
      parsed.getMonth() === Number(month) - 1 &&
      parsed.getDate() === Number(day) &&
      parsed.getHours() === Number(hour) &&
      parsed.getMinutes() === Number(minute) &&
      parsed.getSeconds() === Number(second ?? "0");

    return isValid ? parsed.getTime() : null;
  }

  const timestamp = Date.parse(input);
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const getMaintenanceWindowState = (
  now = Date.now(),
): MaintenanceWindowState => {
  const startMs = parseScheduledTime(maintenanceSchedule.time_start);
  const endMs = parseScheduledTime(maintenanceSchedule.time_end);
  const configured = startMs !== null && endMs !== null;
  const valid = configured && startMs < endMs;

  if (!valid || startMs === null || endMs === null) {
    return {
      configured,
      valid,
      active: false,
      startsAt: startMs === null ? null : new Date(startMs),
      endsAt: endMs === null ? null : new Date(endMs),
      msUntilEnd: null,
    };
  }

  if (now < startMs || now >= endMs) {
    return {
      configured,
      valid,
      active: false,
      startsAt: new Date(startMs),
      endsAt: new Date(endMs),
      msUntilEnd: null,
    };
  }

  return {
    configured,
    valid,
    active: true,
    startsAt: new Date(startMs),
    endsAt: new Date(endMs),
    msUntilEnd: endMs - now,
  };
};
