/**
 * Timezone-aware date math. Local days are "YYYY-MM-DD" strings in a given
 * IANA timezone; geometry is epoch ms. Never assume a day is 24h (DST) or
 * that a provider date equals a local day (ESPN buckets by US Eastern).
 * See docs/DATA.md "Local days and timezones".
 */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    partsCache.set(tz, fmt);
  }
  return fmt;
}

/** Offset (ms) of `tz` from UTC at the given instant. */
export function tzOffsetMs(instantMs: number, tz: string): number {
  const parts = zonedFormatter(tz).formatToParts(new Date(instantMs));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - instantMs;
}

/** Local calendar date ("YYYY-MM-DD") of an instant in `tz`. */
export function localDateInTz(ms: number, tz: string): string {
  const parts = zonedFormatter(tz).formatToParts(new Date(ms));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** UTC instant of local midnight for a local date in `tz` (DST-safe). */
export function localMidnightUtc(date: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`invalid date "${date}"`);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Two passes handle DST boundaries where midnight offset differs from
  // the offset just before/after the transition.
  const first = naive - tzOffsetMs(naive, tz);
  const second = naive - tzOffsetMs(first, tz);
  return second;
}

/** "YYYY-MM-DD" +/- n days (UTC-noon anchored, immune to DST). */
export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, 12, 0, 0) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Day of week (0=Sun … 6=Sat) of a "YYYY-MM-DD" date string. */
export function isoDayDow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

export function todayInTz(tz: string, nowMs: number = Date.now()): string {
  return localDateInTz(nowMs, tz);
}

/**
 * Start of the app week window: the most recent Thursday (window runs
 * Thursday→Wednesday). Today always falls inside — including Tue/Wed.
 */
export function weekStartFor(nowMs: number, tz: string): string {
  const today = todayInTz(tz, nowMs);
  const back = (isoDayDow(today) + 7 - 4) % 7; // 4 = Thursday
  return back === 0 ? today : addDaysIso(today, -back);
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
}

/**
 * Provider (US Eastern) date range covering the week window ± 1 day.
 * Any timezone's local week maps to ET dates within ±1 day of the same
 * window, so string arithmetic suffices — no tz math needed here.
 */
export function providerRangeForWeek(weekStart: string): {
  start: string;
  end: string;
} {
  return { start: addDaysIso(weekStart, -1), end: addDaysIso(weekStart, 7) };
}

export function formatTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

export function formatDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
