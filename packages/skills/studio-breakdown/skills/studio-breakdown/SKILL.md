---
name: studio-breakdown
description: Turn a script (Fountain or plain text) into a populated com.ikenga.studio storyboard in one pass — segment it into shots (cells) and extract the recurring characters, locations, and props as reusable, seed-lockable anchors. Populates the board only; it generates nothing and spends nothing — the shots and anchor stubs are proposals for a human to review and approve before any fal render.
---

# studio-breakdown

Reads a project's script and produces two things the AI-filmmaker loop needs before generation:

1. **A shot board** — one `Cell` per shot, with shot type, camera, a one-line action, OTIO scene/shot ids, a first-draft prompt, and a duration.
2. **An asset checklist** — the distinct **characters**, **locations**, **props**, and the overall **style/look**, each created as an `Anchor` ready to be seed-locked and generated.

It is the "paste a script → get a populated board + asset checklist" step. It **does not generate video or images and never spends** — generation is a separate, human-approved step (the supervised loop). Extraction fidelity is the whole job.

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

For each shot, `storyboard.create_cell` with:

| Field | How to fill it |
|---|---|
| `beat_id` / `scene_id` / `shot_id` | OTIO ids: `sc<N>` for the scene, `sc<N>_sh<M>` for the shot |
| `shot_type` | infer from the action (`ews/ws/ls/fs/ms/cu/ecu/ots/pov/insert/aerial`); default `ms` |
| `camera_move` | infer (`static/pan/tilt/dolly/push-in/orbit/handheld…`); default `static` |
| `action` | the one-line visual description from the beat |
| `prompt` | a first-draft generation prompt = action + the project's style anchor phrasing |
| `duration_ms` | a sensible default (e.g. 4000 for a beat); the human tunes it |
| `rung` | `0_beat_sheet` — cells start as **proposals**, not rendered |
| `anchors` | the ids of the anchors this shot references (fill after step 3) |

Do **not** invent dialogue or on-screen text that isn't in the script.

### 3 — Extract anchors (the anti-drift assets)

Scan the whole script for recurring entities and create one `Anchor` each. Prefer `anchor.create` (a reference stub — no spend); use `anchor.generate` only when the human has asked to generate plates now.

| Entity | `kind` | Notes |
|---|---|---|
| A named/recurring person | `character` | the cast — the thing that must stay on-model across shots |
| A recurring place (a scene location) | `location` | one per distinct setting |
| A notable recurring object | `image` (prop) | e.g. a mask, a weapon, a logo |
| The overall look | `style` | derived from tone/lighting cues; becomes the project `style_anchors` |

Give each a stable `name`, a descriptive `prompt` (used later to generate the plate), and leave `seed` unset (the human/generation step pins it). Then go back and set each cell's `anchors[]` to the anchors that appear in that shot — this is what threads consistency.

### 4 — Wire the project

- Set the project's `style_anchors` to the style anchor(s).
- If it's a music video, hand off to `studio-beat-detect` for the beat grid.
- Leave everything at rung 0. The board is now a **proposal**: shots + an asset checklist, nothing rendered, nothing spent.

## Output contract

Everything written matches the `@ikenga/studio-schema` `Cell` / `Anchor` / `ScriptBeat` shapes. After a run:

- `storyboard.list_cells` returns one cell per shot, at rung 0, with shot/camera metadata + a draft prompt + anchor refs.
- `anchor.list` returns the extracted characters/locations/props/style.

The human then reviews the board, locks and generates the anchor plates (`anchor.generate`), approves shots, and generates video per shot (`render.enqueue engine:'fal'` or a Track-B handoff). Breakdown never does those.

## Anti-patterns

- ❌ Generating images/video, or calling `render.enqueue`, during breakdown — that spends money; breakdown only proposes.
- ❌ Inventing dialogue, characters, or beats not present in the script.
- ❌ Pinning seeds — leave anchors unseeded; the generate step pins them so the human owns the lock.
- ❌ Advancing cells past rung 0 — they must land as reviewable proposals.

## Usage

```
studio-breakdown --project <slug>
# agent reads the project's script and populates the board + anchor checklist,
# leaving everything as an approvable proposal.
```
