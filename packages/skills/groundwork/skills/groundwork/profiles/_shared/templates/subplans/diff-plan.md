<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# {{topic}} — diff plan

{{one_line_goal}}

**Estimate:** {{estimate}}. Revise as you read through.

---

## Goal

State the change in one paragraph. What's being extracted / refactored / introduced. What stays unchanged. The merge criterion (the *single* observable signal that says this PR is safe to merge).

## Anatomy of the existing code

Map the file(s) being touched. For a refactor, three columns are usually right:

| Concept | Functions / Refs | Lines |
|---|---|---|
| Concern A | | |
| Concern B | | |
| Glue between them | | |

**Key insight:** what's the tightest characterization of the seam you're cutting along? One sentence.

## Proposed API / signature

```ts
// destination/path/file.ts
// the exact shape this PR will ship — pasteable, type-checked
```

Annotate any field that's new (not lifted) with `// new`. Anything that's a *renaming* of an existing concept, annotate with `// was: <old name>`.

## The commits

A diff plan = a sequence of small, individually-mergeable commits. Each commit:

| # | Commit | What it does | Verifiable signal |
|---|---|---|---|
| 1 | `chore: scaffold types` | Add the new file with types only, no implementation | `pnpm typecheck` green |
| 2 | `feat: implement X` | Add the implementation | unit test X passes |
| 3 | `refactor: replace inline use sites` | Wire consumers to the new shape, one at a time | each commit `typecheck` green |
| 4 | `chore: remove dead code` | Delete the old implementation | green tests + manual check |
| 5 | `docs: …` | README / ADR / etc. | n/a |
| … | | | |

The number of commits is a function of how risky each step is. 3 commits is fine for a small refactor; 7+ is fine for a big one — what matters is each commit is individually reviewable.

## Risks

- **Behavior change risk:** what could regress, and how you'll catch it.
- **Time-bound risk:** what could blow the estimate, and the fallback (split the PR, drop scope, defer to next phase).
- **Coupling risk:** other in-flight work that touches the same files; coordination with whom.

## Estimate breakdown

Show your work. A 3-day estimate with a 1-line justification is not useful; a 3-day estimate broken into "0.5d types, 1d implementation, 0.5d consumer rewiring, 0.5d tests, 0.5d cleanup" is.

| Phase | Time |
|---|---|
| | |

**Buffer:** 20% on top of the sum unless the work is well-scoped boilerplate.

## Out of scope (explicitly)

Things adjacent to this PR that you considered including and decided against. Each one gets a one-line "why not" so the reviewer doesn't have to re-derive your reasoning.

- ⊘ X — defer to {{next_phase}}
- ⊘ Y — separate concern; address in {{related_subplan}}

## Done when

The merge criterion in `## Goal` restated as a checklist:

- [ ] {{primary criterion}}
- [ ] CI green
- [ ] No regression in {{related surface}}
- [ ] Reviewer sign-off

## Drift log

Empty by default — only filled in if the shipped code diverges from the plan above. Each entry is one row recording an in-flight scope change (added field, removed step, signature tweak, process deviation) the build agent made without re-spec'ing first. The orchestrator appends to this list when a WP's report mentions a "beyond the diff plan" decision, AND mirrors a one-line cross-ref into the WP's report in `05-tracking.md`. Keeps process drift discoverable to future `review` passes (the silent plan-vs-shipped-code drift this skill was built to prevent).

| Round | Commit | Scope change | Justification | Sub-plan section affected |
|---|---|---|---|---|
| | | | | |

If this table stays empty through merge, the shipped code matched the plan — good signal.

---

_Generated from the `diff-plan` sub-plan archetype. Edit any section freely; the action's only commitment is to scaffold the structure, not own it after._
