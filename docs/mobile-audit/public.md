# Public mobile browser audit

Test environment: local seeded application at http://localhost:38573, never production. T3 collaborative browser tab_3, actual native CSS viewport 390x844. Pages with vertical scrollbar had clientWidth375; short pages clientWidth390. Browser keeps desktop UA. All findings below use actual served top-level pages; an early discarded iframe experiment supplied no findings.

## Confirmed issue: annual standings footer clips year navigation and makes whole page horizontally scroll [P2]

Reproduce: visit /annual/2025/fish at390px. The prior and following year navigation are both present alongside Breeder/Horticultural/Coral program buttons.

Measured: document.documentElement.clientWidth390; scrollWidth401; window can scroll horizontally11.05px. Prior-year link '←2024' starts x=-10.86px and ends28.83px; next-year '2026→' begins361.33px and ends400.86px. Left part cannot be recovered by normal nonnegative page scrolling. Current2026 with only previous-year navigation fitted390px.

Cause: src/views/standings.pug:35 uses .container.mx-auto.flex.justify-center.items-center.space-x-4 with no wrap or narrow-screen stacking; year links added at37–38 and47–48 push centered row beyond both edges. Expected: responsive rows or wrap with gap, keeping year links and all program buttons within viewport. Applies any middle year/program with both links.

Screenshot unavailable: repeated native preview_snapshot text-only and image attempts returned PreviewAutomationExecutionError / NoAvailableHost despite working navigate/evaluate. Browser DOM measurement is confirmed; no screenshot claimed.

## Intentional exception / product-scope note: meeting slideshow

/live and /live/demo measured document scrollWidth805 vs clientWidth375 at390 viewport. Header site name extends to x805 and breeder/points to x753. This page is explicitly the large meeting display, so do not classify as normal mobile regression unless the user intends this page to be phone usable. Source src/views/display.pug header and src/views/partials/display-feed.pug:24,32 use nonwrapping rows with text-4xl/5xl/6xl and shrink-0. Test domain was localhost:4200 from config; actual site domain changes exact width.

## Coverage without whole-page horizontal overflow at tested width

- / home logged out (scrollWidth/clientWidth375/375).
- /annual/2026/fish and /annual/2026/plant (390/390). /annual/2025/fish failed as above.
- /lifetime/fish, /lifetime/plant, /lifetime/coral (390/390), populated member Alexandra Montgomery.
- /species (375/375): large721px table correctly lives in its own overflow-x-auto container. This is contained table scrolling, not document overflow. Filters and top-level layout within viewport.
- /species/1 through /species/8: known names and empty breeders (375/375).
- /species/1352 Cryptocoryne wendtii:16 long common-name variations plus approved report and breeder (375/375).
- /species/1724 Poecilia reticulata and /species/1726 Acropora millepora: populated breeder/report details (375/375).
- /member/1 public profile (375/375), collection callout and fish/plant/coral approved-report tables. Tables are correctly contained scroll regions, though many columns still require horizontal table interaction.
- /member/1/collection public collection (390/390): two visible cards, long species name and notes within width. Seed count3 includes private entry, only2 visible; not evaluated as mobile issue.
- /activity (390/390), empty state only.
- Mobile menu opened/closed successfully through actual DOM click after focused preview_click failed to trigger event. Menu links stayed x103–359 inside375px content.
- Login then signup dialogs activated through actual button/link click and HTMX. Document375/375, inputs x49.84–324.89. No form submitted, no account state changed.
- /auth/forgot-password without token redirects home; no valid reset token flow available.
- /cares returns404 because feature gate disabled for public; no layout coverage.

## Limitations

Native resizing from this sub-agent timed out even after preview_open; root established shared tab_3 at390. No320/375/landscape crosscheck claimed. Screenshots failed; cannot honestly claim visual pixel inspection beyond browser rendered DOM/layout measurements. No real iOS Safari/Android device keyboard/touch simulation. OAuth providers disabled locally, so branded sign-in image flow not covered. No production datasets or external-reference species metadata in seeded record; URL min-content risk in species detail remains source suspicion only, not a finding. Specialty-award populated profile states and nonempty recent activity not present in this public seed. No source files edited.
