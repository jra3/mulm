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
| `state.ts` | The six stored states, derived in one place, and the waiting-period clock. |
| `table.ts` | The transition table: which moves are legal from which states, and for whom. |
| `transitions.ts` | One exported function per move. |
| `queues.ts` | Queue membership, one definition per queue, as SQL and as a predicate. |
| `consequences.ts` | Who gets told what. The module's own seam; tests swap it for a recorder. |
| `standing.ts` | Level and Specialty Award recompute, symmetric in both directions. |
| `reminders.ts` | The clock's consequence: who is due a nudge, and what they are told. |
| `digest.ts` | What is still waiting on the committee, per Program. |
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
Return to Draft - voids a confirmed Witness, clears the approval queue entry,
and leaves the Submission in Pending Witness, back in the witness queue. There
is no field list and no diff: saving is the edit. Committee moves, including a
Points correction to an Approved Submission, never touch the Witness.

## Things that are deliberately not here

The machine keeps no prose state diagram: an ASCII diagram in a markdown file
is the artifact that rotted for eight months. `table.ts` is the picture.

Zod form mapping, species-name resolution, image upload, the Points formula,
Program rules and the Level ladder all stay outside. The module takes values
already validated and resolved, and calls the Level and Specialty Award modules
as consequences rather than absorbing them.

`approve` takes the Species the committee chose as an id, refuses one the
Species catalogue does not know, and binds the Submission to it. It never
adds Names to the Species: the member's spellings stay on the Submission.

`bindSpecies` is the witness's move: the committee binds or rebinds a
Submission to a Species anywhere between submission and approval, never on
its own Submission, and it goes on the changelog. It is not a member edit, so
it leaves a confirmed Witness in place. `confirmWitness` refuses an unbound
Submission with an `UnboundError`, so nothing enters the waiting period
without a Species.
