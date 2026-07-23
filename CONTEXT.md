# Breeder Awards Program (BAP)

The domain of mulm: a Breeder Awards Program platform for aquarium societies. Members submit breeding/propagation achievements; a committee witnesses and approves them; the platform tallies cumulative points into levels and awards. This glossary is a **first pass** mined from `manual/manual.md` (the Brooklyn Aquarium Society _Breeder & Horticultural Awards Program Manual_, revised 2009) and cross-checked against the code. Where the manual and the app's model may diverge, see **Open questions** at the bottom — those are flagged, not resolved.

Rule vocabulary the manual defines authoritatively; where the app **implements** a concept, the code is the source of truth and is cited inline rather than restated.

## Language

### Programs

**Program**:
One of the three tracks a member earns points in: `fish`, `plant`, or `coral`. Each has its own point-value list and level ladder. Source of truth: `src/programs.ts` (`programs`, `levelRules`) and the `Program` type in `src/levelManager.ts`.
_Avoid_: category, track, award program (when you mean the code-level enum)

**BAP** (Breeders Award Program):
The fish-breeding program — points for spawning fish — and, more loosely, the umbrella name for the whole platform. Maps to the `fish` program in code.
_Avoid_: breeding program, fish program (in member-facing copy)

**HAP** (Horticultural Award Program):
The aquatic-plant program — points for growing and propagating aquatic plants. Maps to the `plant` program in code.
_Avoid_: plant program, horticulture (member-facing)

**Coral Award Program**:
The marine-coral program — points for growing and propagating hard and soft corals. Maps to the `coral` program in code. Has fewer level tiers than BAP/HAP (tops out at Senior Grand Master Coral Propagator, 1000 points).
_Avoid_: coral program (member-facing)

**Specialty Species Program**:
Recognition for breeding a required number of distinct species within a defined group (e.g. 6 Anabantoids, 12 New World Cichlids). Implemented as Specialty Awards. Source of truth: `src/specialtyAwards.ts`, `src/specialtyAwardManager.ts`.
_Avoid_: species group award, specialist program

### Points & levels

**Point class**:
The difficulty value assigned to a species: 5, 10, 15, or 20 points. Higher = harder to breed/raise (5 = breeds freely e.g. guppy; 20 = rarely bred / all marine species). Enforced in code as the `PointsTally` keys `5|10|15|20` in `src/programs.ts`.
_Avoid_: point value, tier, difficulty (when you specifically mean the 5/10/15/20 bucket)

**Points**:
The cumulative score a member earns, per program, from approved submissions. Cumulative over an indefinite period; never expires. Never applied retroactively when a species' value changes.
_Avoid_: score, credits

**Level**:
The earned title a member holds in a program once their points (and per-class distribution requirements) cross a threshold — e.g. Hobbyist (25), Breeder (50), Master Breeder (300), Grand Poobah Yoda Breeder (4000). Each program has its own ladder. Source of truth: `levelRules` and `calculateLevel` in `src/programs.ts`; upgrades handled by `src/levelManager.ts`.
_Avoid_: title, rank, tier, badge

**Standings**:
The app's public, cumulative view of members ranked by points/levels within a program. Source of truth: `src/routes/standings.ts`.
_Avoid_: leaderboard, rankings, results

**First-time spawn**:
The first recorded spawn of a species for the society, earning bonus points (+5, or +10 with a qualifying article). A species reclassified under a new scientific name is only a new species if it was never bred under the former name.
_Avoid_: new species bonus, 1st-time

### Submissions & witnessing

**Submission**:
A member's single claim of a breeding/propagation achievement for one species, moving through a lifecycle to approval and points. Source of truth: the `Submission` record in `src/db/submissions.ts`.
_Avoid_: entry, claim, report, spawn record (when you mean the DB row)

**Spawn**:
A qualifying reproduction event: for fish, a minimum of six (6) fry maintained for 60 days (marine fish: free-swimming for 30 days); for plants/corals, a cutting showing reasonable growth over 60 days.
_Avoid_: breeding, birth, propagation (use _propagation_ specifically for plants/corals)

**Witness**:
Verification by a BAP committee member who inspects fry/parents (or a cutting) within 7 days of free-swimming, revisiting after 60 days. In code the submission carries `witnessed_by` / `witnessed_on` and a `witness_verification_status` of `pending | confirmed | declined` (`src/db/submissions.ts`).
_Avoid_: verify, confirm, inspect (when you mean the formal witnessing step)

**Approved**:
The state in which a witnessed submission has been accepted and its points count toward standings — `approved_on` / `approved_by` set. The counterpart rejection state is **denied** (`denied_on` / `denied_by` / `denied_reason`).
_Avoid_: accepted, validated, confirmed

### Awards & recognition

**Award**:
A tangible recognition tied to a level or a program milestone — certificate, plaque, or trophy (e.g. certificates for 25–100 points, plaque at Master Breeder/300).
_Avoid_: prize, reward, trophy (trophy is one kind of award)

