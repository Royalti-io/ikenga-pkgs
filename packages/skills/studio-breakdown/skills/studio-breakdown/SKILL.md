---
name: studio-breakdown
description: Turn a script (Fountain or plain text) into a populated com.ikenga.studio storyboard in one pass — segment it into shots (cells), tag the source script with each shot's id so the board and the script stay linked, and extract the recurring characters, locations, and props as reusable, seed-lockable anchors. Populates the board only; it generates nothing and spends nothing — the shots and anchor stubs are proposals for a human to review and approve before any fal render.
---

# studio-breakdown

Reads a project's script and produces two things the AI-filmmaker loop needs before generation:

1. **A shot board** — one `Cell` per shot, with shot type, camera, a one-line action, OTIO scene/shot ids, a first-draft prompt, and a duration.
2. **Shot tags written back into `script.fountain`** (narrative projects) — so the script line and the shot it produced are linkable as the same object, seen twice.
3. **An asset checklist** — the distinct **characters**, **locations**, **props**, and the overall **style/look**, each created as an `Anchor` ready to be seed-locked and generated.

It is the "paste a script → get a populated board + asset checklist" step. It **does not generate video or images and never spends** — generation is a separate, human-approved step (the supervised loop). Extraction fidelity is the whole job.

**Two branches, decided by the board — not by you.** Run `storyboard.list_cells` first:

