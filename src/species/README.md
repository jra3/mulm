# The Species catalogue

One module owns **Species identity, Names, the Canonical name, Program class,
Species type, Point class and the CARES flag**. Admin routes, the lifecycle
module, MCP tools, backfill and scripts ask it about a Species rather than
composing SQL against the species tables themselves.

Spec: [#404](https://github.com/jra3/mulm/issues/404). Vocabulary:
`CONTEXT.md` (Species, Name, Canonical name, Bound, Program class). Decisions:
`docs/adr/0002-canonical-name-is-a-flagged-name-row.md`.

## The interface is `index.ts`

Callers import from `@/species` and nothing else. The files behind it are the
module's own business.

## What's where

| File | What it holds |
|---|---|
| `index.ts` | The interface. Start here. |
| `types.ts` | What a Species and a Name are; the Name kinds; the Species types. |
| `pointClass.ts` | The Point class: typed from the Points tally keys (5, 10, 15, 20), refused otherwise. |
| `errors.ts` | `CatalogueRefusal`, the one error the catalogue's rules throw. |
| `lookup.ts` | Find a Species by id, by any Name, by Canonical name, or from a pair of spellings (`resolveSpecies`, the lookup imports bind by). |
| `names.ts` | A Species' Names by kind; find Names by text; add a Name, correct one in place, remove one or several of a given kind. `nameTable` maps a kind to its table, for the module's own SQL. |
| `curation.ts` | Create, classify, set Point class, rename the Canonical name, merge, delete. |
| `agreement.ts` | Does a Submission's form agree with a Species: spellings, Species type, Program class. |
| `submissions.ts` | The Species-Submission relation, defined once as SQL, and the Submissions of a Species. |
| `status.ts` | Writers for columns other modules own the meaning of: IUCN status, last external sync. |
| `sql.ts` | SQL fragments for modules that read a Species alongside their own tables. |
| `listings.ts` | Read models: typeahead, public explorer, admin list, detail page, breeders, statistics. |

## Reading a Species from another module's query

The catalogue is the only writer of the species tables, and nothing outside
it names them. A query in another module that needs a Species' columns
composes the fragments in `sql.ts` - `speciesOfSubmissionJoinSql` for the
Species a Submission references, `speciesJoinSql` for a Species by id,
`speciesFromSql`, `anyNameSql` - the way queries compose `totalPointsSql`.

## Rules it holds

- **Point class** is 5, 10, 15, 20 or unset, on create, update and bulk set.
  Forms may check first for a friendlier message; the catalogue refuses
  regardless.
- **Rename** keeps the previous Canonical name as a scientific Name of the
  Species if it is not one already. Never as a common Name. A change of case
  only is a spelling fix and keeps nothing.
- **Merge** moves every Name of the loser to the winner, deduplicated without
  regard to case, and keeps the loser's Canonical name as a scientific Name of
  the winner. The loser's Submissions follow their Names, so approved
  Submissions and their Points are untouched.
- **Delete** is refused while any Submission, in any state, references the
  Species. There is no force: merge is the way out.

## Things that are deliberately not here

- IUCN status, external references and images. They are enrichment with their
  own modules (`src/db/iucn.ts`, `src/db/speciesEnrichment.ts`); the catalogue
  decides nothing about them. It reads the IUCN columns to show them and to
  list which Species are due an IUCN sync, and it writes the IUCN status and
  last-external-sync columns on those modules' behalf (`status.ts`) so it
  stays the only writer of the Species row.
- The CARES registry. The catalogue knows the CARES flag on a Species, nothing
  more.
- Moving Submissions. The catalogue says which Submissions reference a Species
  and whether a form agrees with one; the lifecycle module decides what
  happens to a Submission.

## During the move

The catalogue is being expanded in front of the old species data module
(`src/db/species.ts`), which re-exports or delegates to it so callers can move
over one at a time. New code imports `@/species`. What the old module still
implements itself - paired-Name functions and its old per-kind Name editors
(`updateCommonName`, `updateScientificName`; the catalogue's is `updateName`) -
is not part of the catalogue, and its tests still import the old
module until it goes. The Canonical name is still
the two columns on the Species row; it becomes a flagged scientific Name
(ADR-0002) in a later step, and Submissions still reach their Species through
their two Name foreign keys until they carry a `species_id`.
`speciesIdOfSubmissionSql` is the one place that knows which.
