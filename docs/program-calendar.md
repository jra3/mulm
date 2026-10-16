# BAP calendar and annual points

## What the club documents establish

The [published BAS manual](https://www.basny.org/Documents/BAP/BAS-BAP-Manual.pdf),
page 8 ([local text](../manual/BAS-BAP-Manual.txt)), requires verification after
raising the fry; spawning by itself does not complete a claim. The original
manual permits either a return visit or presentation at a meeting. The portal's
[current instructions](../RULES.md#4-bring-to-monthly-auction) explicitly say:
“Points are awarded at the meeting” when the offspring are presented.
[Approval](../CONTEXT.md) records that presentation; points set at the Witness
remain pending until Approval.

Page 9 says: “Breeder Award Program year will start in September and end at July
Board meeting. Spawns for July and August will be recognized in September.”
The text does **not** specify a fixed July closing date, explicitly assign a June
spawn presented in September to a particular year, or explain approvals entered
late. The committee may extend time/date limits. Lifetime points are cumulative
and never reset at a year boundary.

## Portal convention implemented here

From **BAP 2027** on, annual standings use the date of Approval (`approved_on`),
not reproduction, submission, or witnessing. The same convention applies to BAP, HAP and CAP.
A June spawn presented and approved in September counts in the new BAP year;
a July or August spawn presented in September does too. Pending points do not
count. Correcting a spawn date does not move already-awarded points between years.

The portal changes its default year on **September 1 at midnight in
America/New_York**. Years retain the existing ending-year numbering:
**BAP 2027 means 2026–2027**. The home page, `/annual` redirect and standings year
picker compute this on each request, so neither a yearly edit nor a restart is
needed. January 1 does not change the BAP year. Historical year links still work.

The ending-year label was confirmed on October 14, 2026: **BAP 2026** identifies
the September 2025–August 2026 reporting window, with its awards presented in
December 2026. **BAP 2027** identifies September 1, 2026–August 31, 2027 and is
already the current year in October 2026. Presenting the previous year's awards
in December does not postpone the September rollover. This confirms the naming
convention; the manual's precise July closing rule still needs clarification.

The reporting window includes September 1 and excludes the following September 1.
Every approval instant belongs to exactly one window, including midnight and the
last day of August. July and August leave the previous year's standings displayed
through the summer break; an approval actually recorded during that break belongs
to that same window. September 1 is currently EDT (UTC−04:00); the boundary helper
makes that explicit instead of using the server's local time zone.

The September-to-September reporting window and automatic rollover were confirmed
on October 15, 2026: the site treats the BAP year like a fiscal year, named for its
ending year, and shows 2027 as the most recent year in October 2026. This does not
mean the club runs meetings through August 31. Enforcing a
separate July Board meeting close would require its actual date and a decision
about late/summer approvals. The code does not invent that date, stop the committee
from approving, or move summer approvals to September automatically.

## Years before BAP 2027

BAP 2026 and earlier keep the previous rule: a submission counts in the year
whose August 1–July 31 window contains its spawn date. Only submissions approved
before September 1, 2026 count there; anything approved from that instant on
belongs to an approval-date year. Every submission therefore counts in exactly
one year, and a 2026 spawn first approved in September 2026 counts in BAP 2027.

The cutover is `firstApprovalYear` in `src/bapYear.ts`. Earlier years cannot use
approval dates because most of their records were backfilled with import-time
approval dates (69 rows spawned 2001–2020 carry June 23, 2026). Counting those by
approval would empty BAP 2018–2024 and move them into BAP 2025 and 2026, the
year whose awards are presented in December 2026.

## Existing records and delayed entry

`approved_on` currently records when the committee clicks Approve. This convention
assumes approval is recorded at the meeting, as the workflow intends. If approval
is entered after a September rollover for an earlier meeting, a distinct actual
presentation date or a documented correction is needed; the spawn date cannot
recover that information.

The historical CSV importer in `src/backfill/import.ts` currently sets
`approved_on` to the **import time**, not a historical meeting date. The script
helper in `scripts/lib/backfill.ts` accepts an explicit approval date but defaults
to now. Those dates must be audited against club records before moving the cutover
earlier. They cannot be corrected reliably from
reproduction dates alone. This change does not rewrite records or manufacture
historical meeting dates, and no production data was audited in this checkout.
Lifetime totals are unaffected by the annual reporting change.

## Verification

`NODE_ENV=test npx tsx --test src/__tests__/annual-standings.test.ts` covers the
September boundary to the millisecond, timestamps with different offsets, approval
versus spawn attribution, pending points, all three programs, automatic rollover
without restarting, January and leap-year dates, historical links, and ordinary
and HTMX redirects. Run under `TZ=UTC` and `TZ=America/Los_Angeles` to verify the
server's own time zone does not change the result.
