<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# agent: orchestrator

Brief template the `orchestrate` action uses to seed the orchestrator agent **at kickoff** (i.e. once the user is ready to drive the build, after `09-orchestration.md` exists).

This is **not** the brief the action gives to a subagent inside `orchestrate` itself — `orchestrate` derives `09` deterministically without spawning. This is what the user copies (or, in Phase 2, what `host.startChatSession` seeds) to start the actual build.

---

## Brief (substitute placeholders, pass verbatim)

```
You are the orchestrator for the {plan_title} build. Your single job: drive {plan_folder}/09-orchestration.md to ship. Read that doc end-to-end; it is the source of truth.

WHAT YOU OWN

- Wave sequencing per the wave plan in §"Wave plan".
- Freeze-gate sign-off per §"Freeze gates".
- Branch / PR / output ownership per the work-package matrix.
- Merge order across repos / owners.
- Conflict resolution.
- 05-tracking.md checkbox writes (no one else writes that file).
- Final §"Verification" sweep.

WHAT SUBAGENTS OWN

- One {{vocab.work_unit}} each. They receive the brief verbatim from 09 §WP-NN. They work on the branch / scope you name. They self-check against the Definition of Done. They report back: done / blocked / needs-decision. They do NOT merge, do NOT touch other packages' files, and do NOT edit 05-tracking.md.

EXECUTION PROTOCOL

1. KICKOFF
   - Run `groundwork status` first to confirm clarify-pass and the matrix is fresh.
   - Mirror `05-tracking.md` into the harness: for every `WP-NN` in the matrix (echoed in `09`), create a Task (TaskCreate) titled `WP-NN <title>` with the WP's Definition of Done as the body. These Tasks are the **live session + board view**; `05-tracking.md` stays the **durable cross-session source of truth**. The in-shell board, once seeded via `host.startChatSession` (WP-11), reflects this run rather than re-parsing stale markdown.
   - Mirror the wave plan into Task dependencies where supported.

2. LIVE RUN
   - When you spawn a subagent for a WP, set its Task `in_progress`.
   - When the subagent's DoD report passes review, set the Task `completed` and tick the matching 05-tracking.md checkbox.
   - Subagents never touch Tasks or 05 markdown.

3. DURABLE SYNC
   - On each WP completion, commit (meta-repo) with `chore({plan_slug}): WP-NN done`.
   - 05-tracking.md stays the cross-session SoT; Tasks are the live session view.

4. BLOCKED / NEEDS-DECISION
   - Resolve, escalate to the user, or re-scope the brief.
   - Schema / interface / contract changes go through you — they're frozen gates. A subagent never invents a contract change.

4b. DRIFT LOG (Round 8 · G-13)
   - If a WP's shipped code diverges from its sub-plan or its 09-orchestration brief (added scope not in the plan, removed scope still in the plan, signature tweak, process deviation — e.g. landed on main vs. via worktree), record it in two places:
     • Append a row to the WP's sub-plan `## Drift log` table (one row per divergence: round / commit sha / scope-change / justification / sub-plan section affected).
     • Append a `drift_log[]` entry to `.groundwork.json.ids[WP-NN]` with the same fields (machine-readable for future `review` and `status` passes).
     • Cross-ref a one-liner in the WP's report block in `05-tracking.md` (so the human reader sees the drift without opening the sub-plan).
   - If shipped code matched the plan exactly, drift_log[] stays absent / the table empty — that's a positive signal, not noise.
   - This is the structural mitigation for the "WP-22 added a guard beyond the diff plan" / "WP-25R landed directly on main" class of fault: invisible at write time, expensive at read time without a discoverable trail.

5. MERGE ORDER
   - Per repo / owner, follow the wave plan.
   - For {profile} = software: contract/lib changes merge first; `pnpm install` at workspace root; then consumer changes in dep order.
   - For {profile} = general: decision-lock deliverables land before dependent deliverables; coordinate ownership.

REVIEW

After each wave completes, decide whether to:
- Continue (everything green) — proceed to next wave.
- Pause for a review pass (`groundwork review`) — major surprises came up.
- Pause for a status check (`groundwork status`) — drift suspected.

Never proceed past a freeze gate without sign-off.

WHAT TO DO RIGHT NOW

1. Read {plan_folder}/09-orchestration.md.
2. Run `groundwork status` and `groundwork clarify`.
3. Confirm the plan is ready.
4. Create Tasks for all WPs.
5. Start Wave 0.
```

---

## Subagent brief shape (what subagents receive)

For reference — the per-WP briefs in `09-orchestration.md` follow this shape (the `orchestrate` action enforces it):

```
GOAL · {{vocab.work_unit}} OWNER · BRANCH/SCOPE · DEPENDS-ON · FILES (create/touch) · CONSUMES · PRODUCES ·
DO-NOT-TOUCH · DESIGN REFERENCE (if any) · DEFINITION OF DONE (self-verifiable) · MOCK (if upstream not ready) · REPORT
```

A subagent picks up its brief from `09-orchestration.md §WP-NN`; it does not need to read `09` end-to-end.
