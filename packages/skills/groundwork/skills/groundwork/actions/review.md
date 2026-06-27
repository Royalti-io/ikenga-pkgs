<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# action: `review` — gap-analysis pass → new Round → ID-driven re-sync

**Loaded when**: the user wants to critique the plan (or a design), surface gaps, and fold them into the docs.

**Reads first**: `../lib/state.md`, `../agents/reviewer.md`, the current `01-plan.md` and `04-discussion.md`.

**Spine-version**: `expected = "1"`. Runs [`../lib/state.md` §"Spine-version preamble gate"](../lib/state.md#spine-version-preamble-gate) as the first step after loading `.groundwork.json` — writing action (appends new Round to `04`, allocates `G-NN` IDs, re-syncs touched fences), so refuses on either direction of mismatch. No-op at v1=current.

**Spawns**: one reviewer agent. Subagent type depends on scope — `general-purpose` for broad reviews, `Explore` for read-only structural critiques. With `--panel`, a fan-out of lens-reviewers + adversarial verifiers via a Workflow (see §"Verified panel").

**This is the highest-value recurring action.** The studio plan got materially better from two review passes; the studio second-pass caught `05-tracking.md` drifting from `01-plan.md` — a failure that motivated the entire stable-ID + traceability mechanism in `lib/state.md`.

---

## What it does

1. **Verify** `.groundwork.json`. Refuse without one.
2. **Scope the review**: ask the user (`AskUserQuestion`):
   - **Target**: the whole plan (default), a single doc (`01`/`05`), or a specific design (`designs/<file>`).
   - **Lens**: structural gaps · risks not surfaced · contradictions · readiness for next phase. Default: structural gaps + risks.
3. **Spawn the reviewer** with the brief from `agents/reviewer.md`, populated with `{target, lens, profile, current_state}`. Pass the relevant docs as context.
4. **Receive findings** — the agent returns a list of `{ kind, severity, finding, suggestion, touches: [docs] }`. Each finding becomes a `G-NN` ID.
5. **Allocate IDs via the script** — one call per finding: `groundwork_state.py next-id --plan <plan> --kind gap` returns the next free `G-NN` (it scans the registry for the highest in use; no hand-counting).
6. **Append a new Round** to `04-discussion.md`. The rounds body is hand-authored prose *above* the `rounds-index` fence (newest-first); only the index inside the fence is script-written — recompute the index content and `write-region --file 04-discussion.md --id rounds-index --action review`.
7. **Re-sync affected docs** — for each finding, follow its `touches[]` list; for each touched region, recompute its content and apply it with `write-region` (the script's hash-diff means unchanged regions are skipped automatically).
8. **Register each ID** via `register-id --plan <plan> --id G-NN --doc 04-discussion.md --field status=folded --field 'touches=["01-plan.md","05-tracking.md"]'` (don't hand-edit the anchor).
9. **Report** — which docs got which fence updates, which findings need user action (status `open` rather than `folded`).

---

## Round format (appended to `04-discussion.md`)

Mirrors the richer studio shape (see `plans/studio/04-discussion.md` Rounds 5–7). The Round body uses sub-sections instead of a flat list — they make the Round re-readable months later and let a future review pass pattern-match against what was decided + what was deferred + what was deliberately *not* reopened.

```markdown
## Round <N> — <one-line theme> (<date>)

<one-paragraph context: what was reviewed, why now, who did it (reviewer agent), what lens.>

### What I confirmed online                <!-- optional · only if the pass cited new external research -->
- <cited finding 1>
- <cited finding 2>

### <Severity-1> gaps folded                <!-- "Critical" gaps — won't-actually-run issues. Use "Critical" if any, else skip. -->
- **G-NN · <short title>** → <one-line fold: what changed in which doc>. <Optional citation/precedent.>
- …

### Important gaps folded                   <!-- ship-broken issues. -->
- **G-NN · <title>** → <fold>
- …

### Polish folded                           <!-- nice-to-haves. -->
- **G-NN · <title>** → <fold>
- …

### New risks folded
- **<title>**: <one-paragraph risk + mitigation>
- …

### Second-pass audit (same day)            <!-- optional · only if a meta-pass over the fold itself surfaced issues -->
<one-paragraph summary of what the audit caught and how it was resolved before sign-off>

### Deferred to <next-phase>                <!-- acknowledged, not folded; tracked here so it doesn't get lost -->
- **<short title>** — <why deferred + when to revisit>
- …

### Reviewed and NOT reopened                <!-- locks the reviewer flagged but the user kept; defended for the record -->
- **<lock that survived>** — <one-line "why still locked">
- …

### Strengths the reviewer said to defend
- <bullet — specific design call the user shouldn't second-guess later>
- …

### Plan files touched                       <!-- change manifest at the bottom — what concretely got rewritten -->
- `01-plan.md` — <section / region updated>
- `05-tracking.md` — <section / region updated>
- …

### What's locked, what's still open         <!-- closing summary -->
**Locked this round:** <bullet list>
**Still open:** <bullet list — these become the input to `clarify` next time>
```

### Additional sub-sections (use when the Round body needs them)

Studio's Rounds use these freely. Include only those that apply to *this* round; don't ship empty headers.

| Sub-section | When to use it |
|---|---|
| `### Decision needed` | The active deliberation — the question the Round is opening. Pair with a later `### Decision` once resolved. |
| `### Decision` / `### Decisions` | The resolution(s). One bullet per decision; same format as Round 1's "Decisions" table. |
| `### Approach` | How a folded decision will be *implemented* (paths, sequence). Distinct from the decision itself. |
| `### Net effect on Phase N` / `### Net effect` | Impact assessment — what the fold does to phasing, scope, estimate, risk. |
| `### Open questions` | Closing list of questions raised by this Round that aren't resolved. Become input to the next `clarify`. |
| `### Redirect N — title` | When a Round changes course mid-deliberation — capture the redirect explicitly so future readers see the inflection point. Number redirects within the Round. |
| `### Accepted as recommended` | Items where the reviewer's recommendation was accepted verbatim (no fold needed — captured here for the record). |
| `### Clarifying answer — <title>` | When a Round answers a clarifying question raised in an earlier Round (cross-references the Round number). |

This format mirrors `plans/studio/04-discussion.md` exactly. **Newest-first.** The action inserts above the most recent existing round; if `rounds-index` fence carries the round headers, that gets updated too. Sub-sections marked _optional_ are dropped when there's nothing to put in them — don't ship empty headers.

---

## ID allocation

`G-NN` numbers are global per plan, not per round. The action reads `.groundwork.json.ids` for the highest existing `G-NN` and allocates from there. Numbering convention from existing rounds (`G2-1`, `G2-2` etc.) is *display only* — the registry uses bare `G-NN`. The Round body can use `G<round>-<n>` for readability; the ID registry maps `G2-1 → G-08` (say) to keep traceability deterministic.

If the user prefers per-round numbering visibly, the action accepts a `--id-style per-round` flag and stores both forms.

---

## Affected-doc computation

For each finding, the reviewer agent suggests which docs the fix touches. The action:

1. Records the `touches[]` list in `.groundwork.json.ids[G-NN].touches`.
2. For each touched doc, identifies the relevant fenced region(s) to update.
3. Re-renders those regions and applies hash-diff per `lib/state.md`.
4. Hand-written prose in the touched docs is byte-identical (fences contract).

This is the deterministic version of the studio loop. The studio second-pass caught `05-tracking.md` drift because there was no `touches[]` mechanism — the reviewer had to manually trace which sections changed.

---

## Design reviews

When `--target designs/<file>` is passed:

- The reviewer focuses critique on the design itself — layout, hierarchy, information density, alignment with `01-plan.md`'s stated needs.
- Findings carry `kind: "design-review"` in the registry.
- The Round entry titled "Round N — design review for `designs/<file>`."
- Re-syncs may include the design file itself (the design action then re-mocks based on the findings) — this is the iterate-on-mockups loop.

---

## Strengths to defend

The reviewer's brief explicitly asks for **strengths the user shouldn't second-guess** — not flattery, but a list of design choices the reviewer thinks are sound after considering alternatives. This anchors the Round so the user can resist later second-guessing of locked decisions.

Surfaced verbatim in the Round under "Strengths the reviewer said to defend."

---

## Verified panel (`--panel`)

**Opt-in** — and the real implementation of the long-dormant `--multi` stub. Default stays one reviewer (consistent with "multi-reviewer mode off by default in P1"). With `--panel`, run a Workflow that turns the single best-effort reviewer into a **diverse-lens panel whose findings are adversarially verified before they're folded** — directly addressing this action's biggest weakness: one reviewer's plausible-but-wrong finding currently folds straight into the plan.

```js
const LENSES = ['structural-gaps', 'risks-not-surfaced', 'contradictions', 'readiness']  // or the chosen subset
// 1. one reviewer per lens (blind to each other) — diversity of lens, not redundancy
const raw = (await parallel(LENSES.map(l => () =>
  agent(reviewerBrief(l), { label: `lens:${l}`, schema: REVIEWER_FINDINGS_SCHEMA, model: 'sonnet' })
))).filter(Boolean)
// 2. BARRIER: dedup findings across lenses — plain code, not an agent
const deduped = dedupeByTitleAndTouches(raw.flatMap(r => r.findings))
// 3. perspective-diverse adversarial verify: 3 distinct lenses try to REFUTE each finding
const verified = await parallel(deduped.map(f => () =>
  parallel(['correctness', 'severity-calibration', 'is-it-actually-real'].map(lens => () =>
    agent(`Try to refute this finding via the ${lens} lens: ${JSON.stringify(f)}. Default refuted=true if uncertain.`,
          { label: `verify:${lens}`, schema: VERDICT_SCHEMA, model: 'opus' })
  )).then(vs => ({ ...f, real: vs.filter(Boolean).filter(v => !v.refuted).length >= 2 }))
))
const confirmed = verified.filter(f => f.real)
```

Schemas are in [`../lib/schemas.md`](../lib/schemas.md). A finding survives only if **≥2 of 3** refutation attempts fail — this kills the plausible-but-wrong findings a single reviewer would have folded. A final synthesis agent merges each surviving lens's `strengths_to_defend` / `new_risks` / `deferred` / `not_reopened` / `still_open` into one Round envelope (still required; `strengths_to_defend` is not optional).

**For a thorough audit**, add the **loop-until-dry** pattern — re-run the lens panel until K consecutive rounds surface no *new* (deduped-against-all-seen) findings, so the tail of subtle gaps isn't missed.

**The Workflow returns `confirmed` + the merged envelope; it writes nothing** (no filesystem in scripts). The action then folds them through the **exact same pipeline as the single-agent case**: allocate `G-NN` via `next-id` (one per confirmed finding), append the Round to `04-discussion.md` (newest-first), re-sync each finding's `touches[]` fences via `write-region`, register each ID. The Round body and output shape are byte-identical to the single-agent path — `--panel` only changes *how findings are produced and filtered*, not how they're recorded. If Workflow isn't available, `--panel` falls back to the single reviewer with a one-line note.

---

## Edge cases

- **Reviewer returns nothing material** — write a "Round N — review pass: no findings" entry noting the lens and what was checked. This is itself useful (a non-trivial nothing-found pass is evidence the plan is settling).
- **Conflicting findings across reviewers (`--panel`)** — the adversarial-verify stage resolves most (a finding contradicted by its refuters drops out); for genuinely conflicting *surviving* findings, note both in the Round and surface to the user — do not auto-resolve. `--panel` is off by default (single reviewer); see §"Verified panel". (`--multi` is accepted as a back-compat alias for `--panel`.)
- **Hand-edited Round in `04`** — never touched; only the new Round is appended.
- **`touches[]` includes a doc that doesn't exist** — register the gap but skip the re-sync; surface as a warning ("G-XX wants to touch `06-foo.md` which doesn't exist; create it or update the finding").

---

## Click-to-fire prompt

The canonical strings the FE emits (palette / WP-card per WP-21). Substitution variables: `{plan_folder}`, `{plan_title}`.

**Standalone slash form**:

```
/groundwork review
```

**Seeded-session form**:

```
Run a groundwork review pass on `{plan_folder}` (plan title: {plan_title}).

If the groundwork skill is loaded in this session, follow its `review` action verbatim — read `.claude/skills/groundwork/actions/review.md` and `.claude/skills/groundwork/agents/reviewer.md`, spawn a reviewer agent, allocate `G-NN` IDs for each finding, append a new Round to `04-discussion.md` (newest-first), and re-sync affected docs via the IDs' `touches[]` lists. If the skill is not loaded, read `{plan_folder}/01-plan.md` + `04-discussion.md` for current state, then critique the plan structurally (gaps, risks not surfaced, contradictions, readiness for next phase), allocate sequential `G-NN` IDs starting from the highest already in use, and append a Round in the standard format.

Strengths-to-defend are required, not optional — list the design choices that are sound after considering alternatives.
```
