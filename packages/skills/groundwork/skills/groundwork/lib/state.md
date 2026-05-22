<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# groundwork — plan state, identity & idempotency

The reference every action obeys. If two actions disagree about what is "generated" versus "hand-written," the bug is here, not in the actions. Read this once; the action files are thin and assume these rules.

---

## `.groundwork.json` — the identity + state anchor

Lives at the root of every groundwork plan folder (alongside `00-README.md`). Its **presence is what marks a directory as a groundwork plan** and pins its profile. Without it, every action refuses to run except `init`. Analogous to spec-kit's `.specify/memory/constitution.md`.

### Schema (v1)

```jsonc
{
  "spine_version": "1",                 // bump when the spine layout changes incompatibly
  "profile": "software",                // "software" | "general" | "<user-dropped>"
  "created": "2026-05-20T14:30:00Z",
  "updated": "2026-05-20T14:30:00Z",
  "goal": "One-sentence goal captured at init.",
  "docs": {
    "01-plan.md": {
      "hash": "sha256:abc123…",         // hash of the whole file as last written by groundwork
      "generated_regions": [
        { "id": "goal", "hash": "sha256:def456…", "last_action": "init",     "last_written": "2026-05-20T14:30:00Z" },
        { "id": "ids",  "hash": "sha256:789abc…", "last_action": "review",   "last_written": "2026-05-20T15:10:00Z" }
      ]
    },
    "05-tracking.md": {
      "hash": "sha256:…",
      "generated_regions": [
        { "id": "wp-matrix",  "hash": "…", "last_action": "orchestrate", "last_written": "…" },
        { "id": "critical-path", "hash": "…", "last_action": "orchestrate", "last_written": "…" }
      ]
    }
    // … one entry per groundwork-touched file
  },
  "ids": {                              // global ID registry (Round 2 traceability)
    "G-01": { "doc": "04-discussion.md", "round": 2, "status": "folded",   "touches": ["01-plan.md", "05-tracking.md"] },
    "WP-01": { "doc": "05-tracking.md",  "wave": 0,  "status": "queued",   "depends_on": [], "gate": "G-CANVAS" },
    "G-SCHEMA": { "kind": "freeze_gate", "wp": "WP-02", "status": "pending" }
  },
  "designs": {                          // Round 3 — design coverage tracking
    "designs/pattern-c-split.html":  { "phase": "P1", "wp": "WP-07", "locked": true,  "locked_in": "Round 5" },
    "designs/pattern-d-daw.html":    { "phase": "P2", "wp": "WP-07-layout", "locked": false }
  },
  "subplans": {                         // Studio-parity — NN-*.md focused sub-plans
    "06-canvas-extraction.md": { "archetype": "diff-plan",    "topic": "Canvas extraction PR",       "ref": "WP-01", "status": "active",   "hash": "sha256:…", "created": "2026-05-15T…" },
    "07-monaco-swap.md":       { "archetype": "decision-doc", "topic": "Monaco → CodeMirror 6 swap", "ref": null,    "status": "active",   "hash": "sha256:…", "created": "2026-05-16T…" },
    "08-tsserver-stdin-eof.md":{ "archetype": "bug-doc",      "topic": "tsserver bridge stdin EOF",  "ref": null,    "status": "landed",   "hash": "sha256:…", "created": "2026-05-20T…" }
  },
  "research": {
    "02-research-external.md": { "stamped": "2026-05-20" },
    "03-research-internal.md": { "stamped": "2026-05-20" }
  }
}
```

### Fields