- **Empty board → scaffold.** The full procedure below: segment, extract anchors, tag.
- **Board already has cells → retag only.** Create, delete and reorder **nothing**; match the
  existing cells to the script's paragraphs and write only the `[[tag]]`s. Jump to
  [step 4](#4--tag-the-script-narrative-projects-only) — steps 2 and 3 do not apply.

If you were asked only to "tag this script" (from the Studio Breakdown pane, or after
`breakdown.run` returned `ambiguous-needs-chi`), you are in the **retag** branch. Go to step 4.

## Preconditions

- A Studio project is open (via the `com.ikenga.studio` MCP: `project.open` / `project.create`).
- A script exists: either a `narrative` project with a `script.fountain` (read via `storyboard.read_fountain`), or a script passed in as text.

## Procedure

Work against the `mcp__studio__*` tool surface. All calls are project-scoped (the active project is injected).

### 1 — Read the script

- Narrative project: `storyboard.read_fountain` → the parsed beats/scenes.
- Otherwise: take the provided script text.

Parse into **scenes** (`INT./EXT.` sluglines) and **beats** (action lines). One beat with a distinct visual = one shot.

### 2 — Segment into shots (cells)

Only do this on a board that has **no cells yet**. Run `storyboard.list_cells` first: if it
returns cells, the board is already authored — **skip to step 4's retag branch** and create
nothing. Creating a parallel set of shots next to someone's existing board is the one
unrecoverable mistake in this skill.

For each shot, `storyboard.create_cell` with the fields below. `create_cell` runs the cell
through `CellSchema.safeParse` **strictly**, server-side: every field in the *Identity /
required* group has **no default**, so omitting even one returns `{ ok: false, error:
'invalid-args' }` with a Zod complaint — not a cell.

| Field | How to fill it |
|---|---|
| `uid` | **Required — and the field that actually carries the link.** A stable, project-unique id. When you are minting the board yourself, use the OTIO shot id, `sc<N>_sh<M>` (scene `N`, shot `M` within it), so `uid` and `label` agree and a re-run is idempotent. **`uid` is the key you will tag the script with in step 4**, because it is the only key guaranteed to be present, unique, and unshadowed (see step 4). `create_cell` rejects a duplicate `uid` with `cell-already-exists`. |
| `beat_id` | Required. Matches the `ScriptBeat.id` this cell came from (FK). **Not an independent link key** — see step 4. |
| `label` | Required. The shot's human-facing name. Setting it to the OTIO id (`sc<N>_sh<M>`) keeps the board legible; a prose label is equally valid, and is what a human-authored board usually has. Either way it is **not** what you tag with. `Cell` has no `shot_id` field (that name exists only on `ScriptBeat`, a different object) — if you set one it is silently stripped. |
| `rung` | Required. `0_beat_sheet` — cells start as **proposals**, not rendered. |
| `index` | Required. Document-wide 0-based ordinal across action paragraphs (**not** per-scene) — Breakdown and Canvas sort shots on `index` globally. |
| `time` | Required. `{ start, end }` in composition-absolute **seconds**. `{ start: 0, end: 0 }` is the honest value at rung 0 — nothing is timed yet. |
| `frames` | Required. `{ start, end }` as integers. `{ start: 0, end: 0 }` at rung 0, same reason. |
| `content_path` | Required. `cells/beatsheet/<uid>/content.html` — the on-disk dir token is the **short** rung token (`beatsheet` / `lofi` / `hifi`), never the enum value. Derive it with `rungDir(cell.rung)`; don't string-slice the enum. |
| `rungs` | Required. All three keys must be present: `{ '0_beat_sheet': { status: 'pending' }, '1_lofi': { status: 'pending' }, '2_hifi': { status: 'pending' } }`. |
| `last_edited` | Required. ISO-8601 timestamp. |
| `shot_type` | Infer from the action — one of `ews/ws/ls/fs/ms/cu/ecu/ots/pov/insert/aerial/unset`. Use `unset` when the script doesn't imply one; `unset` is honest, a guessed `ms` is not. |
| `camera_move` | Infer — one of `static/pan/tilt/dolly/truck/crane/handheld/zoom-in/zoom-out/orbit/unset`. **That list is the whole enum**; anything else (`push-in`, `dolly-in`, `pull-back`) is rejected as `invalid_enum_value` and takes the entire `create_cell` down with it. A scripted "slow push-in" is `dolly` or `zoom-in`. Use `unset` when unsure. |
| `action` | The one-line visual description from the beat. |
| `prompt` | A first-draft generation prompt = action + the project's style anchor phrasing. |
| `duration_ms` | A sensible default (e.g. 4000 for a beat); the human tunes it. |
| `anchors` | The ids of the anchors this shot references (fill after step 3). |

Do **not** invent dialogue or on-screen text that isn't in the script.

### 3 — Extract anchors (the anti-drift assets)

Scan the whole script for recurring entities and create one `Anchor` each. Prefer `anchor.create` (a reference stub — no spend); use `anchor.generate` only when the human has asked to generate plates now.

| Entity | `kind` | Notes |
|---|---|---|
| A named/recurring person | `character` | the cast — the thing that must stay on-model across shots |
| A recurring place (a scene location) | `location` | one per distinct setting |
| A notable recurring object | `image` (prop) | e.g. a mask, a weapon, a logo |
| The overall look | `style` | derived from tone/lighting cues; becomes the project `style_anchors` |

Give each a stable `name`, a descriptive `prompt` (used later to generate the plate), and leave `seed` unset (the human/generation step pins it). Create each as a **stub**:

- `asset: { uri: "" }` — an empty-string uri. The schema **requires** `asset.uri`, so an anchor with no `asset` is rejected; the empty uri is the documented "pending plate" convention (Breakdown / Cast & World count empty-uri anchors as pending, not ready). `anchor.generate` later replaces it with a real plate.
- Put the descriptive text in **`metadata.prompt`**, not a bare top-level `prompt` — `AnchorSchema` strips unknown top-level keys, so a top-level `prompt` is silently dropped. `metadata` is the open bag that survives.

Then go back and set each cell's `anchors[]` to the anchors that appear in that shot — this is what threads consistency.

### 4 — Tag the script (narrative projects only)

If the project has a `script.fountain` (you read it via `storyboard.read_fountain` in step 1), write each shot's id back into it as a Fountain note so the script and the board stay the same object, seen twice — this is what lets the Breakdown pane's connector rail link a script line to the shot it produced.

#### 4a — Which key to tag with (read this before you write anything)

**Never assume a cell's id from a naming convention — read the board and verify.** Breakdown
builds its lookup from the cells that are *actually there*:

```
shotId = cell.label || cell.beat_id || cell.uid     // first non-empty wins
byKey  = { shotId → shot, …then… uid → shot }       // uid inserted last, so uid wins collisions
```

Two consequences, and both bite:

- **`beat_id` is not an independent key.** It is only reachable when `label` is empty. A
  non-empty `label` **shadows** `beat_id` completely — so on a cell with `label: "Forge
  glowing"` and `beat_id: "sc1_sh1"`, the string `sc1_sh1` is **not in `byKey` at all**, and
  `[[sc1_sh1]]` resolves to nothing.
- **`label` is not a convention you can predict.** A board you did not author — which is
  exactly the retag case below — may have prose labels, or a mix. Assuming `label ==
  sc<N>_sh<M>` is how you silently unlink a shot.

**So: tag with the cell's `uid`, taken from `storyboard.list_cells` on the live board.** `uid`
is required by the schema, unique per board, and inserted into `byKey` last — it is the only
key that always resolves, on any board, whoever built it.

Before writing, **verify** each tag against the board you just read: the value you are about
to put between `[[` and `]]` must be character-identical to a `uid` in `list_cells`. If it
isn't, don't write it.

#### 4b — Two branches: scaffold, or retag

Which one you're in is decided by `storyboard.list_cells`, not by what you'd like to do.

**Scaffold branch — the board was empty and you created the cells in step 2.** For each action
paragraph you minted a cell from, tag it with that cell's `uid` (which you set yourself, so you
already know it resolves).

**Retag branch — the board already has cells (you created nothing).** This is the common case:
someone's real board, authored before this skill ran, whose script carries no tags. Also the
branch you land in when the Studio pane hands you a tag request, or when `breakdown.run`
returns `outcome: 'ambiguous-needs-chi'` — that verb deliberately refuses to guess the
paragraph→cell mapping and hands it to you, because matching is judgment.

