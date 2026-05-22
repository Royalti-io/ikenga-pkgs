<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# action: `status` — read-only health report

**Loaded when**: the user asks "where are we" / runs `groundwork status`.

**Reads first**: `../lib/state.md`, `.groundwork.json`, every doc in the spine.

**Spine-version**: `expected = "1"`. Runs [`../lib/state.md` §"Spine-version preamble gate"](../lib/state.md#spine-version-preamble-gate) as the first step after loading `.groundwork.json` — read-only action, so on anchor-too-old it **refuses with the migrate hint** (status of a not-yet-migrated folder isn't meaningful), but on anchor-too-new it **warns and proceeds with read-only semantics** (the report degrades gracefully and explicitly tags fields it can't interpret). No-op at v1=current.

**Read-only.** Never writes to disk. The cheapest possible action — makes the stateless-invocation problem legible to the user.

---

## What it reports

```
groundwork status · <plan-folder>
================================================================
Profile:        software (extends _shared)         spine_version: 1
Goal:           Lift the share-card renderer into a pkg
Created:        2026-05-20 · Updated: 2026-05-20

Documents
  01-plan.md                ✓ in sync
  02-research-external.md   ⚠ stamped 2026-04-15 (35d old)
  03-research-internal.md   ✓ stamped 2026-05-20
  04-discussion.md          ✓ in sync (last round: 4)
  05-tracking.md            ✗ hand edit inside `wp-matrix` fence — re-run orchestrate to overwrite
  09-orchestration.md       — not generated yet (run orchestrate)
  artifact/board.html       ⚠ stale: 3 input docs changed since refresh (run refresh-board)
  artifact/index.html       — hand-authored living spec (not tracked by actions)

IDs (13 total)
  G-NN gaps:       2 open · 6 folded · 0 retired
  WP-NN packages:  13 defined · 1 in_progress · 12 queued · 0 blocked · 0 done
  G-<NAME> gates:  3 declared · 1 passed · 2 pending
  D-NN designs:    1 locked · 0 pending

Design coverage
  P1: 1/1 locked  ✓
  P2: 0/5 locked  ⚠ (5 surfaces undesigned — design before P2 orchestration)
  P3: 0/4 locked  — not yet approached

Sub-plans
  active:  1 · 06-startSeededChat-extraction.md (diff-plan · ref WP-09 · G-VERB)
  landed:  0
  abandoned: 0
  deferred:  0
  ⚠ 1 active sub-plan tracks in-flight work — check if its WP is ready to flip from `queued` to `in_progress`

Profile conformance
  ✓ all required vocab present
  ✓ all spine files present
  ✓ no profile-format drift

Next suggested actions
  • Run `groundwork research --external` — research stamp is 35 days old
  • Resolve 2 open G-NN findings (see 04-discussion.md Round 4)
  • Run `groundwork refresh-board` to refresh artifact
```

The exact icon set: `✓` pass · `⚠` warn · `✗` fail · `—` n/a.

---

## How it computes each line

| Line | Source |
|---|---|
| Profile / goal / version | `.groundwork.json` direct read |
| Doc "in sync" | On-disk whole-file hash == `.groundwork.json.docs[file].hash` |
| Doc "hand edit inside fence" | Inner-fence hash on disk != recorded region hash for any region |
| Doc "stamped X days old" | `.groundwork.json.research[file].stamped` vs today |
| "Stale: N input docs changed since refresh" | Whole-file hash drift count of `01`/`04`/`05`/`09` vs `refresh-board.last_run` |
| G-NN counts | `.groundwork.json.ids` filter by kind + status |
| WP-NN status counts | Same; cross-check against `05-tracking.md` checkboxes if present |
| Design coverage | `.groundwork.json.designs` grouped by `phase` |
| Sub-plans | `.groundwork.json.subplans` grouped by `status` (active / landed / abandoned / deferred); flags actives whose `ref` WP is still `queued` (signal: implementation hasn't started but the plan-for-it has been drafted — fine, but worth confirming) |
| Profile conformance | Walk profile-required keys against rendered template state |

---

## Profile conformance check

Walks each profile-required field (defined in `_shared/profile.json` + the active overlay) and confirms:

- All `vocab.*` keys present and non-empty.
- All required spine files exist.
- All `optional_blocks` named in the profile resolve to existing fence IDs or are absent (a missing optional block is fine — that's why it's optional).
- The profile's `spine_version` is `<= current`.

If a user-dropped profile (Phase 3) is loaded, this is the check that catches drift from the `_shared` base.

---

## Output modes

- **Default** — human-readable text as shown above. Suitable for terminal.
- **`--json`** — emit a machine-readable JSON with the same fields, for piping into other tools.
- **`--quiet`** — only print warnings + failures + suggested actions; suppress green-pass lines.

---

## Suggested actions

The "Next suggested actions" section is rule-based, not heuristic:

| Trigger | Suggestion |
|---|---|
| Research stamp > 30 days | `groundwork research --external` (or `--internal`) |
| Any `G-NN` with `status: open` | "resolve N open findings (see <doc> Round <N>)" |
| Any `D-NN` undesigned for a phase about to be orchestrated | `groundwork design --phase <P>` |
| Any sub-plan with `status: active` whose ref WP is `queued` | "kick off <WP-NN> — its sub-plan is ready" |
| Whole-file drift of `01`/`05` since last `orchestrate` | `groundwork orchestrate` |
| Whole-file drift of inputs since last `refresh-board` | `groundwork refresh-board` |
| `clarify` would `fail` | "fix `<N>` blockers before orchestrating" |
| Plan has never been orchestrated and clarify passes | `groundwork orchestrate` |

Print at most three suggestions, prioritized in the order above.

---

## Edge cases

- **No `.groundwork.json`** — refuse with "not a groundwork plan folder; run `groundwork init` first."
- **`.groundwork.json` references a file that doesn't exist** — report it as `✗ missing — restore or run init --force`.
- **`.groundwork.json` is corrupt** — refuse, suggest restoring from git.
- **Workspace context with multiple groundwork folders** — status scans only the folder argument (or cwd); never recurses into subdirs. Multi-plan reporting is out of scope for P1.

---

## Click-to-fire prompt

The canonical strings the FE emits (palette per WP-21). `status` is a **read-action** — when invoked from the palette in-shell, it routes through `art.sendToActiveSession` (per WP-22) so the report lands in the active chat thread rather than minting a fresh session. Substitution variables: `{plan_folder}`, `{plan_title}`.

**Standalone slash form**:

```
/groundwork status
```

**Seeded-session form**:

```
Run groundwork status on `{plan_folder}` (plan title: {plan_title}).

If the groundwork skill is loaded in this session, follow its `status` action verbatim — read `.claude/skills/groundwork/actions/status.md` and produce the standard health report (profile, spine version, doc freshness, ID summary, sub-plan status, suggestions). If the skill is not loaded, read `{plan_folder}/.groundwork.json` and the docs it tracks, then produce the same report shape by hand.

Read-only. Do not write to disk.
```
