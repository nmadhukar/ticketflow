/**
 * Date helpers for ticket due dates.
 *
 * A due date is a CALENDAR DAY, not an instant. The <input type="date"> value (`yyyy-mm-dd`) is
 * exactly the day the user picked, and it must survive the round trip to the picker unchanged.
 */

/**
 * Formats a value as `yyyy-mm-dd` for an <input type="date">.
 *
 * A date-only value is returned as it is: it already IS the calendar day, and converting it through
 * `toISOString()` (UTC) used to hand back the day BEFORE the one selected east of UTC -- picking
 * 23 Oct 2026 showed 22 Oct 2026 in IST.
 *
 * An ISO timestamp is an instant: its day is read in the LOCAL calendar, the same way every other
 * due-date display in the app shows it (date-fns, `toLocaleDateString`).
 */
export function toYyyyMmDd(value?: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** A human-readable day (e.g. "Oct 23, 2026"), read in the local calendar. */
export function formatHumanDate(value?: string | null): string {
  if (!value) return "";
  const d = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