**Breeder of the Year**:
The annual award to the member who bred the most fish, plants, and/or corals, weighted by the committee for generosity and support of the club. May be withheld if no one qualifies.
_Avoid_: BOTY, top breeder, champion

**Senior Specialist / Expert Specialist**:
Cross-group Specialty tiers: Senior Specialist for achieving 4 species groups, Expert Specialist for 7 (invertebrate groups excluded from both).
_Avoid_: multi-specialist, super specialist

### People & governance

**Member**:
A person enrolled in the society who submits achievements and holds points/levels. Must be "in good standing" to claim points. Source of truth: `src/db/members.ts` (`MemberRecord`).
_Avoid_: user, breeder, hobbyist, aquarist (these are roles/titles, not the account)

**Breeders Award Committee**:
The body — a chairperson plus an even number of members, appointed by the Board — that witnesses spawns, keeps records, assigns point values, and presents awards.
_Avoid_: BAP committee (informal), the committee (when ambiguous), admins

**Claiming points**:
The member-side act of submitting and following through on a spawn/propagation so that points are recorded. It is the breeder's responsibility to file forms and verify points are recorded.
_Avoid_: requesting points, filing

**Assigning points**:
The committee-side act of setting a point value for a species not on the list, by majority vote.
_Avoid_: rating, scoring

**Challenging points**:
The process for reviewing and changing a species' point value; changes are publicized in the club journal _Aquatica_, take effect immediately, and are not retroactive.
_Avoid_: disputing, appealing

**BAP year**:
The program's annual cycle: starts in September, ends at the July Board meeting; July/August spawns are recognized in September.
_Avoid_: season, award year, fiscal year

### Species

**Species**:
The unit a submission is about, identified by scientific (Latin) name — color variations do not count as separate species, but a different Latin name does. Points may be earned only once per species per member. Source of truth: `src/db/species.ts` and the species-name-group tables (canonical genus/synonyms).
_Avoid_: fish, variety, breed, strain

**Species class**:
The group a species belongs to for Specialty awards and classification (e.g. Anabantoids, Cichlids, Killifish) — distinct from **point class**. Represented as `species_class` on submissions/awards (`src/specialtyAwards.ts`).
_Avoid_: category, group, family (when you mean the `species_class` field)

## Open questions

These are ambiguities between the manual and the app, or gaps the manual doesn't settle. They are flagged for the captain to resolve (e.g. via `/grill-with-docs`), **not** invented answers.

1. **"BAP" is overloaded.** The manual uses BAP for the fish-breeding program specifically, but mulm's `CLAUDE.md` calls the whole product a "BAP management platform." Should the glossary keep one canonical meaning (umbrella platform) and give the fish program a distinct term, or is the double meaning acceptable in context?

2. **Society-specific vs multi-tenant.** The manual encodes **Brooklyn Aquarium Society's** exact tiers, point values, and group thresholds. `CLAUDE.md` describes mulm as a platform "for aquarium societies" (plural). Are these rules hard-coded to BAS (as `src/programs.ts`/`src/specialtyAwards.ts` currently appear to be), or intended to be configurable per society? This decides whether the manual is _the_ authority or _an example_ authority.

3. **Program naming mismatch.** Manual: BAP / HAP / Coral Award Program. Code: `fish` / `plant` / `coral`. Confirm the intended mapping (assumed: BAP↔fish, HAP↔plant, Coral↔coral) and which vocabulary is member-facing vs internal.

4. **"Maintaining Species Program".** The manual's heading reads "Specialty Species Program & Maintaining Species Program," but the body only describes the Specialty (breed-N-species) mechanic. Is "Maintaining Species" a distinct program (e.g. keeping species alive rather than breeding), or a heading artifact? The code only models Specialty Awards.

5. **Points to "families or individuals, but not both."** The manual allows household/family point accounts. Does the `MemberRecord` model support a family/household member, or only individuals? (Not obvious from `src/db/members.ts`.)

6. **Witness status `declined` vs manual.** The DB's `witness_verification_status` has `pending | confirmed | declined`, and there's a separate `denied_*` set on the submission. Confirm the intended distinction: witnessing declined (the spawn couldn't be verified) vs the submission being denied (approval refused) — are these two separate gates or overlapping?

7. **Article / flowering / sexual-reproduction bonuses.** The manual defines several bonus points (+5 for an article; HAP extras equal to plant value for flowering or sexual reproduction; +5/+10 first-time-spawn variants). Where do these live in the model — computed at submission time, stored, or manual committee adjustments? (Not located in this pass.)

8. **Coral ladder is shorter.** Coral tops out at 1000 points / 7 tiers while BAP and HAP go to 4000 / 2000. Confirm this is intended and matches `levelRules.coral` in `src/programs.ts`.
