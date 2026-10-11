# BAS Awards Portal

The domain of mulm: the **Portal**, a single-society web app for the **Brooklyn Aquarium Society (BAS)**. Members submit fish-breeding, plant-propagation, and coral-propagation achievements; a committee witnesses and approves them; the Portal tallies cumulative points into levels and awards, and separately runs a **CARES** conservation registry.

> **Read this first — sources of truth.**
> - **mulm is BAS-specific and single-tenant.** There is one society. Multi-tenancy / per-society configurability is an **explicit non-goal** — there is no `society_id`/tenant column, and program rules are hard-coded constants in `src/programs.ts`. Don't design for "other societies."
> - **The manual (`manual/manual.md`) is a 2009 artifact.** It is BAS's authoritative statement of the *program rules*, but the app has evolved past it (the CARES registry, the coral program, the bonus-point mechanics, etc.).
> - **Where the manual and the code diverge, the CODE is the source of truth.** Read such differences as "the manual is stale," not "the app is wrong." Rule vocabulary below cites the code where a concept is implemented rather than restating the manual.

## Language

### Programs

**Portal**:
The BAS awards web app itself (this project, mulm). The thing members log into to submit achievements and view standings.
_Avoid_: BAP platform, BAP management platform, the site, the app (in domain prose)

**Program**:
One of the three achievement tracks, each with its own point-value list and level ladder. Internal (code) enum: `fish` | `plant` | `coral` (`src/programs.ts`, `ProgramType`). Member-facing names come from `programMetadata` / notification copy: **BAP**, **HAP**, **CAP** respectively.
_Avoid_: category, track, award (when you mean the enum)

**BAP** (Breeder Awards Program):
The **fish** (breeding) program — points for spawning fish. One canonical meaning: BAP is the fish program, not the platform (member-facing email names it "Breeder Awards Program (BAP)", `src/notifications.ts`). Surfaces to members as **"Fish/Inverts"** — invertebrates are included in this program (`src/views/index.pug`, `src/views/email/invite.pug`).
_Avoid_: the platform, breeding program, fish program (member-facing)

**HAP** (Horticultural Award Program):
The **plant** program — points for growing and propagating aquatic plants. Code enum `plant`.
_Avoid_: plant program, horticulture (member-facing)

**CAP** (Coral Award Program):
The **coral** program — points for growing and propagating marine corals. Code enum `coral`. Has a **shorter level ladder** than BAP/HAP (see _Level_).
_Avoid_: Coral Award Program spelled out (use CAP), coral program (member-facing)

