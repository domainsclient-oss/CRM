// Time-zone helpers without a date library (FR-TASK-001/002, FR-SET-001). Dates are stored in
// UTC; "day keys" (YYYY-MM-DD) are computed in the user's or tenant's IANA time zone.

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidDate(key: string): boolean {
  if (!DATE_PATTERN.test(key)) return false;
  const d = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}

function partsInZone(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function offsetMs(date: Date, tz: string): number {
  const p = partsInZone(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock date + time in `tz` → the UTC instant (handles DST by re-checking the offset). */
export function zonedToUtc(dateKey: string, time: string, tz: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(new Date(guess), tz);
  const second = guess - offsetMs(new Date(first), tz);
  return new Date(second);
}

/** The calendar day (YYYY-MM-DD) of an instant in `tz`. */
export function dayKey(date: Date, tz: string): string {
  const p = partsInZone(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Wall-clock time (HH:mm) of an instant in `tz`. */
export function timeKey(date: Date, tz: string): string {
  const p = partsInZone(date, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type TaskGroup = "overdue" | "today" | "next7" | "later" | "none";

/**
 * FR-TASK-002 grouping in the viewer's zone. Date-only tasks compare by calendar day; timed
 * tasks are overdue once their instant has passed.
 */
export function taskGroup(
  task: { dueAt: Date | null; dueIsDateOnly: boolean; dueDate?: string | null },
  now: Date,
  tz: string,
): TaskGroup {
  if (!task.dueAt) return "none";
  const today = dayKey(now, tz);
  const due = task.dueIsDateOnly && task.dueDate ? task.dueDate : dayKey(task.dueAt, tz);
  if (due < today || (!task.dueIsDateOnly && task.dueAt.getTime() < now.getTime()))
    return "overdue";
  if (due === today) return "today";
  if (due <= addDays(today, 7)) return "next7";
  return "later";
}