- **`spine_version`** — the convention version this plan was scaffolded against. A newer skill seeing an older version offers a `migrate` step or operates read-only. Never silently mis-writes.
- **`profile`** — the active profile name. Templates resolve from `profiles/<profile>/` with `_shared` as the base.
- **`goal`** — the one-sentence answer captured at `init`. Surfaced in the board header + clarify gate.
- **`docs.<path>.hash`** — sha256 of the whole file's bytes as last written by a groundwork action. If the current on-disk hash differs, hand edits exist somewhere — actions still honor fences but `status` reports the drift.
- **`docs.<path>.generated_regions[]`** — one entry per `<!-- groundwork:auto:start ID -->` block in that file. The `hash` is over the **inner content only** (excluding the fence comments themselves) so a fence-position move counts as a hand edit, not a regenerated block.
- **`ids`** — the **traceability backbone** (Round 2). Every `G-NN` / `WP-NN` / `G-<NAME>` ID lives here with its origin doc and the set of docs it touches. The review action computes the affected-doc set from this registry + region hashes — no guessing.
- **`ids[WP-NN].drift_log[]`** (Round 8 · G-13) — *optional* per-WP audit trail of in-flight scope changes. Empty by default; only present when the shipped code diverged from the WP's sub-plan or brief. Each entry: `{round: <N>, commit: "<sha>", scope_change: "<one line>", justification: "<one line>", subplan_section: "<§ name>" | null}`. Populated by the orchestrator when a WP report mentions a "beyond the diff plan" decision (mirrors the matching `## Drift log` row in the diff-plan sub-plan). Surfaces in `review` and `status`: a future review pass greps `drift_log[]` for "shipped code matches plan?" verification. WPs that match plan keep the field absent — empty `drift_log[]` is a positive signal, not noise.
- **`designs`** — Round 3 design-coverage registry; `clarify` checks for visual-profile readiness, `status` reports gaps, `orchestrate` cites locked designs in the relevant WP briefs.
- **`subplans`** — Focused `NN-*.md` sub-plans (numbered ≥ 06). `subplan` action creates them; `status` lists them; `review` notes when a finding touches one. **No `SP-NN` ID** — sub-plans are file-numbered, not ID-allocated; cross-references happen by filename (and by the optional `ref` field linking to a WP / gap / section). `status` field is hand-edited: `active` / `landed` / `abandoned` / `deferred`.
- **`research`** — freshness stamps surfaced on the board.

### Atomic writes

Every write to `.groundwork.json` is `write tmp → rename` so a crash mid-write never leaves a corrupt anchor.

### Spine-version preamble gate

Every action — read-only and writing alike — runs the **spine-version gate** as its first step after reading the anchor. The gate makes the "newer skill sees older anchor → offer migrate or operate read-only" promise enforceable instead of aspirational. **At spine_version=1=current, the gate is a no-op** (every check passes); it earns its keep the moment the first incompatible v2 spine bump lands.

Each action declares its `expected_spine_version` (currently `"1"` for all nine). The gate's contract:

```
gate(anchor.spine_version, action.expected_spine_version):
    if anchor.spine_version == action.expected_spine_version:
        proceed                                                     # the v1=v1 common case
    elif anchor.spine_version < action.expected_spine_version:
        refuse with: "plan is on spine_version={anchor}, this skill expects {expected}.
                      Run `groundwork init --migrate` to bring the folder forward."
    elif anchor.spine_version > action.expected_spine_version:
        if action is read-only (status, clarify):
            warn: "plan is on spine_version={anchor}, this skill is on {expected} — running read-only."
            proceed with read-only semantics
        else:
            refuse with: "plan is on spine_version={anchor}, this skill is on {expected}.
                          Upgrade the groundwork skill (`npx skills add royalti-io/groundwork`) before writing."
```

Three clauses, hence three failure modes: **anchor-too-old** (most common at first v2 bump), **anchor-too-new + writing action** (user is on a newer plan than the installed skill), **anchor-too-new + read-only action** (degrade gracefully, return what we can).

The gate **never silently mis-writes** — refusal is the only behavior on incompatibility. It is intentionally implemented at the preamble of every action rather than at a central dispatcher, because each action file is the canonical home of its own behavior and the gate is part of that behavior.

#### Per-version transform table (deferred until v2)

When the first incompatible v2 spine lands, `actions/init.md` gains a `--migrate` path whose transform table is keyed by version pairs:

```
transforms = {
  ("1", "2"): [
    add_fence("01-plan.md", "risks-index", anchor_after="goal"),
    rename_fence("artifact/board.html", "board-data", "tracking-data"),
    add_doc("10-metrics.md", from_template="profiles/_shared/templates/10-metrics.md"),
    add_anchor_key("metrics", default={}),
  ],
  # ("2", "3"): [ … ],
}
```

Each transform is **structural** (insert / rename / scaffold) and **fence-preserving** — hand-authored prose outside every fence is byte-identical post-migration. No transform may invoke an agent; if a hypothetical future migration needs semantic re-flow of prose, it earns its own verb instead of riding `init --migrate`.

The transform table format is deliberately out of scope for v1 — the gate alone is enough to keep us honest until there is something to transform. See [`plans/groundwork/07-spine-version-migration.md`](../../../../plans/groundwork/07-spine-version-migration.md) for the full decision history.

---

## Generated-region fences

This is **the only mechanism** by which an action modifies an existing file. Outside the fences is hand-written prose; inside is owned by exactly one action.

### Syntax

