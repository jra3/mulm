# Matt Pocock's Skills — provenance

The 25 skill directories in this folder (everything except mulm's own `frontend-design.md` and `ops.md`) are vendored from:

- **Source**: https://github.com/mattpocock/skills
- **Version**: **v1.2.3** (git tag `v1.2.3` → commit `835450ef244ab7335f75d95b83e7d979eae22a6d`)
- **License**: MIT (see `MATTPOCOCK-SKILLS-LICENSE` in this folder)

They are installed as **editable native files** — edit them freely to fit mulm; they are not a read-only plugin.

## Why vendored by clone rather than via the installer or the plugin

The upstream `npx skills add` installer, in the version tried at v1.1.0, copied the tip of `main` regardless of the `@tag` given and dropped each skill's supporting reference files. Upstream now also ships as a read-only Claude Code plugin (`claude plugins install mattpocock-skills`), but mulm keeps editable copies. So the content here is taken from `git clone --branch <tag>` and verified byte-for-byte against the tag (full directory trees, including each skill's `agents/openai.yaml` Codex metadata).

## The v1.2.3 set (matches upstream `.claude-plugin/plugin.json`)

Engineering: `ask-matt`, `diagnosing-bugs`, `grill-with-docs`, `triage`, `improve-codebase-architecture`, `setup-matt-pocock-skills`, `tdd`, `to-spec`, `to-tickets`, `wayfinder`, `implement`, `prototype`, `research`, `domain-modeling`, `codebase-design`, `code-review`, `resolving-merge-conflicts`, `wizard`.

Productivity: `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`, `wait-what`, `writing-for-agents`.

## Version history

- **v1.2.3** (2026-09-17): adds `resolving-merge-conflicts`, `wizard`, `to-questionnaire`, `wait-what`; renames `writing-great-skills` → `writing-for-agents` (no alias; `GLOSSARY.md` merged into it); every skill gains `agents/openai.yaml`; `prototype` now emits a single HTML file on a `prototype/<name>` branch; `wayfinder` names its unit a "decision ticket"; `diagnosing-bugs` redacts secrets; `setup-matt-pocock-skills` no longer asks about external PRs as a triage surface. Full notes: upstream `CHANGELOG.md`.
- **v1.1.0**: adds `research` + `code-review`; renames `to-prd` → `to-spec`; merges `to-plan`/`to-issues` → `to-tickets`; renames `decision-mapping` → `wayfinder`.

## Configuration

Wired for mulm by the `setup-matt-pocock-skills` steps — GitHub Issues (`jra3/mulm`) + mulm doc paths. See `../../CLAUDE.md` (`## Agent skills`) and `docs/agents/{issue-tracker,triage-labels,domain}.md`. The v1.2.3 setup skill produces the same layout (GitHub tracker, default triage labels, single-context domain docs), so the existing config did not need re-running.

## Updating

```bash
git clone --branch vX.Y.Z https://github.com/mattpocock/skills /tmp/mp-skills
cd /path/to/mulm
for d in .claude/skills/*/; do rm -rf "$d"; done
for p in $(jq -r '.skills[]' /tmp/mp-skills/.claude-plugin/plugin.json); do cp -r "/tmp/mp-skills/$p" .claude/skills/; done
for p in $(jq -r '.skills[]' /tmp/mp-skills/.claude-plugin/plugin.json); do diff -rq "/tmp/mp-skills/$p" ".claude/skills/$(basename "$p")"; done
```

Then update the Version line, the set list, and the version history above, and fix any renamed-skill references in `CLAUDE.md` / `docs/agents/`. Before wiping, `diff -rq` the current copies against their pinned tag so local edits aren't lost.
