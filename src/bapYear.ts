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
