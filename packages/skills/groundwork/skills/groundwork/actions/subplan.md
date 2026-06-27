<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# action: `subplan` — scaffold a focused `NN-*.md` sub-plan

**Loaded when**: the user wants to scaffold a focused sub-plan for a hard piece — a diff plan for a critical-path PR, a decision doc for a between-round deliberation, or a postmortem for a bug.

**Reads first**: `../lib/state.md`, `.groundwork.json` (the current `subplans` registry).

**Spine-version**: `expected = "1"`. Runs [`../lib/state.md` §"Spine-version preamble gate"](../lib/state.md#spine-version-preamble-gate) as the first step after loading `.groundwork.json` — writing action (creates `NN-*.md`, registers in `subplans`, appends to `00-README` spine-index fence), so refuses on either direction of mismatch. No-op at v1=current.

**Profile-agnostic**: every profile uses the same archetypes. (Domain-specific archetypes could be added via overlay in the future; not in P1.)

---

## What it does

1. **Verify** `.groundwork.json` exists. Refuse otherwise.
2. **Query project memory for similar prior sub-plans** *(G6 — composition with project memory)*. If a project-memory MCP is available (mempalace is the reference implementation), once the archetype is known (after step 3), call — using mempalace's tools as the concrete example:
   - `mempalace_kg_query({ entity: <project-root-path> })` — filter triples for `(_, has_subplan, _)` where the object's `archetype` matches.
   - `mempalace_search({ query: '<archetype> <topic-keywords>' })` — semantic hits for sub-plans of the same archetype in this project (or globally if no project hits).
   Surface up to **three hits** with one-liners ("`plans/studio/06-canvas-extraction.md` — diff-plan, 7-commit PR plan, 3-4d estimate") and ask whether to riff on any. If the user picks one, use it as a structural reference when rendering — e.g. "match the estimate-breakdown table shape from `06-canvas-extraction.md`." If memory has nothing, just render the template fresh. **Skip silently if mempalace MCP isn't available.**
3. **Resolve the archetype** — `diff-plan` / `decision-doc` / `bug-doc`. If not passed, ask (`AskUserQuestion`):
   - **diff-plan** — like `plans/studio/06-canvas-extraction.md`: concrete commit-by-commit plan for a critical-path PR. File-line anatomy, API proposal, estimate breakdown.
   - **decision-doc** — like `plans/studio/07-monaco-swap.md`: mini-ADR. TL;DR, status quo, alternative, what's lost, what's gained, swap path.
   - **bug-doc** — like `plans/studio/08-tsserver-stdin-eof-bug.md`: postmortem. Sequence of events → root cause → fix → lessons. Especially useful for handoff-across-sessions bugs.
4. **Resolve the NN number** — the next free number ≥ 06 (since 00-05 are reserved spine slots). The user can override with `--number NN`.
5. **Resolve the slug** — kebab-case, derived from `--topic` if passed, asked otherwise.
6. **Render the template** — `profiles/_shared/templates/subplans/<archetype>.md` with `{{topic}}`, `{{date}}`, `{{vocab.*}}`, and any archetype-specific placeholders.
7. **Write** to `NN-<slug>.md` at the plan root. Skip if it already exists (use `--force` to overwrite — rare; confirm first).
8. **Register via the script** (don't hand-edit the anchor) — it stamps the new file's hash, sets `status: active`, and normalizes a missing ref to `null`:
   ```bash
   python3 <skill>/scripts/groundwork_state.py register-subplan \
     --plan <plan> --file NN-<slug>.md --archetype <archetype> --topic "<topic>" [--ref WP-NN]
   ```
   Also **record the new sub-plan in project memory** *(closing the loop)*, if a project-memory MCP is available. With mempalace:
   `mempalace_kg_add({ subject: <project-root>, predicate: 'has_subplan', object: <slug>, attrs: { archetype, topic, ref, created } })`. Skip if no project-memory MCP is available.
9. **Cross-link from `00-README.md`** — add a row to the "What's here" table inside the `spine-index` fence by recomputing that region's full content (existing rows + the new one) and writing it with `write-region --file 00-README.md --id spine-index --action subplan`. If `00-README` has no `spine-index` fence, the script returns an error — fall back to printing the row text for the user to paste (see Edge cases).
10. **Cross-link from `05-tracking.md` / `01-plan.md`** if `--ref WP-NN` or `--ref §<section>` was passed — adds a "See sub-plan NN-*.md" note in the matching section (inside the appropriate fence).
11. **Print** the created path + next steps (open it, fill in the template, run `groundwork status` to confirm registration).

---

## Interview (discover path)

Use `AskUserQuestion` when invoked without `--archetype`, `--topic`, etc. Skip questions whose answers were on the command line.

| # | Question | Header | Options |
|---|---|---|---|
| 1 | What kind of sub-plan? | Archetype | `diff-plan` · `decision-doc` · `bug-doc` |
| 2 | What's the topic? | Topic | (free-text — becomes the title + the slug) |
| 3 | Which `WP-NN` / `G-NN` / `§<section>` does this reference? | Ref | (free-text or "none") |
| 4 | Sub-plan number? | Number | (default: next free ≥ 06) |

For bug-doc archetype, additionally ask: "**Estimate** of complexity?" (1-line summary captured in `{{one_line_outcome}}`).

For diff-plan archetype, ask: "**Initial estimate** in days?" (captured in `{{estimate}}`).

For decision-doc archetype, ask: "**Recommended path** in one line?" (captured in `{{recommendation_one_liner}}`).

---

## `.groundwork.json.subplans` entry shape

```jsonc
{
  "subplans": {
    "06-canvas-extraction.md": {
      "archetype": "diff-plan",
      "topic":     "Canvas extraction PR",
      "ref":       "WP-01",                        // null if cross-cutting
      "created":   "2026-05-20T14:00:00Z",
      "hash":      "sha256:abc123…",
      "status":    "active"                        // "active" | "landed" | "abandoned" | "deferred"
    }
  }
}
```

The `status` field is hand-edited (groundwork doesn't track sub-plan completion automatically — when the PR / decision / bug is resolved, the author flips status to `landed` for archival).

---

## Numbering rules

- **Reserved**: `00` (README), `01` (plan), `02` / `03` (research), `04` (discussion), `05` (tracking).
- **Sub-plans**: `06` onward. Allocated in creation order; the action never renumbers (delete + re-create if you really need a different number, but the standard advice is "leave gaps if a sub-plan is abandoned").
- **`09-orchestration.md`** is reserved for the orchestrate action. Sub-plans should avoid `09` to prevent collision; the action refuses to use `09` and asks for a different number.

So practical sub-plan numbers in P1 are `06`, `07`, `08`, then `10`, `11`, ... (skipping `09`).

---

## What it does NOT do

- **Does not write the sub-plan body for you.** The template scaffolds the structure with prompts in italics + `{{placeholder}}` slots; filling it in is hand-work.
- **Does not auto-archive landed sub-plans.** When the PR ships, the author flips `status` in `.groundwork.json.subplans` and (if desired) moves the file into an `archive/` subdir.
- **Does not enforce one archetype per file.** A user can hand-edit a `diff-plan` into something else; the action's only commitment is to the scaffold at create time.
- **Does not block** other actions. Sub-plans don't carry IDs that affect the WP graph; `status`/`clarify`/`orchestrate` don't require their presence.

---

## Edge cases

- **Number already in use** — refuse, suggest the next free number, ask the user to confirm.
- **Slug collides with a different number** — accept (number disambiguates), but warn so the user can choose a more specific slug.
- **`--ref WP-NN` points at a nonexistent WP** — accept the value (don't validate), but flag in the `status` output that the ref doesn't resolve.
- **`00-README` has no `spine-index` fence** — the action falls back to printing a "manual cross-link suggested" reminder, with the table row text to paste.

---

## Click-to-fire prompt

The canonical strings the FE emits (palette / argument-picker per WP-21 / WP-23). Substitution variables: `{plan_folder}`, `{plan_title}`, `{archetype}` (one of `diff-plan` / `decision-doc` / `bug-doc`), `{topic}`, `{ref}` (a `WP-NN` or `§<section>` or empty).

**Standalone slash form**:

```
/groundwork subplan --archetype {archetype} --topic "{topic}" --ref {ref}
```

**Seeded-session form**:

```
Scaffold a new groundwork sub-plan in `{plan_folder}` (plan title: {plan_title}).

Archetype: {archetype} (one of: diff-plan, decision-doc, bug-doc). Topic: {topic}. Reference: {ref}.

If the groundwork skill is loaded in this session, follow its `subplan` action verbatim — read `.claude/skills/groundwork/actions/subplan.md`, resolve the next free `NN` number ≥ 06, render the matching template from `profiles/_shared/templates/subplans/{archetype}.md`, write to `{plan_folder}/NN-<slug>.md`, register in `.groundwork.json.subplans`, and cross-link from `00-README.md`. If the skill is not loaded, read the canonical reference instance for the archetype (`plans/studio/06-canvas-extraction.md` for diff-plan, `plans/studio/07-monaco-swap.md` for decision-doc, `plans/studio/08-tsserver-stdin-eof-bug.md` for bug-doc — the same exemplars named in this action's archetype list) and mirror its section shape with the new topic.

Don't reuse a number already in use; don't write to 09 (reserved for orchestrate).
```
