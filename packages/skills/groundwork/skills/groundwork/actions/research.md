<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# action: `research` — external + internal research passes

**Loaded when**: the user wants to fill `02-research-external.md` and/or `03-research-internal.md`, or refresh stale research.

**Reads first**: `../lib/state.md`, `../agents/researcher.md`, the plan's current `01-plan.md` (so the agent knows what to research).

**Spine-version**: `expected = "1"`. Runs [`../lib/state.md` §"Spine-version preamble gate"](../lib/state.md#spine-version-preamble-gate) as the first step after loading `.groundwork.json` — writing action, so refuses on either direction of mismatch. No-op at v1=current.

**Spawns**: one researcher agent (via the `Agent` tool, `general-purpose` subagent by default) — or, with `--sweep`, a fan-out of finders via a Workflow (see §"Multi-modal sweep").

---

## What it does

1. **Verify**: `.groundwork.json` exists. If not, refuse and tell the user to run `init`.
2. **Read state**: load `.groundwork.json`. Pull goal + profile + current ids.
3. **Scope the pass**: ask the user (`AskUserQuestion`) whether to run external-only, internal-only, or both. Default: both, if both files exist and have empty findings; otherwise whichever is empty/stale.
4. **Spawn the researcher** — use `Agent` with `subagent_type: "general-purpose"` (or `Explore` if read-only). Pass the brief in `agents/researcher.md` populated with `{goal, profile, scope, target_file}`.
5. **Fold the result via the script** — the agent returns structured findings + sources. Write each into its fence with `write-region` (one call per region); the script hash-diffs and reports `WRITTEN` / `UNCHANGED` / `SKIPPED_DIRTY` — never hand-edit the file or its hashes:

   ```bash
   python3 <skill>/scripts/groundwork_state.py write-region \
     --plan <plan> --file 02-research-external.md --id findings \
     --action research --content-file <agent-findings.md>
   # repeat for --id sources, and 03-research-internal.md --id findings
   ```

   On `SKIPPED_DIRTY`, surface the hint to the user (they hand-edited inside the fence) and pass `--force` only with their say-so.
6. **Stamp** via the script (don't hand-edit the anchor): `python3 <skill>/scripts/groundwork_state.py stamp-research --plan <plan> --file 02-research-external.md` (and `03-…` if internal ran).
7. **Report**: print each fence's `write-region` result (which were `WRITTEN` vs `UNCHANGED`).

---

## Internal vs external

- **External (`02-research-external.md`)** — researcher uses `WebSearch`, `WebFetch`. Cites every claim with a URL. Findings come back as `## <topic>` sub-sections; sources collected into a unified list at the bottom.
- **Internal (`03-research-internal.md`)** — researcher uses `Grep`, `Glob`, `Read` against the project tree (workspace root or whatever the user is in). Cites with `file_path:line_number`. Finds prior work, existing assets, code that would be touched, constraints.

The agent **never** edits the plan docs directly — it returns content; the action writes it.

---

## Fence layout

`02-research-external.md`:

```markdown
# 02 — External research

Outside research backing the plan. Cite every claim.

<!-- groundwork:auto:start findings -->
<!-- last_action: research · <ISO> -->
…findings, one ## section per topic…
<!-- groundwork:auto:end findings -->

## How to use this file

(hand-authored tips, optional)

<!-- groundwork:auto:start sources -->
<!-- last_action: research · <ISO> -->
1. <Title> — <URL> (accessed <date>)
…
<!-- groundwork:auto:end sources -->
```

`03-research-internal.md` has the same `findings` fence; no `sources` fence (citations live inline as `path:line`).

---

## Profile vocabulary

The brief substitutes:

- `software` profile: "the codebase," "existing code," "prior PRs."
- `general` profile: "existing assets, prior work, current constraints" — no code vocabulary.
- `content` profile: "prior pieces, existing brand assets, the editorial standards, channel performance" — no software vocabulary; research the audience, the competitive content landscape, and precedent pieces.

---

## Re-run semantics

Per `lib/state.md`:

- Identical findings → no write, no `updated` bump.
- New findings → write inside the fence; hand-written prose between fences is byte-identical.
- Researcher returned nothing new → `stamped` updates but the fence content does not (so a "refresh" doesn't churn the file).

If the user has hand-edited inside a fence, the action warns and skips the region unless `--force-rewrite <file>#<region>` is passed.

---

## Multi-modal sweep (`--sweep`)

**Opt-in.** Default is the single general-purpose agent above. With `--sweep`, run a Workflow that fans out **finders by angle** — each blind to the others, so coverage comes from diversity of search lane rather than one agent trying every angle:

| Angle | Scope | Tools | Tier |
|---|---|---|---|
| `external-precedent` | external | WebSearch / WebFetch — prior art, precedents, related research | `sonnet` |
| `external-library-docs` | external | WebSearch / WebFetch — library/API/RFC docs (`software` only) | `sonnet` |
| `internal-codebase` | internal | Grep / Glob / Read — prior work, code that'd be touched | `sonnet` |
| `internal-constraints` | internal | Grep / Glob / Read — constraints already encoded, conventions | `sonnet` |

Only the angles matching the chosen scope run (external-only → first two; internal-only → last two; both → all). Sketch:

```js
const found = (await parallel(ANGLES.map(a => () =>
  agent(researcherBrief(a), { label: a.key, schema: RESEARCHER_SCHEMA, model: 'sonnet' })
))).filter(Boolean)
// synthesis: dedup + merge into the two fence payloads (one agent, sees all finders)
const merged = await agent(synthesisBrief(found), { schema: RESEARCH_SYNTHESIS_SCHEMA, model: 'sonnet' })
return merged
```

`RESEARCHER_SCHEMA` / `RESEARCH_SYNTHESIS_SCHEMA` are in [`../lib/schemas.md`](../lib/schemas.md). Optionally **budget-scale** the finder count: `const N = budget.total ? Math.min(ANGLES.length, Math.floor(budget.total/120_000)) : ANGLES.length`.

**The Workflow returns `merged`; it does not write files** (no filesystem in scripts). The action then writes `merged.external_findings` / `merged.external_sources` / `merged.internal_findings` into their fences via the **same `write-region` path** as the single-agent case (step 5 above), stamps via the script, and reports `WRITTEN`/`UNCHANGED`/`SKIPPED_DIRTY` identically. Pass today's date into the synthesis prompt (scripts can't read the clock). If Workflow isn't available, `--sweep` falls back to the single-agent path with a one-line note.

---

## Composition

groundwork doesn't reimplement web search — it spawns a general-purpose agent (or, under `--sweep`, a fan-out of them) that uses the standard Claude Code research tools. For workspaces with project-specific MCP search (e.g. PostHog, Royalti CMS), the agent's brief notes "use any MCP tools available for project-scoped search" without naming them — the agent reads the tool list at spawn time. Under `--sweep`, Workflow agents reach the same session-connected MCP tools via on-demand schema loading.

---

## Edge cases

- **Empty plan (no `01-plan.md` content beyond placeholders)** — the agent has nothing to search around. Warn the user and suggest writing the plan goal + a few bullets in `01-plan.md` first.
- **No `02`/`03` file present** — `init` always creates them, so this means the user deleted them. Refuse and tell them to run `groundwork init --force` to restore.
- **Stale research (older than 30 days)** — `status` flags it; users can re-run `research` to refresh. The `stamped` date drives this.

---

## Click-to-fire prompt

The canonical strings the FE emits (palette / WP-card per WP-21). Substitution variables: `{plan_folder}`, `{plan_title}`.

**Standalone slash form**:

```
/groundwork research
```

(invoked from inside `{plan_folder}` — the action reads `.groundwork.json` from cwd. If the user is elsewhere, prefix `cd {plan_folder} && `.)

**Seeded-session form**:

```
Run a groundwork research pass on `{plan_folder}` (plan title: {plan_title}).

If the groundwork skill is loaded in this session, follow its `research` action verbatim — read `.claude/skills/groundwork/actions/research.md` and `.claude/skills/groundwork/agents/researcher.md`, then spawn a researcher agent to fill `02-research-external.md` and `03-research-internal.md` inside their generated-region fences. If the skill is not loaded, read `{plan_folder}/01-plan.md` for context and produce findings + sources by hand, writing inside the existing `<!-- groundwork:auto:start findings -->` fences in the 02 / 03 files.

Cite every external claim with a URL; cite every internal claim with `path:line`. Stamp the run in `.groundwork.json.research.<file>.stamped` to today's date.
```
