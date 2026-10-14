# Mobile audit: admin and committee

Audit completed against the actual locally served app at http://127.0.0.1:38573, using the T3 collaborative browser, top-level pages, and a 390 × 844 CSS pixel viewport. The desktop browser's vertical scrollbar leaves documentElement.clientWidth=375 on long pages; short pages have clientWidth=390. Measurements below distinguish innerWidth from layout clientWidth. No application code changed.

## Confirmed defects

### A1 — Species pagination places Previous and Next outside the phone (high priority)

- Route: `/admin/species?page=10`. Admin authenticated; seeded catalogue contains 1,727 species / 35 pages.
- Reproduce: open species management, reach a middle results page (page10), scroll to the pagination.
- At innerWidth390 / root clientWidth375, document scrollWidth=453. Previous button x=-78.54, width89.34, right10.81; almost all its text is off the left edge. Next x393.99, width59.29, right453.28; entirely off the right edge. Pagination is at document y4500.
- Impact: normal catalogue browsing requires horizontal movement; centered negative overflow puts most of Previous outside the reachable start edge.
- Source: `src/views/admin/speciesList.pug:272` single centered nonwrapping flex row; `:276` inner nonwrapping number row. Includes Previous, pages1,8,9,10,11,12,35, ellipses, Next.
- Suggested direction: compact mobile pager with Previous / current-total / Next, or explicit wrapping that retains both navigation controls.

### A2 — Approved-submission Details dialog overflows horizontally and clips fields (high priority)

- Route: `/submissions/5` (approved fish submission), tap **Edit Approved Submission**. HTMX loads `/admin/submissions/5/edit-approved` into native `#edit-approved-dialog`.
- At innerWidth390/root client375, dialog left18.73/right356.00, width337.26. Scrollable form clientWidth322 but scrollWidth429 (107px horizontal excess).
- The Details grid has clientWidth274 and scrollWidth405; computed grid columns are190.502px and198.133px plus16px gap. Count and Spawn Locations controls run from x249.23 to447.36; dialog ends at356. Video URL, Article Link, and Breeder Notes also reach447.36.
- Impact: required editing controls are partly outside the modal, requiring horizontal scrolling inside a vertically scrolling phone dialog. Page-level overflow alone would miss this defect.
- Source: `src/views/admin/editApprovedSubmission.pug:51` grid only declares `md:grid-cols-2`; unconditional `.col-span-2` at lines105,115,125 creates two implicit columns on mobile. Dialog width90% and p6 further reduce available width (`src/views/submission/review.pug:146`, form line5).
- Confirming comparison: switching to **Tank Info** gives one274px column and form clientWidth322/scrollWidth322; no horizontal excess.
- Suggested direction: base one-column grid, responsive spans (`md:col-span-2`), min-width handling for controls, and mobile-appropriate dialog padding.

### A3 — Selecting species makes the bulk toolbar leak outside its card (lower priority)

- Route: `/admin/species` page1, check a species checkbox.
- Unselected root width375. Selected root scrollWidth385 while clientWidth375:10px page overflow in this preview.
- Toolbar box x16..358.74; Clear Selection button x290.55..385.06, extending26px beyond the card and10px beyond layout viewport. Bulk Edit Points width73.45/height75.96 and Sync IUCN Data width67.01/height75.96: labels wrap to three lines; Clear Selection height55.97.
- Source: `src/views/admin/speciesList.pug:223`, count plus three actions held in one nonwrapping flex row.
- This is smaller than A1/A2, and the exact page overflow depends on browser scrollbar treatment. The card boundary violation and severely compressed labels are independently measured.
- Suggested direction: stack the selection count and wrap/full-width mobile actions.

## Lower-priority layout observation

`/admin/species/canonical-recommendations`: the Sync All Species with IUCN banner holds a fixed150.60px button beside a144.47px paragraph. Paragraph height339.86px (17 lines at20px line height), whole row391.87px tall. No horizontal page overflow at390, but much of the screen is consumed by a very narrow prose column. Source `src/views/admin/canonicalRecommendations.pug:93` and no-wrap, no-shrink button at100. Stack this banner on phones if polishing admin screens.

## Deliberate local table scrolling, not page overflow defects

- `/admin/members`: table wrapper358px / scroll758px; inline member editor increases table scroll width819px. Page remains390px wide. Mobile editing is cumbersome (Edit/Save at far right), but this is an intentional table scroller.
- `/admin/species`: results table is deliberately inside `.overflow-x-auto`; measured pagination/toolbar defects above occur outside that table scroller.
- `/admin/species/canonical-recommendations`: recommendations table uses its own horizontal scroll wrapper. A synthetic pending recommendation was seeded into the disposable database for this state.

## Coverage

All browser checks at390×844. Successful normal-layout/no-page-overflow checks:

- `/admin/queue`: list, expanded ready row4, first approval tap arms confirmation (no second/post tap). Confirm label fits326.74×44px target; root375/scroll375. Truncated species text is intentionally clipped by its ancestor and does not create page overflow.
- `/admin/queue/plant`, `/admin/witness-queue/coral` filter pages.
- `/admin/witness-queue`: list and expanded pending row2; page width390.
- `/admin/waiting-period`: redirects to `/admin/queue#queue-waiting`; no page overflow.
- `/submissions/2`: pending committee screening view; no page overflow.
- Request changes dialog opened from pending submission via `/admin/dialog/submissions/2/request-changes`; content375/scroll375, textarea342.75px wide; no feedback sent.
- `/submissions/5`: approved base view; no page overflow. Approved Details modal has A2; Tank Info does not.
- `/admin/submissions/5/correct-points`: rendered correction page; no page overflow; no correction saved.
- `/admin/members`: roster and member1 inline editor, left without saving; local table scrolling noted above.
- `/admin/species`: page1, page10, selected toolbar, Bulk Edit Points dialog (content375/scroll375), search no-results state; no bulk edit submitted.
- `/admin/species/1/edit`: base editor, Add Common Name inline form (input165px, no page overflow), Merge Species dialog (content375/scroll375); no species/name save, merge or delete submitted.
- `/admin/species/canonical-recommendations`: populated synthetic pending row, sync banner and status control rendered; no accept/reject or external sync triggered.
- `/admin/live-settings`: rendered configuration/preview, no page overflow; no saved message.
- `/admin/external-data`: idle state, no page overflow; no sync started.

## Limits and reproducibility

- Browser screenshots and recordings failed with generic T3 client automation errors; none is represented as captured evidence. Findings are confirmed with actual rendered DOM geometry and real form/tab/checkbox interactions through preview_evaluate.
- Native resize attempts failed/disconnected the preview. No successful320/375/430 viewport confirmation in this agent's pass; don't extrapolate exact measurements to these widths. Browser desktop user agent means this is phone-size responsive layout auditing, not physical Safari/Android keyboard testing.
- Focused preview_click/type methods returned success without interaction in this environment; after observing actual DOM controls, evaluation invoked normal `.click()`/form submission and measured the resulting application-rendered state. No CSS/content mocks or iframe reconstruction used.
- Report covers representative admin routes/states, not every error, validation, hover, populated sync log or long-content variant. Dedicated admin reports route was not found; public standings/reports are handled by the public audit agent.
- Existing seeded catalogue1727 species was used. One clearly marked synthetic pending IUCN recommendation was added to temporary audit DB only for species960 Pseudotropheus crabro→Maylandia crabro. Admin/member test credentials and submissions are isolated local fixtures.
