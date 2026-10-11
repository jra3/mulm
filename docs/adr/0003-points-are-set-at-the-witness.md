---
status: accepted
date: 2026-10-10
---

# Points are set at the Witness; approval records presentation

Until now a Submission's points were entered at approval: the approval panel took the base points and every bonus, and the member first learned their points when they were awarded. #498 (October 2026) moved the judgement to the Witness. The witness, who is looking at the fish, settles the Species, sets the base points (prefilled from the Point class) and every bonus but first-time, in the one transaction that confirms the Witness. Approval becomes the record that the member brought the fry, plants or coral to a meeting: it computes first-time, awards the total, and involves no judgement beyond the second tap.

## Considered options

- **Keep points at approval, show the member a projection earlier.** Rejected: the projection would be a second copy of the rule, and the committee member at the meeting still has to make the call with the fish long gone.
- **A proposal table, copied onto the Submission at approval.** Rejected: an extra table and a copy step for a value that already has columns. The existing columns hold the points from the Witness on; `approved_on IS NOT NULL` stays the one gate on totals, which every total-reporting query already filters on.
- **Set the points at the Witness, on the Submission's own columns.** Chosen.

## Consequences

- `confirmWitness` takes the Species, the base points and the bonuses, validated per Program by a Zod schema (CARES on BAP only, flowered and sexual reproduction on HAP only, base points 5/10/15/20), and writes them with the Witness in one transaction. It binds or rebinds to the Species the witness settled on and gives the Submission the Species' type, class and Program where they disagree, so a mismatch is no longer a refusal; the `MismatchError` is gone.
- A Species with no Point class takes the chosen base points as its Point class, always. The witness assigns points for an unlisted Species on the spot; the manual's majority vote is not modelled.
- `first_time_species` stays NULL until approval, which computes it.
- A member's save that voids the Witness (ADR-0001) clears the points it set. The next witness starts from the catalogue's prefill.
- Points set at the Witness count toward nothing until approval. The invariants: an unapproved row with points is always witnessed; first-time is NULL on every unapproved row.
- Submissions witnessed under the old flow carry no points and are re-witnessed; there is no legacy approval path. The reset migration discards those old Witnesses, which is what makes this decision hard to reverse.
- This supersedes ADR-0001's 2026-09-28 amendment: once the reset has run, no Submission is unbound past its Witness, because the Witness cannot be confirmed without settling the Species. After the Witness, the Species changes only together with the points, through a correction.
- The member learns the points when witnessed, while there is still time to dispute them, and sees them as "pending approval" until the meeting.
