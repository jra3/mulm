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
Committee-entered extras added on top of base points at approval time (`src/forms/approval.ts`, `src/forms/approvedEdit.ts`), stored on the submission and summed in SQL as
`total_points = points + article_points + first_time_species×5 + cares_species×5 + flowered×points + sexual_reproduction×points`
(`src/db/submissions.ts`, `src/db/members.ts`). So: first-time species = flat +5; `article_points` = a committee-entered number (0–50, typically 5); CARES-listed species = +5; and HAP flowering / sexual reproduction each add the plant's own point value. (The manual's "+10 for a first-time spawn with an article" is realized here as first-time +5 plus article_points.)
_Avoid_: extra credit, adjustments

**Points**:
A member's cumulative `total_points`, per program, from approved submissions. Cumulative over an indefinite period; never expires; changes to a species' value are not applied retroactively.
_Avoid_: score, credits

**Level**:
The earned title a member holds in a program once their points (and per-class distribution rules) cross a threshold. Each program has its own ordered ladder in `levelRules` (`src/programs.ts`); computed by `calculateLevel`, applied by `src/levelManager.ts`, stored as `fish_level`/`plant_level`/`coral_level` on the member.
Ladder lengths differ (confirmed against `levelRules`): **BAP/fish** → Participant … Grand Poobah Yoda Breeder (4000 pts); **HAP/plant** → … Senior Premier Aquatic Horticulturist (2000 pts); **CAP/coral** is shortest → tops out at **Senior Grand Master Coral Propagator (1000 pts)** and has no per-class distribution rules.
_Avoid_: title, rank, tier, badge

**Standings**:
The Portal's public, cumulative view of members ranked by points/levels within a program. Source of truth: `src/routes/standings.ts`.
_Avoid_: leaderboard, rankings, results

### Submissions & lifecycle

**Submission**:
A member's single claim of a breeding/propagation achievement for one species, moving through a state machine to approval and points. Source of truth: the `Submission` record in `src/db/submissions.ts`; lifecycle documented in `docs/TESTING_STRATEGY_SUBMISSION_STATE_MACHINE.md`.
_Avoid_: entry, claim, report, spawn record (when you mean the DB row)

**Spawn**:
A qualifying reproduction event: for fish, a minimum of six (6) fry maintained for the waiting period (plants/corals: a cutting showing reasonable growth).
_Avoid_: breeding, birth, propagation (use _propagation_ specifically for plants/corals)

**Waiting period**:
The minimum age (from `reproduction_date`) a submission must reach before approval — **30 days for marine, 60 days otherwise** (`src/utils/waitingPeriod.ts`). A declined witness does not skip it.
_Avoid_: holding period, cooldown

**Witness (Gate 1 — physical verification)**:
A committee member's inspection of the fry/parents (or cutting). Carried on the submission as `witnessed_by` / `witnessed_on` and `witness_verification_status: pending | confirmed | declined`. A member cannot witness their own submission. **Crucially, a `declined` witness does NOT reject the submission** — it still proceeds to the approval decision (PENDING-WITNESS → PENDING-APPROVAL).
_Avoid_: verify, screen (informal), confirm (that's one outcome)

**Approved / Denied (Gate 2 — committee decision)**:
The final acceptance or rejection, separate from witnessing. **Approved**: `approved_on` / `approved_by` set and `points` calculated — only then do points count toward standings. **Denied**: `denied_on` / `denied_by` / `denied_reason` — the committee's final rejection. These two states are the second gate; witnessing is the first.
_Avoid_: accepted/rejected, validated, confirmed (confirmed belongs to witnessing)

**Changes requested**:
An intermediate state where the committee asks the member to edit and resubmit (`changes_requested_*`); resubmitting preserves witness data.
_Avoid_: revision, rework

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
The committee-side act of setting a point value for a species not on the list, by majority vote.
_Avoid_: rating, scoring

**Challenging points**:
Reviewing and changing a species' point value; changes are publicized in the club journal _Aquatica_, take effect immediately, and are not retroactive.
_Avoid_: disputing, appealing

**BAP year**:
The program's annual cycle: starts in September, ends at the July Board meeting; July/August spawns are recognized in September.
_Avoid_: season, award year, fiscal year

### Species

**Species**:
The unit a submission is about, identified by scientific (Latin) name — color variations are not separate species, but a different Latin name is. Points may be earned only once per species per member. Source of truth: `src/db/species.ts` and the species-name-group tables (canonical genus / synonyms).
_Avoid_: fish, variety, breed, strain

**Species class**:
The group a species belongs to for Specialty awards and classification (e.g. Anabantoids, Cichlids, Killifish) — distinct from **point class**. Represented as `species_class` (`src/specialtyAwards.ts`).
_Avoid_: category, group, family (when you mean the `species_class` field)

## CARES

**CARES is a distinct conservation registry, not a points/awards program.** It runs alongside BAP/HAP/CAP with its own vocabulary and lifecycle. Members register at-risk species they *maintain* (keep alive) — as opposed to the breeding/propagation *achievements* the point programs reward. Source of truth: `src/db/cares.ts`, `src/views/cares.pug`. (Keep this separate from the level ladders. The one point of contact with the point system is the **+5 CARES bonus** a *breeding submission* of a CARES-listed species earns at approval — that bonus is not the registry.)

**CARES**:
"Conservation, Awareness, Recognition, Encouragement, Support" — an international initiative (founded 2004) enlisting hobbyists to maintain populations of at-risk freshwater fish in home aquariums. BAS participates as a member club.
_Avoid_: conservation program, endangered-species program

**CARES registration**:
A member's record that they are currently maintaining a specific CARES-listed species in their collection (`cares_registered_at`, tied to a species-collection entry). Members register a species and provide a photo.
_Avoid_: enrollment, sign-up, entry

**Annual re-confirmation**:
The yearly action a member takes to affirm they are still maintaining a registered species, keeping the registration active (`cares_last_confirmed`, `years_confirmed`).
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
