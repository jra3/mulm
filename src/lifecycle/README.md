# The Submission lifecycle

One module owns **when a Submission may change state, who may change it, and
what follows**. Every transition goes through it, every guard is stated once,
and every consequence hangs off the transition that causes it rather than off
whichever route handler happens to perform the write.

Spec: [#398](https://github.com/jra3/mulm/issues/398).

## The interface is `index.ts`

Callers import from `@/lifecycle` and nothing else. The transition definitions,
the state derivation, the queue predicates and the consequence sink are the
module's own business — and its own tests' seams.

`src/db/submissions.ts` is row access: queries, the raw updater, the mapper. It
is not where the rules live — its queue queries *compose* `queueSql` and
`filterQueue` from here, the same way they already compose `totalPointsSql`
from `src/points.ts`. One definition, many queries.

## What's where

| File | What it holds |
|---|---|
| `index.ts` | The interface. Start here. |
| `state.ts` | The five stored states, derived in one place, and the waiting-period clock. |
| `table.ts` | The transition table: which moves are legal from which states, and for whom. |
| `transitions.ts` | One exported function per move. |
| `queues.ts` | Queue membership, one definition per queue, as SQL and as a predicate. |
| `consequences.ts` | Who gets told what. The module's own seam; tests swap it for a recorder. |
| `standing.ts` | Level and Specialty Award recompute, symmetric in both directions. |
| `reminders.ts` | The clock's consequence: who is due a nudge, and what they are told. |
| `digest.ts` | What is still waiting on the committee, per Program. |
| `rewitness.ts` | The reset of in-flight Submissions (#524): the original witness read off the reset note, and the one-off letter to their members. |
| `errors.ts` | The refusal taxonomy: the wrong person, or the wrong moment. |

## Adding a move

1. Add it to `MoveId` and `moves` in `table.ts`, with the states it is legal
   from and the actors who may perform it. The compiler will tell you if you
   have missed a refusal message.
2. Add one exported function in `transitions.ts` following the shape the file
   documents: read, guard, conditional write, then consequences after commit.
3. Export it from `index.ts`.
4. Add its row to the consequence matrix if it tells anyone anything, and give
   the negative rows a test too — that an edit sends nothing is as much of a
   decision as that an approval sends something.

## A member's save voids the Witness

A Witness attests to the fry and to the form
([ADR-0001](../../docs/adr/0001-witness-attests-to-the-form.md)). Every member
save of a submitted Submission - Save Changes, Resubmit, and Submit after
Return to Draft - voids a confirmed Witness, clears the points the Witness set
([ADR-0003](../../docs/adr/0003-points-are-set-at-the-witness.md)), and leaves
the Submission in Pending Witness, back in the witness queue. Its place in
the approval queue goes with the Witness, since the queue is derived from it.
There is no field list and no diff: saving is the edit. Committee moves,
including a Points correction to an Approved Submission, never touch the
Witness.

## The member does nothing to enter the approval queue

A witnessed Submission is in the approval queue the day its waiting period
ends (`deriveState`): confirmed and the clock has run. There is no move for
it and no column; the old "brought it to a meeting" step, its
`enterApprovalQueue` and `removeFromQueue` moves and its `final_submission_on`
column are gone (the column is dead, documented on the `Submission` type and
never dropped). The member brings the fry, plants or coral to a meeting and a
committee member approves it there. `reminders.ts` tells them once, the day
the clock runs out, selecting from the approval queue and keyed off
`final_submission_reminder_sent_on`, which is never cleared. The digest does
not report the approval queue: its rows wait on the member coming to a
meeting, not on the committee.

## The Witness sets the points

`confirmWitness` takes the Species the witness settled on, the base points
(one of the Point classes) and every bonus but first-time, which `approve`
computes. In one transaction it rebinds the Submission to that Species if it
is bound elsewhere, gives it the Species' type, class and Program where they
disagree (both on the changelog, as "Settled at the Witness"), writes the
points fields, confirms the Witness, values the Species if the catalogue had
not (the chosen base points become its Point class, with no opt-out), and
adds the chosen spellings as Names. A refused confirmation does none of it.
The bonuses are judged against the Species' Program, the one the Submission
is about to have, not the one the member filed under (`bonusesOutsideProgram`
in src/points.ts, the same rule the form's schema applies): a plant Submission
the witness settles on a Fish Species cannot carry a flowered bonus. The
points count for nothing until approval: every total-reporting query filters
on `approved_on`. The owner sees them meanwhile as "pending approval", on
their own Submission page and submissions list and nowhere else
(`pendingPoints` in src/routes/submission.ts, over `pointsBreakdown` in
src/points.ts, the same itemised sum the witness panel's bar prints).

When the catalogue has no Species for what the member bred, the witness
records one on the panel (#522): `WitnessPoints.new_species` carries its
names, Point class and CARES flag in place of a `species_id`, and
`confirmWitness` creates it (`createSpeciesOn`, on the transaction's
connection), with the Submission's type and class, before settling on it.
It is the same transaction, so a refusal anywhere, a bonus outside the
Program, changes outstanding, the witness's own Submission, a Canonical name
another Species holds, rolls the Species back with everything else; the
panel's Record species and continue step writes nothing on its own. The
"Settled at the Witness" entry then carries a `new_species` change, which is
how the approval queue knows to say "New species recorded by the witness"
(`speciesRecordedByWitness` in src/routes/submission.ts for one Submission,
`findSubmissionsWithRecordedSpecies` in src/db/submission_notes.ts for a
page of them). A recorded Species gets no spellings added as Names: its
names are the ones the witness gave it.

## In-flight Submissions went back for a Witness

Points are set at the Witness now, and a Submission witnessed before that
carried none, so migration 066 (db/migrations/066-reset-pointless-witnesses.sql)
sent every witnessed, unapproved, pointless row back to awaiting a Witness
(#524): status pending, the witness fields and the dead `final_submission_on`
cleared, as `voidWitness` clears them. Nobody performed that move, so it is
not in the table; what follows it is in `rewitness.ts`. Each reset row
carries a plain-text changelog note attributed to its original witness,
"Witness reset when points moved to the Witness; originally witnessed by X
on D", and the witness panel's header reads it (`originalWitnessFromNotes`)
so the re-witnesser knows the fry were seen: no fresh sighting, just the
Species and the points, by any committee member but the submitter. The clock
counts from the reproduction date, so nothing restarts; a reset row whose
waiting period had run is in the approval queue the moment it is
re-witnessed. The one-off script `src/scripts/email-rewitness.ts` (under
src/ so the build compiles it into the image; its header has the `fly ssh
console` command) runs `sendRewitnessEmails` once after the deploy: one
letter per affected member,
listing their reset Submissions still awaiting a Witness, recorded per
member in `settings` (`rewitness_emailed:<id>`) only once delivered, so it
is safe to run twice. After the migration no witnessed, unapproved row lacks
points (`assertNoWitnessedRowLacksPoints` in the test helpers).

## Things that are deliberately not here

The machine keeps no prose state diagram: an ASCII diagram in a markdown file
is the artifact that rotted for eight months. `table.ts` is the picture.

Zod form mapping, species-name resolution, image upload, the Points formula,
Program rules and the Level ladder all stay outside. The module takes values
already validated and resolved, and calls the Level and Specialty Award modules
as consequences rather than absorbing them.

`approve` is about Points: it takes no Species, uses the one the Submission
is bound to, and is refused on an unbound Submission (`requiresBound`, an
`UnboundError`). There is no binding at approval; an unbound Submission past
its Witness is fixed by hand. It never adds Names to the Species.

`bindSpecies` is the witness's move: the committee binds or rebinds a
Submission to a Species anywhere between submission and approval, never on
its own Submission and not while changes are requested (the ball is with the
member), and it goes on the changelog. It is not a member edit, so
it leaves a confirmed Witness in place. `confirmWitness` binds too, to the
Species it is handed; it refuses a Submission bound to no Species that it is
handed none for with an `UnboundError`, so nothing enters the waiting period
without a Species.

A binding holds only while the form agrees with the Species (CONTEXT.md,
Bound): every member save (Save Draft, Submit, Save Changes, Resubmit) asks
the catalogue's `checkFormAgreement` and clears `species_id` when the saved
spellings, Species type or Program class no longer agree. Committee moves
never unbind.

The member binds by picking a Name in the form's typeahead, which posts
that Species' id as `species_id`. Every member save, `createSubmission`
included, treats it as a claim: kept only if the Species exists and the form
agrees with it, otherwise the Submission is saved unbound (a forged or stale
id is not an error). With no pick, an existing binding is kept only while the
form agrees. Clearing the typeahead is not itself an unbind; a form that no
longer agrees is. `formToRow` never writes `species_id`: the binding is the
lifecycle's to decide (`bindingAfterSave`).

`confirmWitness` is never refused for a Species type or Program class that
disagrees with the Species': the witness answered that this is the Species,
so the confirm gives the Submission the Species' type, class and Program, on
the changelog (a spelling that is not a Name changes nothing). After the
Witness the same answer is `adoptSpeciesClassification` - Witness untouched;
a queued Submission whose adopted classification asks a longer waiting period
is simply in its waiting period again, with nothing else written, and the
clock returns it.

`confirmWitness` also takes the witness's choice of the Submission's own
spellings to add to the bound Species as Names (`NamesToAdd`; the panel
offers the common spelling ticked and the Latin one unticked). They are added
through the catalogue's `addName` in the confirm's transaction, after the
guards, so a refused confirmation adds nothing; a spelling that is blank or
already a Name (as `checkFormAgreement` decides) is never added. This is the
only path by which a Submission's spellings become Names.