In this branch you **create, delete and reorder nothing**. You only add notes to the script.

1. `storyboard.list_cells` → the real cells, in `index` order. Read their `uid`, `label`,
   `beat_id`, `action`/`prompt` — that's what tells you what each cell depicts.
2. `storyboard.read_fountain` → the real script.
3. **Match by reading both**: for each cell, find the one action paragraph that describes that
   shot. Compare the cell's `action`/`prompt`/`label` against the paragraph's prose. Counts
   will often disagree (a scene's establishing/style paragraph has no cell, and shouldn't get
   one) — that's expected, and it is exactly why nth-paragraph→nth-cell is wrong.
4. Tag each matched paragraph with that cell's **`uid`**.
5. **A cell or paragraph you can't confidently match, you leave untagged.** Don't stretch to
   cover every cell. An untagged paragraph draws no line; a mis-tagged one draws a *wrong*
   line, which is worse — the pane looks authoritative and is lying.

#### 4c — Writing it

- **Tag syntax**: a Fountain note, `[[c1-forge]]`, appended to the action paragraph the shot came from — the value is the cell's `uid`. Fountain notes are invisible to a screenplay reader but visible to the parser.
- **Procedure**: `storyboard.list_cells` (get the real uids) → `storyboard.read_fountain` → take the `text` you already have (or re-read if time has passed) → for each action paragraph you matched to a cell, append `[[<that cell's uid>]]` to the end of the paragraph, on the same line as its last sentence (a trailing space before the note) → `storyboard.write_fountain` with the **entire modified script**, not a fragment.
- **`write_fountain` is a wholesale overwrite** — it replaces `script.fountain` on disk with exactly the `text` you send, in full. There is no patch/append API. If you paste back anything less than the complete script (including the title page, all scenes, all paragraphs untouched by this step), you destroy the rest of the file. Always start from the full text you read, make the minimal in-place edit (append the note to the relevant line), and send the whole thing back.
- If a paragraph already carries a tag from an earlier run, leave it — don't stack a second `[[...]]` on the same line. Re-running breakdown on an already-tagged script should be a no-op for paragraphs that are already correctly tagged. If an existing tag **disagrees** with your reading, stop and say so rather than overwriting a human's authored link.
- Skip this step for non-narrative archetypes (no `script.fountain` to tag).
- **Report what you tagged and what you left alone**, by uid. If you tagged 5 of 6 cells, say which one you couldn't place and why — a partial rail the user knows about is fine; a partial rail presented as complete is not.

### 5 — Wire the project

- Set the project's `style_anchors` to the style anchor(s).
- If it's a music video, hand off to `studio-beat-detect` for the beat grid.
- Leave everything at rung 0. The board is now a **proposal**: shots + an asset checklist, nothing rendered, nothing spent.

## Output contract

Everything written matches the `@ikenga/studio-schema` `Cell` / `Anchor` / `ScriptBeat` shapes. After a run:

- `storyboard.list_cells` returns one cell per shot, at rung 0, with shot/camera metadata + a draft prompt + anchor refs. (Retag branch: it returns exactly the cells that were already there, unchanged.)
- `storyboard.read_fountain` (narrative projects) returns a script whose tagged action paragraphs carry a `[[<uid>]]` note naming a cell that **exists on this board** — verified against `list_cells`, not assumed from a naming convention. That is what the Breakdown pane's connector rail links on. Paragraphs with no confident match carry no note.
- `anchor.list` returns the extracted characters/locations/props/style.

The human then reviews the board, locks and generates the anchor plates (`anchor.generate`), approves shots, and generates video per shot (`render.enqueue engine:'fal'` or a Track-B handoff). Breakdown never does those.

## Anti-patterns

- ❌ Generating images/video, or calling `render.enqueue`, during breakdown — that spends money; breakdown only proposes.
- ❌ Inventing dialogue, characters, or beats not present in the script.
- ❌ Pinning seeds — leave anchors unseeded; the generate step pins them so the human owns the lock.
- ❌ Advancing cells past rung 0 — they must land as reviewable proposals.
- ❌ **Assuming a cell's id from a naming convention instead of reading `list_cells`.** `[[sc1_sh1]]` on a board whose cell is `uid: 'c1-forge'` links nothing and the shot drops out of the rail silently — no error, just a rail that draws 5 of 6 lines and looks authoritative.
- ❌ **Tagging by `beat_id`.** It is shadowed by any non-empty `label`; it only appears to work on boards this skill authored itself.
- ❌ **Creating cells on a board that already has them.** If `list_cells` is non-empty, you're in the retag branch: tag only.
- ❌ **Tagging a paragraph you're not sure about, to make the counts come out even.** An untagged paragraph is honest. A wrong tag draws a confident, wrong line.

## Usage

```
studio-breakdown --project <slug>
# agent reads the project's script and populates the board + anchor checklist,
# leaving everything as an approvable proposal.
```
