# Matt Pocock's Skills — provenance

The 21 skill directories in this folder (everything except mulm's own `frontend-design.md` and `ops.md`) are vendored from:

- **Source**: https://github.com/mattpocock/skills
- **Version**: **v1.1.0** (git tag `v1.1.0` → commit `d574778f94cf620fcc8ce741584093bc650a61d3`)
- **License**: MIT (see `MATTPOCOCK-SKILLS-LICENSE` in this folder)

They are installed as **editable native files** — edit them freely to fit mulm; they are not a read-only plugin.

## Why vendored by clone rather than left as the installer wrote them

The upstream installer (`npx skills@latest add mattpocock/skills@v1.1.0 --copy`) prints a `@v1.1.0` source label but, in the version used here, actually copies the tip of `main` (latest), not the v1.1.0 tag — and copies only each `SKILL.md`, dropping the skills' supporting reference files. Because the captain pinned **v1.1.0 specifically (not latest)**, the content here was instead taken from `git clone --branch v1.1.0` and verified byte-for-byte against that tag (full directory trees, not just `SKILL.md`).

## The v1.1.0 set (matches upstream `.claude-plugin/plugin.json`)

Engineering: `ask-matt`, `diagnosing-bugs`, `grill-with-docs`, `triage`, `improve-codebase-architecture`, `setup-matt-pocock-skills`, `tdd`, `to-spec`, `to-tickets`, `wayfinder`, `implement`, `prototype`, `research`, `domain-modeling`, `codebase-design`, `code-review`.

Productivity: `grill-me`, `grilling`, `handoff`, `teach`, `writing-great-skills`.

v1.1.0 markers (vs the prior release): adds `research` + `code-review`; renames `to-prd` → `to-spec`; merges `to-plan`/`to-issues` → `to-tickets` (`to-issues` is gone); renames `decision-mapping` → `wayfinder`.

## Configuration

Wired for mulm by the `setup-matt-pocock-skills` steps — GitHub Issues (`jra3/mulm`) + mulm doc paths. See `../../CLAUDE.md` (`## Agent skills`) and `docs/agents/{issue-tracker,triage-labels,domain}.md`.

## Updating

To re-pin or bump the version later, re-clone the desired tag and re-copy these directories, then re-verify against the tag. Keep this file's Version line in sync.
