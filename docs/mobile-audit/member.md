# Member mobile audit

Audited current checkout in the actual T3 native browser, shared tab_3, 390 × 844 CSS viewport, against disposable seeded server http://127.0.0.1:38573. Browser scrollbar left document client width ~375px. No source code edits. Local-only fixture additions: 2 tank presets, 3 collection entries with realistic descriptive names.

## Result

**No document-level horizontal overflow confirmed in the member route sweep.** Most forms use one column correctly. Member submission history does require horizontal scrolling inside its explicitly scrollable table, documented separately below. Collection labels and supplement fields have secondary mobile usability issues; these are not severe document overflow findings.

Measurements: [member-measurements.json](member-measurements.json) contains original native browser geometry for the 13 route checks.

## Confirmed secondary observations

1. **Member submission history requires extensive sideways scrolling.** `/me` redirects to `/member/1`; scroll to Breeders/Horticultural/Coral Awards Submissions. At 390px viewport, three table containers are 343px wide while their contents measure 786px, 869px, and 742px. Latin name, submitted date, and points fall beyond the initial view. This is intentional contained overflow, not a whole-page overflow bug. Source: `src/views/member.pug:16` (seven-column table inside `.overflow-x-auto`). Consider a mobile summary/card or reduced columns if mobile-first access to status, species and points is expected. Severity: usability observation, not automatic defect because tables can legitimately scroll.

2. **Collection custom names lose identifying qualifiers in ellipsis.** `/member/1/collection`, populated entry `Longfin Blue-Eyed Albino Bristlenose Pleco`: name renders in235px although its text needs416px. `Endler Livebearer — El Tigre collection location` needs453px but also gets235px. Source: `src/views/mixins/collectionCard.pug:56` puts all custom names in `truncate` beside Edit. Custom entries have no detail link, hover card or title to expose the whole name. Owner can use Edit/Link dialog as workaround, so this is secondary, not broken layout. For others' public collections source indicates no such name reveal, but logged-out public collection wasn't independently checked in this audit. Recommendation: allow two or more wrapped lines for collection identity. Severity: low/medium usability.

3. **Plant/Coral supplement inputs are cramped.** `/submissions/new?species_type=Plant`, Supplements section. Two inputs share a single row with remove button: each is144px wide (36px high), remove is38px wide. Dosing Instructions placeholder and ordinary dosage phrases cannot be seen completely at once. Source `src/views/bapForm/supplementLine.pug:2` unconditionally uses flex row. This is a usability candidate, not overflow or a blocked interaction. Consider stacking supplement and dosing fields on phones. Did not type/submit a supplement. Severity: low.

## Coverage with successful native geometry

All below showed document scrollWidth375px, viewport390px and no uncontrolled visible overflow:
- `/` signed-in dashboard.
- `/me` → `/member/1` including three populated submission histories (contained tables excepted).
- `/member/1/collection`, populated public/private entries and descriptive names.
- `/account`, account fields and populated tank presets.
- `/account/awards`, specialty awards progress.
- `/submissions/new` Fish.
- `/submissions/new?species_type=Plant`.
- `/submissions/new?species_type=Coral`.
- `/submissions/1` existing Fish draft (offscreen TomSelect keyboard inputs at x=-9980 are intentional, ignored).
- `/submissions/2` pending submission review.
- `/submissions/3` witnessed/waiting submission review.
- `/submissions/5` approved submission review.
- `/submissions/5/edit-media`.

Additional interactions checked through actual page DOM click/HTMX, then measured after load:
- Plant form Load Tank sidebar:320px wide and scrollWidth320px, long preset wraps to48px high; controls stay inside viewport.
- Plant form Save Tank sidebar: no document overflow.
- Account New Tank and Edit Tank expanded simultaneously: no document overflow.
- Collection Add dialog: full-width343px inputs, Cancel79px/Add148px buttons within viewport; body/action content fits844px height.
- Collection Edit dialog: labels/media/actions present and no document overflow.
- Collection Link clicked but measurement interrupted by native client disconnect; do not count as fully verified.

## Limits / evidence quality

- Native `preview_snapshot` failed with generic client error, so no screenshot/visual raster verification could be saved. `preview_recording_start` also failed with client disconnect. This report is based on actual rendered DOM geometry and source correlation, **not a completed screenshot-based visual review**.
- Agent and root attempted resize320; calls timed out/disconnected, reopening retained390px. No320px coverage claimed.
- Browser uses desktop engine/user-agent at phone-size viewport. Real iOS keyboard, safe areas, browser chrome and touch gestures not checked.
- No image uploads, OAuth linking, destructive actions, submission sends, or final-form saves performed. Seeded data is synthetic, not production content.
- Header ellipses and intentionally scrollable tables not automatically classified as broken views.