```markdown
Hand-written introduction paragraph.

<!-- groundwork:auto:start research-summary -->
<!-- last_action: research · 2026-05-20T14:30:00Z -->

(generated content — actions overwrite this block byte-for-byte on re-run)

<!-- groundwork:auto:end research-summary -->

Hand-written follow-up.
```

Inside HTML, JSON, or any non-markdown file, use the same `<!-- … -->` form when comments are valid, or the file-type's equivalent line-comment (`// groundwork:auto:start ID`, `# groundwork:auto:start ID`). All variants are recognized by the same parser; templates use markdown comments.

### Rules

1. **Fence IDs are unique per file.** Reuse across files is fine.
2. **Actions only ever write the inner block.** Outer content + the fence comments themselves are immutable.
3. **Unrecognized fences are left untouched** — even by the action that "owns" the file. A user can introduce their own fences with IDs like `notes-<anything>` and groundwork won't fight them.
4. **A fenced block missing from `.groundwork.json`** is a new fence; on first action run, it's recorded.
5. **A fence present in `.groundwork.json` but not in the file** is treated as a hand-removal — `status` reports it; the next action run does not re-create it.

### Reserved fence IDs (by action)

| File | Fence ID | Owner action |
|---|---|---|
| `00-README.md` | `status-block` | `status`, `init` (initial) |
| `00-README.md` | `spine-index` | `init`, `subplan` (appends sub-plan rows) |
| `01-plan.md` | `goal` | `init` |
| `01-plan.md` | `ids` | `init`, `review` (re-syncs the ID index) |
| `02-research-external.md` | `findings` | `research` |
| `02-research-external.md` | `sources` | `research` |
| `03-research-internal.md` | `findings` | `research` |
| `04-discussion.md` | `rounds-index` | `review` |
| `05-tracking.md` | `round-fold` | `review` |
| `05-tracking.md` | `wp-matrix` | `orchestrate` |
| `05-tracking.md` | `critical-path` | `orchestrate` |
| `05-tracking.md` | `wave-plan` | `orchestrate` |
| `09-orchestration.md` | `*` (whole-file) | `orchestrate` |
| `artifact/board.html` | `board-data` | `refresh-board` |
| `artifact/board.html` | `board-meta` | `refresh-board` |

`artifact/index.html` is the hand-authored **living spec** — never touched by groundwork actions. `artifact/board.html` is the generated tracking board — `refresh-board` owns it.

`09-orchestration.md` is the one file an action may rewrite whole. It is *generated*; the convention is "delete and re-author from `05` + `.groundwork.json`," not "edit in place." If the user has added hand-written sections, they go above an explicit `<!-- groundwork:auto:start orchestration -->` fence; everything outside survives.

---

## Hash-diff re-run semantics

The contract: **an action that touches a region recomputes that region's content, hashes it, and writes only if the new hash differs from the recorded hash.** Equal content is a no-op (no `updated` bump, no file write).

### Algorithm (per region)

```
old_hash = .groundwork.json.docs[file].generated_regions[id].hash
new_content = action.compute(id, current_state)
new_hash = sha256(new_content)

if new_hash == old_hash:
    # no-op — leave the file alone, including its mtime
    return Unchanged

if file_on_disk[id] != reconstruct(old_hash):
    # the user hand-edited inside the fence; never clobber
    warn("region %s edited by hand — pass --force to overwrite", id)
    return SkippedDirty

write_region(file, id, new_content)
.groundwork.json.docs[file].generated_regions[id] = {hash: new_hash, last_action: NAME, last_written: now()}
.groundwork.json.docs[file].hash = sha256(whole_file_after_write)
.groundwork.json.updated = now()
```

The third clause is the safety: **if the bytes inside a fence don't match what we last wrote, we assume the user edited them.** This is rarer than the spec implies (most users edit outside fences) but it matters when it happens. The user can `groundwork status --force-rewrite <file>#<id>` to accept the overwrite.

### Idempotency, defined

A user runs a generating action twice with no other state change:

