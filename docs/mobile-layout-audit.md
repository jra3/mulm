# Mobile layout audit

The audit confirmed five mobile layout defects in the current checkout: admin species pagination, the approved submission editor, species external links, annual standings navigation, and the species bulk action toolbar. The first two deserve attention first because navigation controls or form fields leave the visible area. Most member forms fit the tested phone viewport, but submission histories still require substantial sideways scrolling.

Three agents covered public pages, member workflows, and admin workflows. The lead agent independently reproduced the annual navigation issue and tested populated species reference links. The audit itself changed no application source; approved repairs are recorded under [Review decisions](#review-decisions).

## Scope and evidence

- Checkout: `t3code/audit-mobile-layout`, commit `90532f1`, audited October 13, 2026.
- Environment: local application with a disposable database, 1,727 catalogue species, member and committee accounts, 15 submissions across three programs and five lifecycle states, two tank presets, and three collection entries. No production data was changed.
- Browser: actual top-level application pages in the T3 collaborative browser at **390 × 844 CSS pixels**. Desktop scrollbars reduced the usable document width to 375px on longer pages. Measurements below distinguish that width from the outer viewport.
- Evidence: rendered DOM dimensions, actual page interactions, and source correlation. Screenshot capture and video recording failed. Attempts to resize to narrower phone widths also failed. **This is a browser layout audit at one verified phone size, not a completed visual or cross-device audit.**

## Confirmed defects

### 1 Admin species pagination loses navigation controls

**Priority: high.** Open `/admin/species?page=10` with the seeded multi-page catalogue and scroll to the pagination.

At 390px viewport width, the document expands to 453px. The Previous link starts at approximately **−79px**, leaving most of it off the left edge; Next starts at **394px**, entirely beyond the right edge. Normal page scrolling cannot reveal the negative-left portion of Previous.

Source: [speciesList.pug](../src/views/admin/speciesList.pug), line 272. The outer centered flex row and inner page-number row do not wrap. Middle pages show enough number links and ellipses to exceed the available width.

Repair direction: use a compact phone layout with Previous, current page, and Next; expand the numbered links at wider breakpoints. Keep every navigation control inside the page width. Check both first and middle pages.

### 2 Approved submission editing overflows inside the dialog

**Priority: high.** As committee, open an approved submission such as `/submissions/5`, choose **Edit Approved Submission**, and inspect the Details tab.

The form has **322px of client width and 429px of scrollable content**. Its details grid is 274px wide, but creates columns of approximately 191px and 198px plus a 16px gap. Count and Spawn Locations extend to approximately **x = 447px**, beyond both the dialog edge near 356px and the 390px viewport. URL and notes fields also extend beyond their intended container.

Source: [editApprovedSubmission.pug](../src/views/admin/editApprovedSubmission.pug), line 51 and the unconditional `col-span-2` fields beginning at lines 105, 115, and 125. Those spans create two implicit columns even below the `md` breakpoint.

Repair direction: explicitly use one column on phones and apply two-column spans only at the matching wider breakpoint. Check Details and Tank Info, long selected values, and the dialog's own scroll width as well as the document width.

### 3 Species external reference URLs widen the whole page

**Priority: medium.** Open a species with an external reference. The disposable fixture `/species/1724` was populated with a representative URL: `https://www.fishbase.se/summary/Poecilia-reticulata.html`.

The document becomes **433px wide against a 375px client area**. The link's text child measures about 385px and ends at x = 433px. Although the URL has `truncate`, its parent flex item retains its automatic minimum width.

Source: [species/detail.pug](../src/views/species/detail.pug), the `.flex-1` wrapper around the reference label and URL, at line 134.

A browser-only diagnostic setting `min-width: 0` on that child changed document width **433 → 375px**; reverting it restored 433px. This confirms the cause. No source change was applied.

Repair direction: let the flex child shrink and keep the displayed URL bounded or wrapped. Check normal and longer URLs, not just species with no reference metadata.

### 4 Annual standings footer clips the year links

**Priority: medium.** Open `/annual/2025/fish`, where both previous and next years appear beside the three program buttons.

At 390px client width, document width becomes **401px**. The previous-year link starts at **−10.86px**; the next-year link ends at **400.86px**. The leftmost part is clipped beyond the normal scroll origin. The current-year fixture with only one year link fitted this width.

Source: [standings.pug](../src/views/standings.pug), line 35. The centered flex row uses horizontal spacing without wrapping.

Repair direction: put year navigation and program switching on separate phone rows, or wrap with row and column gaps. Check a middle year with both arrows, across programs.

### 5 Selecting species makes the bulk toolbar overflow and labels stack awkwardly

**Priority: medium, smaller impact than the first two.** Open `/admin/species` and select a species checkbox.

The unselected page has document width **375px**. Selection expands it to **385px**, and Clear Selection reaches approximately x = 385px. Bulk Edit Points and Sync IUCN Data become three-line, approximately 76px-tall buttons.

Source: [speciesList.pug](../src/views/admin/speciesList.pug), lines 222–245. The selection count and three actions share an unwrapped flex row.

Repair direction: stack the selection count and actions on phones, or use a responsive action grid. Verify the selected state independently of the initial page and the contained species table.

## Additional mobile usability concerns

These observations are distinct from uncontrolled page overflow.

- **Member submission histories require substantial sideways scrolling.** On `/member/1`, three seven-column tables measure **786px, 869px, and 742px** inside **343px** containers. Species details, dates, and points cannot be read together without panning. The containment is technically correct, but this remains a strong candidate for mobile cards or reduced columns given the app's mobile-first intent. Source: [member.pug](../src/views/member.pug), line 16.
- **Custom collection names hide identifying qualifiers.** Names requiring 416–453px are truncated into 235px on `/member/1/collection`. Custom entries have no detail link or hover card to reveal the name; owners can open Edit as a workaround. Let these identity labels wrap. Source: [collectionCard.pug](../src/views/mixins/collectionCard.pug), line 56.
- **Plant and coral supplement inputs are cramped.** Each text input is approximately 144px wide beside the remove button, so the dosing placeholder is clipped. The form remains usable, but stacked fields would provide better editing space. Source: [supplementLine.pug](../src/views/bapForm/supplementLine.pug), line 2.
- **The canonical recommendation sync banner is excessively tall.** A fixed-width action leaves the explanatory text approximately 144px wide, wrapping it across 17 lines. It fits horizontally at the tested width but would benefit from stacking. Source: [canonicalRecommendations.pug](../src/views/admin/canonicalRecommendations.pug), line 93.

Species explorer and admin tables also use contained horizontal scrolling. They should be evaluated as product design choices, rather than counted automatically as page overflow defects. `/live` and `/live/demo` are explicitly meeting-display views; their wide typography and approximately 805px content were excluded from normal phone-layout defects.

## Coverage

| Area | Pages and states checked |
| --- | --- |
| Public | Home, current/prior annual standings, all lifetime programs, species explorer and multiple species details, populated breeder reports and collection cards, public member profile, empty activity, mobile menu, sign-in and sign-up dialogs. |
| Member | Signed-in home; profile and submission histories; collection and Add/Edit dialogs; account settings, new/edit tank presets, awards progress; Fish/Plant/Coral new forms; draft, pending, waiting and approved submission views; media editor; Save/Load Tank sidebars. |
| Admin | Approval and witness queues including expanded controls; request-changes dialog; approved editor and points correction; members and inline edit; species first/middle pages, selection toolbar and bulk points dialog; species editor, name-entry and merge forms; no-results filtering; canonical recommendations; live settings and external data. |

The [member route measurements](mobile-audit/member-measurements.json) preserve the 13-route member sweep. The [public](mobile-audit/public.md), [member](mobile-audit/member.md), and [admin](mobile-audit/admin.md) reports contain detailed reproduction and coverage notes. The public pass preceded the lead agent’s populated external-link follow-up, which confirmed defect 3 above.

## Remaining verification

Repeat the five reproductions at 320, 375, 390, and 430px when browser resizing and screenshots work reliably. Review screenshots, not just widths, and check actual iOS and Android keyboard/touch behavior. Include populated activity, specialty-award states, enabled OAuth, CARES, and uploaded media; those were absent, gated, or not exercised here. The collection Link dialog was opened but its final measurement was interrupted.

For subsequent repairs, check that both document and dialog `scrollWidth` stay within `clientWidth`, controls do not have negative left coordinates, and important text stays readable. Preserve scrolling only in the specifically approved table or display views.

## Review decisions

- Pagination proposal approved and implemented in `src/views/admin/speciesList.pug`. Browser checks passed at 320, 375, 390, 430, and 1280px, including first/last-page disabled controls and filter-preserving navigation. All 254 existing Pug template tests passed. The approved prototype and screenshots are archived on local branch `prototype/mobile-pagination-20261013` at `2156e3b`.
- Approved-submission editor proposal approved and implemented: full-screen on phones, one-column fields, and reduced side padding, matching the existing shared dialog layout. Browser checks passed for both tabs and all three programs at 320, 375, 390, 430, 640, 768, and 1280px, including reaching Save and closing/reopening with the native dialog controls. All 254 template tests passed. The prototype is archived on local branch `prototype/mobile-approved-editor-20261013` at `e0b77ad`.
- Species external links approved and implemented: the flex child can shrink and the complete URL wraps inside its card. Normal and 200+ character URLs fit at 320, 375, 390, 430, and 1280px; all 254 template tests pass. Prototype archived on local branch `prototype/mobile-species-links-20261014` at `f654926`.
- Annual standings approved and implemented: program controls above the program heading on phones, and a year picker embedded in the page title. The user reported a detached native year popup in Chrome device emulation; the implementation renders a viewport-bounded menu inside the page instead. Eight Playwright cases verify open-menu geometry at 320, 375, 390, 400, 430, and 1280px; Escape/outside dismissal; keyboard selection; resize; and preserving program/year when navigating. All 254 Pug template tests pass. [Before/after](mobile-audit/annual-standings/implemented-before-after.png) and [open picker](mobile-audit/annual-standings/implemented-menu-open-390.png). Prototype variants archived on local branch `prototype/mobile-annual-navigation-20261014` at `8abf741`; prototype code is excluded from the application branch.
- Shipping scope is these four approved repairs. The species bulk toolbar and secondary audit findings remain for subsequent one-at-a-time visual review.