**Specialty Species Program**:
Recognition for breeding a required number of distinct species within a defined group (e.g. 6 Anabantoids, 12 New World Cichlids). Implemented as Specialty Awards / meta-awards. Source of truth: `src/specialtyAwards.ts`, `src/specialtyAwardManager.ts`. (Not to be confused with the manual's unimplemented "Maintaining Species Program" — see Open questions.)
_Avoid_: species group award, specialist program

### Points & levels

**Point class**:
The difficulty value assigned to a species: 5, 10, 15, or 20 points (5 = breeds freely, e.g. guppy; 20 = rarely bred / all marine species). Enforced as the `PointsTally` keys `5|10|15|20` in `src/programs.ts` (any other value throws).
_Avoid_: point value, tier, difficulty (when you mean the 5/10/15/20 bucket)

**Base points**:
The point-class value a submission earns before bonuses — the `points` column on a submission.
_Avoid_: raw points, species points

**Bonus points**:
Extras added on top of base points, stored on the submission. The witness sets every one of them except first-time when confirming the Witness (`src/forms/confirmWitness.ts`; [ADR-0003](docs/adr/0003-points-are-set-at-the-witness.md)); first-time is approval's to compute. The one rule for turning a submission's flags into a total lives in `src/points.ts`, which exports it both as a SQL fragment (composed into every query that reports a total) and as a TypeScript function (used for the itemised breakdown, the witness panel's running sum, and tests):
`total_points = points + article_points + first_time_species×5 + cares_species×5 + flowered×points + sexual_reproduction×points`
So: first-time species = flat +5; `article_points` = None, 5 or 10 at the Witness (starts at 5 when the member linked an article); CARES-listed species = +5, prefilled from the catalogue; and flowering / sexual reproduction each add the plant's own point value. (The manual's "+10 for a first-time spawn with an article" is realized here as first-time +5 plus article_points.)
Which bonuses a Program may carry (ruled 2026-09-17; enforced in the witness and approved-edit Zod schemas, which take the Program; approval takes no bonuses):
- first-time species, article: **all Programs**
- CARES: **BAP only**
- flowered, sexual reproduction: **HAP only**
The formula itself is uniform across Programs; the restriction is an invariant on write, not a condition in the sum. Points set at the Witness count toward nothing until approval: every total-reporting query filters on `approved_on`, never on `points` being set.
_Avoid_: extra credit, adjustments

**Points**:
A member's cumulative `total_points`, per program, from approved submissions. Cumulative over an indefinite period; never expires; changes to a species' value are not applied retroactively.
_Avoid_: score, credits

**Pending approval**:
The member-facing name for points a witness has set that the committee has not yet awarded. The Submission's owner, and only the owner, sees them on their own Submission page and their own submissions list, itemised the way the witness email puts them: base points, then each bonus that is set, adding up to the total (`pointsBreakdown` in `src/points.ts`; `pendingPoints` in `src/routes/submission.ts` decides who gets them). Nowhere else: a public Submission page does not exist before approval, a member's profile seen by anyone else lists an unapproved row as unapproved whatever its columns hold, the profile's totals and the standings sum awarded points alone, and the committee reads the points on its own panels. First-time is not among them, since approval computes it.
_Avoid_: provisional points, projected points, estimated points, unapproved points

**Level**:
The earned title a member holds in a program once their points (and per-class distribution rules) cross a threshold. Each program has its own ordered ladder in `levelRules` (`src/programs.ts`); computed by `calculateLevel`, applied by `src/levelManager.ts`, stored as `fish_level`/`plant_level`/`coral_level` on the member.
Ladder lengths differ (confirmed against `levelRules`): **BAP/fish** → Participant … Grand Poobah Yoda Breeder (4000 pts); **HAP/plant** → … Senior Premier Aquatic Horticulturist (2000 pts); **CAP/coral** is shortest → tops out at **Senior Grand Master Coral Propagator (1000 pts)** and has no per-class distribution rules.
_Avoid_: title, rank, tier, badge

**Standings**:
The Portal's public, cumulative view of members ranked by points/levels within a program. Source of truth: `src/routes/standings.ts`.
_Avoid_: leaderboard, rankings, results

### Submissions & lifecycle

**Submission**:
A member's single claim of a breeding/propagation achievement for one species, moving through a state machine to approval and points. The row is the `Submission` record in `src/db/submissions.ts`; **when it may change state, who may change it and what follows is owned by `src/lifecycle/`**, whose transition table (`src/lifecycle/table.ts`) is the one statement of which moves are legal from which states. Spec: [#398](https://github.com/jra3/mulm/issues/398).
_Avoid_: entry, claim, report, spawn record (when you mean the DB row)

**Spawn**:
A qualifying reproduction event: for fish, a minimum of six (6) fry maintained for the waiting period (plants/corals: a cutting showing reasonable growth).
_Avoid_: breeding, birth, propagation (use _propagation_ specifically for plants/corals)

**Waiting period**:
The minimum age (from `reproduction_date`) a witnessed submission must reach before it is in the approval queue: **30 days for marine fish, 60 days otherwise** (`src/lifecycle/state.ts`). This is the one edge the lifecycle module computes rather than performs: the two states either side of it are stored identically and separated only by a date comparison. The member does nothing to cross it: the day the clock runs out the submission is in the approval queue, a reminder tells them so, and they bring the fry, plants or coral to a meeting where a committee member approves it. The old "brought it to a meeting" step and its `final_submission_on` column are **dead**: nothing reads or writes the column, and it is documented as dead on the `Submission` type rather than dropped, as with the denied columns.
_Avoid_: holding period, cooldown, final submission

**Witness (Gate 1 — physical verification)**:
A committee member's attestation that the fry (or cutting) exist and that the Submission describes them and the breeding situation correctly, including which Species it is, **and the setting of its points**: the witness settles the Species (which sets the base points from its Point class; a Species the catalogue lacks is recorded there and then, in the Witness's transaction), may change the base points, and sets every bonus but first-time ([ADR-0003](docs/adr/0003-points-are-set-at-the-witness.md)). Carried on the submission as `witnessed_by` / `witnessed_on`, `witness_verification_status: pending | confirmed`, and the points columns. A member cannot witness their own submission, and no Witness may be confirmed while requested changes are outstanding or without a Species; a Species type or Program class that disagrees with the Species' is not a refusal, since confirming records the Species' values on the Submission. Confirming sends the member one email, the witness email (`onWitnessConfirmed`, `src/notifications.ts`; `src/views/email/onWitnessConfirmed.pug`): who witnessed it and when, the points itemised over the one Points rule and marked pending approval, the bonuses still possible after approval (an article not yet written; on HAP, flowering or sexual reproduction not yet seen), a first-time line when no approved Submission of the Species exists at the Witness (never added to the total), the day the waiting period ends, and how to dispute the points, which for now is a reply: Reply-To is the committee's address (`config.email.adminsEmail`). It replaced the "Screening Approved" and "Witness Confirmed" letters. Because the Witness attests to the form, **any change the member makes after confirmation voids it and clears the points it set**; the Submission awaits a Witness again, the next witness starts from the catalogue's prefill, and a new witness email carries the new points. The form says so before saving.
Submissions witnessed before points moved to the Witness carried none, and there is no legacy approval path, so migration 066 sent every witnessed, unapproved, pointless row back to awaiting a Witness (#524). Each carries a changelog note naming its original witness and the day ("Witness reset when points moved to the Witness; originally witnessed by X on D"), which the witness panel's header shows: the fry were seen, so no fresh sighting is asked for, and any committee member but the submitter re-witnesses. The clock counts from the reproduction date as before, so nothing restarts. A one-off script (`src/scripts/email-rewitness.ts`, compiled into the image and run with `node` over `fly ssh console`) told each affected member once that nothing was wrong (`src/lifecycle/rewitness.ts`).
The `declined` value is **dead**: declining a Witness stranded the submission where nothing could move it out, and is deleted. A committee member who wants more **requests changes** instead. Rows still carrying `'declined'` derive as awaiting a Witness, which makes them actionable again.
_Avoid_: verify, screen (informal), confirm (that's one outcome), decline

**Approved (Gate 2 — presentation at a meeting)**:
The record that the member brought the fry, plants or coral to a monthly meeting, and the award of the points the Witness set: `approved_on` / `approved_by` set and `first_time_species` decided — only then do points count toward standings, and approving is the only way points are ever awarded. Approval is **one button** on the approval queue (`admin/queue.pug`, phone first, #527), with no form: the only judgement is the second tap. Inside its transaction `approve` (`src/lifecycle`) counts the Species' approved Submissions, so of two members bringing the same Species the first click wins the first-time +5, and it refuses, writing nothing, unless the total it would award equals the total the button showed (`expected_total`; a `StalePointsError` comes back as a sheet with the current total and a fresh Approve). It is refused unless the Submission is witnessed, past its waiting period, bound, carries points, has no changes outstanding and is not the approver's own. Then the approval email, the feed announcement and the standings recompute, as before. **Approved is terminal and undeletable for everyone**; correcting the Points (`src/lifecycle` `correctPoints`, with a stated reason that goes to the changelog) is the only movement out of it.
**Denied is deleted** — the state, the move, and the idea. Zero denials were ever recorded, and the 2009 manual contains no denial language; requesting changes is the refusal path. Its `denied_on` / `denied_by` / `denied_reason` columns are **dead but still present**: nothing reads or writes them, and they are documented as dead on the `Submission` type rather than dropped, so this change needs no migration to the submissions table.
_Avoid_: accepted/rejected, validated, confirmed (confirmed belongs to witnessing), denied

**Changes requested**:
The committee asking the member to edit and resubmit, with the problems stated (`changes_requested_*`). It is an **overlay over the state a submission is already in, not a state of its own**: the submission keeps its place in the pipeline, and resubmitting clears the flag without restarting anything (a witnessed Submission that the member edits awaits a Witness again, as after any edit). While the flag is set the ball is with the member — flagged work **leaves the committee's queues**, and no committee action but Delete is legal.
_Avoid_: revision, rework, denied

### Awards & recognition

**Award**:
A tangible recognition tied to a level or program milestone — certificate, plaque, or trophy.
_Avoid_: prize, reward, trophy (trophy is one kind of award)

**Breeder of the Year**:
The annual award to the member who bred the most fish, plants, and/or corals, weighted by the committee for generosity and support of the club. May be withheld if no one qualifies.
_Avoid_: BOTY, top breeder, champion

**Senior Specialist / Expert Specialist**:
Cross-group Specialty tiers: Senior Specialist for 4 species groups, Expert Specialist for 7 (invertebrate groups excluded from both). Modeled as meta-awards in `src/specialtyAwardManager.ts`.
_Avoid_: multi-specialist, super specialist

### People & governance

**Member**:
A person enrolled in BAS who submits achievements and holds points/levels. **Individuals only** — the model (`src/db/members.ts` `MemberRecord`; `db/schema.sql` `members`) has `display_name`, `contact_email`, `is_admin`, and per-program levels, with no family/household/joint account. (The manual's "points to families or individuals" option is **not implemented** — a manual-vs-app gap.)
_Avoid_: user, breeder, hobbyist, aquarist, account, household (these are roles/titles, not the model)

**Breeders Award Committee**:
The body — a chairperson plus an even number of members, appointed by the Board — that witnesses spawns, keeps records, assigns point values, and presents awards. In the Portal, committee actions are performed by members with `is_admin`.
_Avoid_: BAP committee, the committee (when ambiguous), admins (in domain prose)

**Claiming points**:
The member-side act of submitting and following through on a spawn/propagation so points are recorded. It is the breeder's responsibility to file and verify.
_Avoid_: requesting points, filing

**Assigning points**:
The committee-side act of setting a Point class for a Species the catalogue has not valued. In the Portal the witness does it on the spot: confirming the Witness on a Submission whose Species has no Point class saves the chosen base points as that Species' Point class, with no opt-out (`ensurePointClass`, `src/species/curation.ts`). A Species the catalogue lacks altogether is recorded by the witness on the panel, with its Point class and CARES flag, in the same transaction as the Witness (`createSpeciesOn`); abandoning the panel creates nothing. The manual's majority vote is not modelled.
_Avoid_: rating, scoring

**Challenging points**:
Reviewing and changing a species' point value; changes are publicized in the club journal _Aquatica_, take effect immediately, and are not retroactive.
_Avoid_: disputing, appealing

**BAP year**:
The program's annual cycle: starts in September, ends at the July Board meeting; July/August spawns are recognized in September.
_Avoid_: season, award year, fiscal year

### Species

**Species**:
The organism a Submission is about, as one identity that outlives its names: taxonomy moves fish between genera, so a Species is a stable id with a set of **Names** attached, one of which is its **Canonical name**. Color variations are not separate Species; a different Latin name is. Points may be earned only once per Species per Member. Source of truth: the Species catalogue, `src/species/` (`@/species`).
_Avoid_: fish, variety, breed, strain, species group, name group, group (when you mean the Species)

**Name**:
A handle a Species is known by, of kind common ("Kribensis") or scientific ("Pelvicachromis pulcher"). A Species has many; they accumulate as taxonomy and hobby usage change, and any of them finds the Species. Names are curated by the Breeders Award Committee: a spelling on a Submission is not a Name until the committee adds it.
_Avoid_: synonym, alias, variant, name pair

**Canonical name**:
The scientific Name the Portal treats as correct today (genus + epithet), shown wherever a Species is displayed. Exactly one per Species and always one of its scientific Names; it changes when taxonomy does, and the previous Canonical name remains a scientific Name.
_Avoid_: current name, valid name, accepted name, display name

**Bound**:
A Submission is bound when it has a Species. The member binds it by picking a Name at submit; the Breeders Award Committee binds or rebinds it at the witness step, where the witness panel asks "is that right?" of the member's pick, offers the catalogue's closest Species to what the member wrote ("Did they mean one of these?") when there is no pick or the pick was wrong, lets the witness record a Species the catalogue lacks, and confirming binds to whichever Species the witness settled on. A binding holds only while the Submission's spellings, Species type and Program class agree with the Species: saving a form that no longer agrees clears it. Only a bound Submission can be witnessed or approved, and base points are prefilled from the bound Species' Point class. The member's spellings stay on the Submission as "as submitted".
_Avoid_: linked, matched, resolved, assigned, proposed

**Program class**:
The group a Species belongs to within its Program, for Specialty awards and classification (e.g. Anabantoids, Cichlids, Killifish) — distinct from **Point class** and from **Species type**. Column `program_class` on the Species; the Submission's copy is still named `species_class` (`src/specialtyAwards.ts`).
_Avoid_: species class, category, group, family, class (a taxonomic rank, not this)

**Species type**:
Which kind of organism a species is — Fish, Invert, Plant or Coral — and so which Program a submission counts toward (Fish and Invert to BAP, Plant to HAP, Coral to CAP). Represented as `species_type`; the type-to-Program mapping lives in `src/points.ts` (`SpeciesType`, `isInProgram`). Coarser than **Program class**, which subdivides within a type.
_Avoid_: program class, species class, category, kind

## CARES

**CARES is a distinct conservation registry, not a points/awards program.** It runs alongside BAP/HAP/CAP with its own vocabulary and lifecycle. Members register at-risk species they *maintain* (keep alive) — as opposed to the breeding/propagation *achievements* the point programs reward. Source of truth: `src/db/cares.ts`, `src/views/cares.pug`. (Keep this separate from the level ladders. The one point of contact with the point system is the **+5 CARES bonus** a *breeding submission* of a CARES-listed species earns at approval — that bonus is not the registry.) The registry is still in development and only admins can see it; the gate is `canSeeCaresRegistry` in `src/caresRegistry.ts`.

**CARES**:
"Conservation, Awareness, Recognition, Encouragement, Support" — an international initiative (founded 2004) enlisting hobbyists to maintain populations of at-risk freshwater fish in home aquariums. BAS participates as a member club.
_Avoid_: conservation program, endangered-species program

**CARES registration**:
A member's record that they are maintaining a specific CARES-listed species (`cares_registration`, one per member and Species). Members register from a collection entry and provide a photo, but the registration belongs to the member and Species, not the entry: editing, removing or re-adding the entry leaves it in place.
_Avoid_: enrollment, sign-up, entry

**Annual re-confirmation**:
The yearly action a member takes to affirm they are still maintaining a registered species, keeping the registration active (`last_confirmed`, `years_confirmed`).
_Avoid_: renewal, annual review

**At-risk / priority species**:
A species on the official CARES priority list (maintained externally, on the CARES website). `is_cares_species` on the species-name-group marks these.
_Avoid_: endangered species (informal), listed species

**Participating (member) club**:
A society, like BAS, that participates in the international CARES program on behalf of its members.
_Avoid_: partner, affiliate

**Seal**:
A recognition a registration can earn for a level of contribution to preservation — photo, article, internal/external fry share, longevity (`has_photo`, `has_article`, `has_internal_share`, `has_external_share`, `is_longevity` in `src/db/cares.ts`).
_Avoid_: badge, medal, award (award belongs to the point programs)

**Fry share**:
A recorded transfer of fry from a maintained CARES species to another hobbyist or club, internal or external (`CaresFryShare`).
_Avoid_: donation, giveaway

## Open questions

Unresolved after code inspection — honest flags, not invented answers.

1. **"Maintaining Species Program" (undefined 2009-manual heading).** The manual titles a section "Specialty Species Program **& Maintaining Species Program**" but only ever describes the Specialty mechanic (breed N distinct species in a group); there is **no** "Maintaining Species" program in the code. Its intent most plausibly aligns with **CARES** (both are about *maintaining* species rather than breeding), but this is **unconfirmed** — recorded here as an undefined manual heading, deliberately **not** asserted as CARES and **not** merged into the CARES definitions above. Needs a human ruling.

2. **CARES bonus vs. CARES registry — intended relationship.** The code has two CARES touchpoints: the conservation *registry* (`src/db/cares.ts`) and a **+5 bonus** on a *breeding submission* of a CARES-listed species (`cares_species×5` in the `total_points` formula). They're independent in code (registering a species you maintain ≠ submitting a spawn of it). Confirm this is intended and that they shouldn't be linked (e.g. should a CARES bonus require an active registration?).

3. **Article-bonus ceiling.** `article_points` is a free committee-entered field capped at 50 (`src/forms/approvedEdit.ts`), whereas the manual describes fixed +5/+10 article bonuses. Confirm whether the open field is intended flexibility or should be constrained to the manual's values.
