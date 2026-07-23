# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker (`jra3/mulm`).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Notes for mulm

- These five triage-workflow labels are **separate from** mulm's existing categorisation scheme (priority / type / domain / feature / contributor labels documented in [`GITHUB_LABELS.md`](../../GITHUB_LABELS.md)). They live alongside it: a triaged issue can carry both a triage-role label and the usual `priority:*` / `enhancement` / domain labels.
- mulm does not yet define these five labels on GitHub. Create them once (they follow mulm's lowercase-with-hyphens convention already):

  ```bash
  gh label create needs-triage    --description "Maintainer needs to evaluate this issue" --color BFD4F2
  gh label create needs-info      --description "Waiting on reporter for more information" --color FBCA04
  gh label create ready-for-agent --description "Fully specified, ready for an AFK agent"  --color 0E8A16
  gh label create ready-for-human --description "Requires human implementation"            --color 5319E7
  # `wontfix` is a GitHub default label; create only if missing.
  gh label create wontfix         --description "Will not be actioned"                     --color FFFFFF
  ```

Edit the right-hand column above if you later adopt different strings.
