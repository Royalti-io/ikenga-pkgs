<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# {{topic}} — root cause + fix ({{date}})

{{one_line_outcome}}

## What was actually happening

A precise sequence of events from "user action" to "observed bad state." Numbered, with file:line references when you have them. The goal is reproducibility — a future reader should be able to walk through the steps and see the same failure.

1. {{first event}}
2. {{second event}} (cite `path/to/file.ts:LL`)
3. {{...}}

**The result was:** what the user / system observed. The error message, the missing data, the deadlock, the visual glitch.

## The actual cause

What was the load-bearing wrong thing. One paragraph. Distinguish between *what triggered it* (the proximate cause — often a race / edge case / unexpected interaction) and *what made it triggerable* (the design choice that allowed the triggering scenario to exist).

A good cause statement is *falsifiable*: "if we change X, the cascade can't happen, because Y." If you can't say that, you don't have the cause yet — keep digging.

## What we ruled out (and why)

Hypotheses that were investigated and rejected. Worth recording — it saves the next person from re-investigating.

- ⊘ {{hypothesis A}} — ruled out because {{evidence}}
- ⊘ {{hypothesis B}} — ruled out because {{evidence}}

## The fix

What changed, in which files, with the minimum delta. Inline diff if it's small; otherwise cite the PR / commit.

```
path/to/file.ts: <one-line description of change>
path/to/other.ts: <one-line description of change>
```

The *load-bearing* change first, supporting changes after. If there's defensive cleanup that isn't strictly required, mark it as such.

## Why this fix and not others

You presumably considered alternatives. Document them and the trade-offs. Future maintainers will wonder "why didn't they just X?" — answer it here.

| Alternative | Why not |
|---|---|
| {{A}} | {{trade-off}} |
| {{B}} | {{trade-off}} |

## Test / signal

How we know the fix actually fixed it. Don't say "it works" — say what was observably wrong before and isn't now. A regression test, a runtime invariant, a log line that should never appear.

## Lessons / generalizations

Optional but recommended. What does this teach us about a broader class of bugs? A pattern to look for elsewhere, a code-review heuristic, an invariant to enforce at the type level.

If the answer is "nothing generalizable, it was a one-off" — say so. Not every bug is a systems lesson.

## Follow-ups (if any)

Things this fix didn't address but should be tracked:

- [ ] {{cleanup that would harden against re-occurrence}}
- [ ] {{related code path that probably has the same shape}}

---

_Generated from the `bug-doc` sub-plan archetype. Use it for postmortems — especially handoff-across-sessions bugs where the second session picks up an investigation. The sequence + ruled-out + fix structure makes the doc *re-readable* by someone who wasn't in the original debugging session._
