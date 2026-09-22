---
status: accepted
date: 2026-09-22
---

# The Canonical name is a flagged scientific Name row, with cached columns on the Species

A Species is a stable id with many Names, and its Canonical name is the scientific Name treated as correct today; taxonomy moves fish between genera, so the Canonical name changes and the old one must remain findable. We decided the truth of "which Name is canonical" is an `is_canonical` flag on the scientific-name row, with a partial unique index guaranteeing one per Species, and that `canonical_genus` / `canonical_species_name` stay on the Species row as a cache written only by the Species catalogue.

## Considered options

- **Columns on the Species row only, with the catalogue guaranteeing a matching Name row exists.** Same invariant with the truth on the other side. Rejected because it keeps the Canonical name as something *above* the Names rather than one of them, which is what every rename and merge bug so far came from.
- **Flag only, no cached columns.** Cleaner on paper. Rejected because forty files read the canonical name off the Species row, every list and detail query wants it without a join, and the Name row holds one string whereas the cache is split into genus and epithet, which a naive split breaks on trinomials.
- **Flag plus cache.** Chosen. The read radius is zero and the write radius is one module.

## Consequences

- The catalogue is the only writer of the two cached columns. Anything else writing `species_name_group` is a bug.
- Rename and merge both add the previous Canonical name as a plain scientific Name if it is not already one, and never as a common Name.
