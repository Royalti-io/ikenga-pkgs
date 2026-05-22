<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# action: `init` — scaffolder

**Loaded when**: the user wants to scaffold a new groundwork plan folder, or runs an action against a folder that has no `.groundwork.json`.

**Reads first**: `../lib/state.md` (state machine spec — every write obeys it).

**Spine-version**: produces (and `--migrate` upgrades to) `spine_version: "1"`. **Owns** the `--migrate` path described in [`../lib/state.md` §"Per-version transform table"](../lib/state.md#per-version-transform-table-deferred-until-v2) — bare `init` against an existing older anchor declines and points the user at `init --migrate`; `init --migrate` walks the transform table forward. At v1=current the migrate path is a no-op.

**Idempotent**: re-running `init` on an already-initialized folder is a no-op (per hash-diff semantics in `lib/state.md`). Use `--force` to overwrite hand-edited files (rare; ask the user first).

---

## What it does

1. **Locate the target folder.** Accept it as an argument (`groundwork init plans/my-feature/`) or, if absent, ask the user.
2. **Query mempalace for similar prior plans** *(G5 — composition with project memory)*. Derive the project root (parent of the target plan folder, or its grandparent — whichever is a git root). Then:
   - `mempalace_kg_query({ entity: <project-root-path> })` — walk triples for facts like `(<root>, has_plan, <slug>)` or `(<root>, last_profile, software)`.
   - `mempalace_search({ query: '<project-root> plan' })` — semantic hits for prior plan structures + lessons.
   Surface up to **three hits** with one-liners and ask whether to riff on any of them (e.g. "use the same Phase shape as `plans/studio`?" / "lift the Round-2 risk-fold pattern from `plans/foo`?"). If memory has nothing, proceed with the blank template — *don't fabricate* hits. **If mempalace MCP isn't available**, skip this step silently; init still works on a virgin project.
3. **Run the discovery interview** (see "Interview" below) — captures goal, profile, optional spine overrides. Use `AskUserQuestion`. Skip questions whose answers were passed on the command line.
4. **Resolve the profile** — `profiles/<profile>/profile.json` extends `profiles/_shared/profile.json`. Merge with the overlay winning. Materialize the vocab map.
5. **Scaffold the spine** — for each file in the resolved template set, render `{{vocab.*}}` placeholders and write to disk. Skip files that already exist on disk (preserve hand edits). For files this action *did* write, register them in `.groundwork.json.docs` with their generated regions and content hash.
6. **Drop `.groundwork.json`** at the folder root with `spine_version: "1"`, profile, goal, created/updated, the docs map, and an empty `ids: {}` and `designs: {}`.
7. **Record the new plan in mempalace** *(closing the loop)* — `mempalace_kg_add({ subject: <project-root>, predicate: 'has_plan', object: <plan-slug>, attrs: { profile, created } })` so the next `init` in this project sees this one as a hit. **Skip if mempalace MCP isn't available.**
8. **Print next-step guidance** — typically "run `groundwork research` to fill 02/03," or for visual profiles "run `groundwork design` once 01 has enough to mock against."

---

## Interview (discover path)

Use `AskUserQuestion`. Skip any question already answered.

| # | Question | Header | Options |
|---|---|---|---|
| 1 | Where should this plan live? | Target folder | (free-text, default `plans/<derived-from-goal>/`) |
| 2 | What's the one-sentence goal? | Goal | (free-text) |
| 3 | Which profile? | Profile | `software` (Recommended) — code/feature work, produces designs · `general` — non-code, lean, no designs · `content` — _disabled in P1_ |
| 4 | Will this produce visual / UX surfaces? | Visual? | Yes (Recommended for `software` if UI is involved) · No (skips the `design` action) |
| 5 | Drop a starter sub-plan stub now (`NN-*.md`)? | Sub-plans | Yes — give me a name · No (Recommended for first-pass) |

Q4 only fires when the chosen profile's `produces_designs` is ambiguous — `general` defaults to `false` without asking; `software` defaults to `true` but the user can override (e.g. pure-backend work).

If invoked with the fast path (`groundwork init <dir> --profile <p> --goal "…"`), skip the interview entirely and use the args.

---

## Files written (initial state)

| File | Generated regions (initial) | Hand-authored regions |
|---|---|---|
| `00-README.md` | `status-block`, `spine-index` | Title + read-order + how-this-folder-updates prose |
| `01-plan.md` | `goal`, `ids` (empty registry block) | Context, all body sections (placeholders) |
| `02-research-external.md` | `findings` (empty), `sources` (empty) | Title + how-to-use intro |
| `03-research-internal.md` | `findings` (empty) | Title + how-to-use intro |
| `04-discussion.md` | `rounds-index` (empty) | "Rounds — newest first" header |
| `05-tracking.md` | `wp-matrix` (empty), `wave-plan` (empty), `critical-path` (empty) | Workstream descriptions |
| `designs/.gitkeep` | — | — |
| `drafts/README.md` | whole file (rendered from template) | — |
| `.groundwork.json` | whole file | n/a |

`artifact/board.html` is **not** written at init — `refresh-board` creates it on first run.

`artifact/index.html` (the living spec) is hand-authored. `refresh-board` does scaffold an empty stub if absent so the directory listing is complete, but the file is never re-written by an action once it exists.

`09-orchestration.md` is **not** written at init — `orchestrate` creates it.

---

## Profile resolution

```
1. Load profiles/_shared/profile.json                → base
2. Load profiles/<profile>/profile.json              → overlay (must declare `extends: "_shared"`)
3. Merge:
   - labels:           overlay wins per-key
   - optional_blocks:  union, overlay-deduped
   - produces_designs: overlay wins (boolean)
   - spine_overrides:  overlay wins per-key (file-level overrides)
4. Materialize templates:
   - For each file in the spine list, look in profiles/<profile>/templates/<file> first; fall back to profiles/_shared/templates/<file>.
   - Substitute {{vocab.work_unit}}, {{vocab.isolation_axis}}, {{vocab.freeze_gate_noun}}, {{goal}}, {{profile}}, {{date}} (UTC ISO date).
```

Unknown placeholders are an error — they indicate a typo, not a feature.

---

## After init

Print:

```
✓ groundwork scaffolded in <path>
  profile: <profile> · goal: <goal>
  spine_version: 1

Next:
  groundwork research        — fill 02/03 with a cited research pass
  groundwork design          — produce ≥2 comparable mockups (visual profiles)
  groundwork review          — first gap-analysis pass against 01
  groundwork status          — see what's in the folder
```

If the profile is `general`, omit the `design` line from the printed guidance.

---

## Edge cases

- **Folder exists and contains files but no `.groundwork.json`** — refuse, surface the contents, ask the user to confirm before scaffolding (existing files would gain a `.groundwork.json` sibling — they're treated as hand-authored and never touched).
- **Folder is already a groundwork plan** — refuse with "this folder is already groundwork; use other actions or `--force` to re-scaffold."
- **`--force`** — re-runs the scaffolder, overwriting *only inside fences* per `lib/state.md` rules. Hand-edited prose outside fences is preserved. Reuses any IDs already in `.groundwork.json`.
- **Workspace-root invocation without target dir** — refuse, ask for a target. Don't scaffold into the cwd by accident.

---

## Click-to-fire prompt

The canonical strings the FE emits (palette / Kickoff card / argument-picker per WP-21..WP-23). Substitution variables: `{target_folder}`, `{goal}`, `{profile}`.

**Standalone slash form** (when copied to clipboard outside the shell, or when piped into a fresh `claude` session that has the skill loaded):

```
/groundwork init {target_folder} --profile {profile} --goal "{goal}"
```

**Seeded-session form** (self-contained brief sent into a fresh chat that may not have the skill loaded — typically via `art.startChatSession` from the WP-23 init picker):

```
Scaffold a new groundwork plan folder at `{target_folder}`.

Profile: {profile} (one of: software, general). Goal: {goal}.

If the groundwork skill is loaded in this session, follow its `init` action — read `.claude/skills/groundwork/actions/init.md`, run the discovery interview (skipping questions already answered above), and scaffold the spine. If the skill is not loaded, treat this as a plain instruction: create the folder, write the standard 6-doc spine (00-README through 05-tracking) plus an empty `.groundwork.json` anchored at `spine_version: "1"` with the profile and goal, and report back the file list.

Do NOT scaffold outside `{target_folder}`. Preserve any existing files there as hand-authored.
```
