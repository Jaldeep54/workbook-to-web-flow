/**
 * Calendar dates (order_date, delivery_date, payment_date, cost_date, ...) are
 * stored as plain `YYYY-MM-DD` strings, exactly like the Postgres `date`
 * columns they replace. Storing them as BSON dates would drag every filter and
 * month bucket through UTC conversion, which is how "the order moved a day"
 * bugs happen. Only true timestamps (createdAt/updatedAt) are real dates.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Normalizes anything date-ish to `YYYY-MM-DD`, or null when unusable. */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    if (ISO_DATE.test(value)) return isIsoDate(value) ? value : null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * The month bucket every report filters on — the first day of the date's
 * month, mirroring the `month` generated columns in the old schema
 * (`date - (EXTRACT(DAY FROM date)::int - 1)`).
 */
export function monthKey(value: unknown): string | null {
  const iso = toIsoDate(value);
  return iso ? `${iso.slice(0, 7)}-01` : null;
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function currentMonth(): string {
  return `${todayIso().slice(0, 7)}-01`;
}

/** Shifts a month key by N months (negative shifts back). */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
}

/** Last calendar day of a month key, e.g. "2026-02-01" -> "2026-02-28". */
export function endOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

/** The N month keys ending at (and including) `month`, oldest first. */
export function monthWindow(month: string, months: number): string[] {
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) out.push(addMonths(month, -i));
  return out;
}

/** India-style financial year (April–March), keyed by its starting year. */
export function financialYearRange(fy: string | number): { start: string; end: string } {
  const startYear = Number(fy);
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 10_000) / 10_000;