- **Generated regions** — byte-identical on disk; `last_written` unchanged; `.groundwork.json.updated` unchanged; `mtime` unchanged.
- **Hand-written prose** — byte-identical (it was never read into the action's working set).

This is **Verification #10** in `01-plan.md`. Dogfooding (Verification #2) is the forcing test: re-running `init` over an already-initialized `plans/groundwork/` must produce zero changes to disk.

### The whole-file hash

Tracks "did any byte of this file change since groundwork last touched it." Drift indicators on the board read this, not the per-region hashes. A region overwrite by an action updates both the region hash and the whole-file hash in the same write.

---

## Stable IDs (Round 2 traceability backbone)

IDs thread `01-plan.md` → `05-tracking.md` → `09-orchestration.md` → board. The review action computes the affected-doc set from the ID registry + region hashes, not from guessing. The studio second-pass caught `05` drifting precisely because traceability was ad hoc; the registry fixes that.

### Format

| ID kind | Format | Example | Where it originates |
|---|---|---|---|
| **Gap** | `G-NN` | `G-12` | Review pass — a finding folded into a Round |
| **Work package** | `WP-NN` (+ optional letter slice) | `WP-05`, `WP-05a` | Orchestrate — derived from `05-tracking` sections |
| **Freeze gate** | `G-<NAME>` (uppercase, kebab) | `G-SCHEMA`, `G-ADAPTER` | Orchestrate — declared in plan §Freeze gates |
| **Design** | `D-NN` | `D-01` | Design pass — one per `designs/*.html` produced |

`G-` is reused intentionally: a freeze gate is uppercase + name, a gap is uppercase + number. They never collide.

### Threading rules

- An ID first appears in **exactly one originating doc** (`doc:` field in `ids[ID]`).
- Mentions in other docs are *references*, not declarations.
- When the originating doc's section for an ID changes (different hash inside the relevant fence), `ids[ID].touches[]` lists every dependent doc whose region must be re-synced. The review action follows the list — no guessing.
- Renumbering is not supported in P1. Once an ID is allocated, it stays. Deletion sets `status: "retired"` rather than freeing the number.

### Discovery

`status` parses all known docs, extracts every `G-NN` / `WP-NN` / `G-<NAME>` mention, and compares to the registry. Orphans (in prose, not registered) and ghosts (registered, no prose) both surface as warnings.

---

## Worked example

A user runs `groundwork init plans/my-feature/ --profile software --goal "Lift the share-card renderer into a pkg"`.

After init:

```
plans/my-feature/
├── .groundwork.json            # spine_version=1, profile=software, goal=…, docs={…}
├── 00-README.md                # hand intro + <!-- start status-block --><!-- end --> fence
├── 01-plan.md                  # hand structure + goal + ids fences
├── 02-research-external.md     # hand intro + findings + sources fences (empty)
├── 03-research-internal.md     # hand intro + findings fence (empty)
├── 04-discussion.md            # hand "Rounds — newest first" + rounds-index fence
├── 05-tracking.md              # hand intro + wp-matrix + wave-plan + critical-path fences
├── designs/                    # empty
└── drafts/                     # empty
```

Now the user runs `groundwork research`. The researcher agent fills `02`/`03` inside the `findings` + `sources` fences. After:

- `.groundwork.json.docs["02-research-external.md"]` carries the new region hashes + `last_action: "research"`.
- `02-research-external.md` outside the fences is byte-identical to the template.

The user adds three paragraphs of hand commentary between `<!-- end findings -->` and `<!-- start sources -->`. They re-run `groundwork research` because a new source came up. The action:

1. Recomputes `findings` content — same as before → **no write**, hash unchanged.
2. Recomputes `sources` content — new source → **write**, hash updated.
3. The user's three paragraphs between the fences are byte-identical.
4. `.groundwork.json.docs["02-research-external.md"].hash` updates to reflect the new whole-file content.

Now the user runs `groundwork review`. The reviewer agent produces three findings: `G-08`, `G-09`, `G-10`. The review action:

1. Appends a new "Round N" section to `04-discussion.md` **above** the `rounds-index` fence (newest first); the fence's index entry updates inside the fence.
2. Registers `G-08`/`G-09`/`G-10` in `.groundwork.json.ids`.
3. Reads each gap's `touches[]` list (computed from the finding's references) and re-syncs the named regions in `01`/`05`.
4. Bumps every changed file's whole-file hash.

The user re-runs `groundwork review` immediately, no change. All three regions recompute to identical bytes → no writes, mtimes preserved. **Idempotent.**

---

## What this enables

- Stateless actions: every action reads `.groundwork.json` first, does its thing, writes atomically. No in-memory state survives between invocations.
- Honest "augments, never clobbers": fences are the contract; hand-written prose outside is sacred.
- Deterministic re-sync after review: the IDs say which docs to touch; the registry tracks the touches; the action follows the list.
- Profile portability: nothing in this file assumes code. The state mechanism works identically for a marketing campaign or an org change — the templates change, the state machine does not.
