import { toYyyyMmDd, formatHumanDate } from "../ticketDate.util";

/**
 * A due date is a calendar day. The picker <input type="date"> works in `yyyy-mm-dd`, and a picked
 * day must survive the form round trip unchanged in every time zone: east of UTC, converting a
 * date-only value through toISOString() (UTC) used to hand back the day BEFORE the one selected.
 */
describe("toYyyyMmDd: the day the user picked is the day that comes back", () => {
  const tz = process.env.TZ;
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("keeps a date-only value in a zone east of UTC (IST: pick 23 Oct, get 23 Oct)", () => {
    process.env.TZ = "Asia/Kolkata";
    // The old code did new Date("2026-10-23T00:00:00").toISOString() -> 2026-10-22T18:30Z -> "2026-10-22".
    expect(toYyyyMmDd("2026-10-23")).toBe("2026-10-23");
  });

  it("keeps a date-only value in a zone west of UTC too (pick 23 Oct, get 23 Oct)", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(toYyyyMmDd("2026-10-23")).toBe("2026-10-23");
  });

  it("reads the LOCAL day of an ISO timestamp, matching the rest of the app's due-date display", () => {
    process.env.TZ = "Asia/Kolkata";
    // 2026-10-22T18:30Z is 2026-10-23 00:00 in IST: the picker should show the 23rd.
    expect(toYyyyMmDd("2026-10-22T18:30:00.000Z")).toBe("2026-10-23");
  });

  it("pads single-digit months and days", () => {
    process.env.TZ = "UTC";
    expect(toYyyyMmDd("2026-01-05T00:00:00.000Z")).toBe("2026-01-05");
  });

  it("returns an empty string for a blank or unparseable value", () => {
    expect(toYyyyMmDd("")).toBe("");
    expect(toYyyyMmDd(null)).toBe("");
    expect(toYyyyMmDd(undefined)).toBe("");
    expect(toYyyyMmDd("not a date")).toBe("");
  });
});

describe("formatHumanDate", () => {
  it("shows the local calendar day of a stored timestamp", () => {
    process.env.TZ = "Asia/Kolkata";
    expect(formatHumanDate("2026-10-22T18:30:00.000Z")).toContain("23");
  });

  it("returns an empty string for a blank value", () => {
    expect(formatHumanDate("")).toBe("");
    expect(formatHumanDate(null)).toBe("");
  });
});
