/**
 * BAP years are named for their ending year: September 2026 starts BAP 2027.
 * The portal rolls over at September 1 in the club's time zone. See
 * docs/program-calendar.md for the manual's July Board meeting distinction.
 */
const clubDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "numeric",
});

/**
 * First BAP year whose standings count points by approval date. Earlier years
 * keep spawn-date attribution because backfilled records carry import-time
 * approval dates rather than meeting dates.
 */
export const firstApprovalYear = 2027;

export function currentBapYear(now: Date = new Date()): number {
  const parts = clubDate.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  return month >= 9 ? year + 1 : year;
}

/** Inclusive start, exclusive end; September 1 is EDT (UTC−04:00). */
export function bapYearRange(year: number): { start: Date; end: Date } {
  return {
    start: new Date(`${year - 1}-09-01T00:00:00-04:00`),
    end: new Date(`${year}-09-01T00:00:00-04:00`),
  };
}

/** Spawn dates counted before firstApprovalYear: August 1 inclusive to August 1 exclusive. */
export function legacySpawnRange(year: number): { start: string; end: string } {
  return { start: `${year - 1}-08-01`, end: `${year}-08-01` };
}
