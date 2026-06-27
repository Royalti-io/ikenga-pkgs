<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# {{topic}} — decision doc

## TL;DR

**{{recommendation_one_liner}}** {{one_paragraph_justification}}

If you read nothing else, read this section.

## Why this came up

What raised the question. Be specific — name the surface(s) hitting the constraint, the metric that triggered the deliberation (bundle size, latency, dev-experience pain, etc.). One paragraph is usually enough; if you need three, the framing is probably too broad — split the question.

## What's the status quo

A neutral description of what we currently do. Not "the bad option" — just what exists. Bundle sizes, perf, ergonomics, who uses it, what depends on it.

## What's the alternative

Same neutral framing for the proposed change. Cite specifics — library version, perf numbers, ergonomic differences. Link to docs / benchmarks / precedents.

## What we use it for

The actual usage. Not the surface area in general — *our* surface area. List every place we touch the thing, and what we do with it. Most of the time, this is the section that reveals "we use 5% of the surface; the swap costs less than I thought."

## What we'd lose

Honest list. Don't undersell the cost. The reader is making a sign-off decision; they need to see what's not coming with you.

- ❌ {{capability or affordance lost}}
- ⚠ {{capability we'd need to rebuild}}
- ❓ {{capability we're not sure if we use}}

## What we'd gain

The win. Bundle size, perf, ergonomics, fit-for-purpose.

- ✓ {{quantified win}}
- ✓ {{ergonomic win}}

## How we'd swap

A concrete migration path. Not "rip and replace" — the actual sequence:

1. Step one (single PR, low risk).
2. Step two — feature parity at the touch-points.
3. Step three — flip the default; old path becomes opt-in.
4. Step four — delete the old path.

For each step, name the surfaces affected and the rollback if the step fails.

## Coordination

Who else's work this touches. If three other in-flight branches use the thing being swapped, the decision blocks until they're rebased or the migration's sequenced around them.

## Recommendation

The decision restated, with a confidence level (high / medium / low) and the one signal that would flip it. Often it's "if X turns out to cost more than Y hours, abort and re-deliberate."

---

_Generated from the `decision-doc` sub-plan archetype. Use it for between-round deliberations: a question that's too big for a Round entry but doesn't change the whole plan. Decisions captured here get summarized into the next Round in `04-discussion.md`._
