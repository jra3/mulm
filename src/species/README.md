# The Species catalogue

One module owns **Species identity, Names, the Canonical name, Program class,
Species type, Point class and the CARES flag**. Admin routes, the approval
handler, the lifecycle module, MCP tools, backfill and the IUCN and
external-data modules ask it about a Species. It is the only writer of the
species tables, and no other module in `src/` names them in SQL.

Spec: [#404](https://github.com/jra3/mulm/issues/404). Vocabulary:
`CONTEXT.md` (Species, Name, Canonical name, Bound, Program class, Point
class). Decisions: `docs/adr/0002-canonical-name-is-a-flagged-name-row.md`
(and `0001` for the Witness, which the binding work leans on).

## The interface is `index.ts`

Callers import from `@/species` (the MCP cores, which use relative imports
throughout, import `../species`) and nothing else. The files behind it are
the module's own business.

## What's where

| File | What it holds |
|---|---|
| `index.ts` | The interface. Start here. |
| `types.ts` | `Species` (the identity row), `Name` (with `canonical`, true for the one flagged scientific Name) and `NameKind` (`common` \| `scientific`), `SpeciesNames` (Names by kind), `canonicalName()`, the Species types. |
| `pointClass.ts` | `PointClass`, typed from the Points tally keys in `src/programs.ts` (5, 10, 15, 20); `isPointClass` for forms, `admitPointClass` to refuse anything else. |
| `errors.ts` | `CatalogueRefusal`, the one error the catalogue's rules throw, with a `code` callers match on (`not_found`, `invalid`, `duplicate`, `referenced`, `point_class`, `canonical`). Routes map it to a 4xx by code. |
| `lookup.ts` | `findSpeciesById`, `findSpeciesByIds`, and `resolveSpecies`: a pair of spellings to one Species (Latin as a scientific Name, the Canonical name among them, then common as a common Name). Imports bind by it. |
| `names.ts` | Names by kind: `listNames`, `findNames` (by text across Species), `addName`, `updateName` (in place, id kept), `removeName` (one id or several). `updateName` and `removeName` refuse the Canonical name. `nameTable` maps a kind to its table for the module's own SQL. |
| `curation.ts` | `createSpecies`, `updateSpecies` (Program class, Species type, Point class, CARES), `setPointClass` (bulk), `renameCanonical`, `previewMerge`, `mergeSpecies`, `deleteSpecies`. Create, rename and merge keep the Canonical flag and its cache. |
| `agreement.ts` | `checkFormAgreement`: does a Submission's form (spellings, Species type, Program class) agree with a Species. The lifecycle's member saves read `agrees` to keep or clear a binding; the confirmWitness guard and the witness panel read `classificationAgrees`. |
| `submissions.ts` | The Species-Submission relation, defined once as SQL (`speciesIdOfSubmissionSql`: the Submission's `species_id`); `countSubmissionsOfSpecies`. |
| `sql.ts` | SQL fragments for other modules' queries: `speciesOfSubmissionJoinSql`, `programClassOfSubmissionSql`, `speciesJoinSql`, `speciesFromSql`, `anyNameSql`. |
| `status.ts` | Writers for columns other modules own the meaning of: `updateIucnStatus`, `updateLastExternalSync`. |
| `listings.ts` | Read models: `searchSpeciesTypeahead`, `getSpeciesForExplorer` + `getExplorerFilterOptions`, `getSpeciesForAdmin`, `getSpeciesDetail` (with Names by kind, references, images), `getBreedersForSpecies`, `listSpeciesDueIucnSync`, `getSpeciesStatistics`. |

## Reading a Species from another module's query

Nothing outside `src/species/` names the species tables in SQL;
`src/__tests__/species-tables-catalogue-only.test.ts` fails if anything does.
A query elsewhere that needs a Species' columns composes the fragments in
`sql.ts`, the way queries compose `totalPointsSql` from `src/points.ts`:

- `speciesOfSubmissionJoinSql("s", "sng")`: the Species a Submission is
  bound to, LEFT JOINed as `sng`. Submissions, members, specialty awards
  (which read the Program class from it).
- `speciesJoinSql("c.group_id", "sng", { required })`: a Species by id.
  Collection, CARES.
- `speciesFromSql("sng")`: the table in a FROM clause. CARES coverage, IUCN
  and external-sync reads.
- `programClassOfSubmissionSql("s", "sng")`: the bound Species' Program
  class, or the member's entry for an unbound Submission. Specialty awards
  and their progress page.
- `anyNameSql("common", "c.group_id")`: one Name of a kind, or NULL.

When the tables change, these change and every query follows. Writes never go
through fragments: they go through a catalogue function.

## Rules it holds

- **The Canonical name** is one of the Species' scientific Names, flagged
  `is_canonical` (ADR-0002). A partial unique index allows at most one flagged
  Name per Species; the catalogue keeps at least one: create adds it, rename
  moves it, merge keeps the winner's. `canonical_genus` /
  `canonical_species_name` on the Species row cache its text and are written
  only here, in the same transaction as the flag. `updateName` and
  `removeName` refuse the flagged Name (code `canonical`): it changes only by
  `renameCanonical`, which knows the genus/epithet split and keeps the old
  name, where a Name edit would do neither.
- **Point class** is 5, 10, 15, 20 or unset, on create, update and bulk set.
  Forms (`src/forms/pointClass.ts`) check first for a friendlier message; the
  catalogue refuses regardless.
- **Rename** moves the flag to the new name - a scientific Name the Species
  already has (any case; its spelling is corrected), or a new one - and leaves
  the previous Canonical name as an unflagged scientific Name, never a common
  Name. A change of case only is a spelling fix and keeps nothing. The admin
  edit form, MCP `update_canonical_name` and IUCN recommendation accept all
  call `renameCanonical`; accept passes `alongside` to mark the recommendation in
  the same transaction.
- **Merge** moves every Name of the loser to the winner, deduplicated without
  regard to case. The winner keeps its flag; the loser's Canonical name comes
  along as an unflagged scientific Name. The loser's Submissions are rebound
  to the winner, so approved Submissions and their Points are untouched.
  `previewMerge` reports the same plan without writing.
- **Delete** is refused while any Submission, in any state, references the
  Species. There is no force: merge is the way out.
- **Names** are never invented. The typeahead gives a common Name the
  Canonical name as its scientific spelling, and a scientific Name the
  Species' first common Name or nothing.
- **A Submission's spellings become Names only at the Witness**, when the
  witness ticks them on the witness panel (`confirmWitness` in
  `src/lifecycle`, which calls `addName`). Every other `addName` caller adds
  text a curator typed: the admin Species edit page and MCP
  `add_species_name`.

## The schema today, and what changes next

- **Canonical name** is the flagged scientific Name (migration 057,
  ADR-0002), with `canonical_genus` / `canonical_species_name` as its cache on
  `species_name_group`. Read models read the cache; lookup, typeahead, admin
  search and form agreement find it as a scientific Name, with no separate
  canonical step. Import-only scripts that insert a Species directly must
  insert its flagged Name too (`scripts/setup-e2e-db.ts` does).
- **Submissions are bound to their Species** by `submissions.species_id`
  (migration 058, backfilled from the old Name foreign keys, which 059
  dropped). Approval binds by id and adds no Names; the member's spellings
  stay on the Submission as submitted. A Submission approved before binding
  existed may be unbound (`species_id` NULL).
- **`group_id`** is the Species' id under its column name. Read models,
  routes, views, forms and MCP arguments all say `group_id`; it is renamed
  when the column is, not before.
- **Collection and CARES** join a Species by `group_id` through the
  fragments; their own behaviour is out of this module's scope.

## Things that are deliberately not here

- External references and images: `src/db/speciesEnrichment.ts`. #404 keeps
  enrichment in its own modules; the detail read model reads it, the admin
  edit route and the external-data sync write it.
- IUCN status logic and sync: `src/db/iucn.ts`, `src/integrations/iucn.ts`.
  The catalogue writes the IUCN columns (`status.ts`) and lists who is due a
  sync; it decides nothing about them.
- The CARES registry: `src/db/cares.ts`. The catalogue knows the CARES flag
  on a Species, nothing more.
- Moving Submissions: `src/lifecycle/`. The catalogue says which Species a
  Submission references and whether a form agrees with one; the lifecycle
  decides what happens to the Submission.
- Scripts under `scripts/` that write the species tables directly carry an
  "Import-only tooling" header saying why; they are outside `src/` and the
  grep test.
