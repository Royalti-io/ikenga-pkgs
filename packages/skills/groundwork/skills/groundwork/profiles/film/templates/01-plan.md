# {{goal}}

## Goal

<!-- groundwork:auto:start goal -->
<!-- last_action: init · {{date}} -->
{{goal}}
<!-- groundwork:auto:end goal -->

## Logline

_One or two sentences: protagonist, want, obstacle, stakes. The whole film in a breath. This is the spine every section below answers to — if a choice doesn't serve the logline, cut it._

## Treatment

_The film told as present-tense prose, beat by beat, scene by scene — the pre-production bible's narrative core. Long enough to feel the shape, short enough to read in one sitting. Annotate sections locked by a specific round: `## Treatment (locked Round N)`. As beats firm up, they become the sequences in `05-tracking.md` (one `WP-NN` per sequence) and the shots that Studio's shot board will execute._

## Cast & character bible

_One entry per character — description, arc, and the on-screen references that keep them consistent across shots. Each principal maps to a **Studio anchor** (`mcp__studio__anchor_create`) so the AI shot generator holds face/wardrobe/props steady from shot to shot. Record the anchor id here once created; that id is the contract between this bible and the Studio project._

| Character | Role | One-line description | Arc (start → end) | Studio anchor id | Reference / lookbook link |
|---|---|---|---|---|---|
| _e.g._ Ada | Protagonist | Reluctant archivist | Isolated → connected | `anchor_ada` | `designs/look-ada.html` |
| | | | | | |

## Locations

_Every place the story lives — real, virtual, or generated. What each looks like, what mood it carries, and how it will be produced (practical plate, generated set, stock)._

| Location | Scenes | Look / mood | Production method | Notes |
|---|---|---|---|---|
| _e.g._ The Archive | 1, 4, 7 | Cold, cavernous, blue | Generated set | Recurs — lock lookbook early |
| | | | | |

## Look / lookbook (key art)

_The visual language: palette, grain, lens feel, lighting, aspect ratio, reference frames. This is the **key art** this profile produces (`produces_designs: true`) — HTML lookbook boards + reference frames live in `designs/` and lock at the **{{vocab.freeze_gate_noun}}** gate. Each locked board becomes a `D-NN` design id and feeds the Studio archetype / block style so every generated shot reads as one film._

- **Aspect ratio / format:**
- **Palette + grade:**
- **Lens / grain / motion feel:**
- **Reference frames:** _(link `designs/*.html` boards)_
- **Type / title treatment:** _(if titles or lower-thirds appear)_

## Shotlist

_The bridge from treatment to Studio. Sequences (this plan's {{vocab.work_unit}}s, isolated by **{{vocab.isolation_axis}}**) break down into shots; shots are what Studio's shot board owns and renders. Keep this list at the **intent** level — shot description, framing, duration, which anchors/locations it uses — not the render state. Render state lives in `05-tracking.md` and, authoritatively, in the Studio project. Don't restate Studio's board here._

| Shot | Sequence | Scene · reel | Description | Framing / lens | Anchors · location | Est. duration |
|---|---|---|---|---|---|---|
| _e.g._ 12A | S3 | 3 · R1 | Ada opens the vault | CU, 50mm | `anchor_ada` · The Archive | 4s |
| | | | | | | |

## Schedule

_The production calendar — which sequences enter the pipeline when, and the dependency order. Generation, review, and re-render passes cost real wall-clock time (software-GPU renders run minutes per shot), so schedule around the render budget. The wave plan in `05-tracking.md` is the executable version of this._

- **Target {{vocab.freeze_gate_noun}} date:**
- **Sequence order + dates:** _(feeds the wave plan)_
- **Hard external dates:** _(deliverable deadlines, festival cutoffs, talent windows)_

## Budget

_What this film costs to produce — compute/render spend, licensed assets, stock, music, voice, human review time. Track per-sequence render cost against this ceiling; the `05-tracking.md` status table carries the per-shot cost column that rolls up here._

| Line | Est. cost | Actual | Notes |
|---|---|---|---|
| _e.g._ Render compute | | | ~2.4 min/shot software-GPU |
| _e.g._ Licensed music | | | |
| _e.g._ Voice / narration | | | |
| **Total** | | | Against ceiling: |

## Deliverables

_The concrete outputs this production ships — masters, cutdowns, key art, captions. Each final deliverable is composed in Studio (`mcp__studio__export_compose`) from approved shots. One row per deliverable; each references the Studio project + export bed it comes from._

| Deliverable | Spec (ratio · length · codec) | Channel / destination | Studio export | Owner |
|---|---|---|---|---|
| _e.g._ Master | 16:9 · 90s · ProRes | Festival | export bed A | |
| _e.g._ Social cutdown | 9:16 · 30s · H.264 | Instagram | export bed B | |

## Handoff to the shot board

_**Boundary — read this before duplicating anything.** This plan owns creative development and production management **around** execution: logline, treatment, cast/character bible, locations, look/lookbook, shotlist, schedule, budget, deliverables. It does **not** own the shot board. At execution time your **shot board** — cells, storyboard beats, render engine, per-shot approval, export beds — is the authoritative tracker, and this plan defers to it. In an Ikenga workspace that board is `com.ikenga.studio`, and the tool references throughout this template (`mcp__studio__*`) name its verbs; swap them for whatever board you actually run. Record which board backs this film below._

The handoff contract:

- **This plan → Studio project.** One Studio project backs this film. Record its id/path here: `_Studio project:_ ______`.
- **Cast bible → Studio anchors.** Each principal's `anchor_*` id (Cast table above) is created in the Studio project and reused across every shot for consistency.
- **Lookbook (`D-NN`) → Studio style.** Locked key-art boards set the archetype / block style so shots share one look.
- **Shotlist → Studio shot board.** Each shot becomes a storyboard cell; **Studio owns its render/approve state**, not this plan. `05-tracking.md` here is a thin **status mirror** of the Studio board for production management (what's approved, what it cost) — never a second source of truth. When they disagree, Studio wins.
- **Approved shots → deliverables.** Final masters/cutdowns compose in Studio (`export_compose`) from approved shots; the Deliverables table records the mapping.

_Rule of thumb: if it's a creative or scheduling decision, it lives here. If it's a shot's render state, it lives in Studio._

## Risks + alternatives

_What could go wrong — a lookbook slips and shots drift off-look, an anchor loses consistency mid-sequence, render budget overruns, a location fails to generate cleanly — and what approaches were considered and rejected. The review action augments this section as Rounds surface new risks; original entries stay._

## ID registry

The full ID registry is in `.groundwork.json.ids`. Local cross-reference index (rendered by `groundwork review`):

<!-- groundwork:auto:start ids -->
<!-- last_action: init · {{date}} -->
_No IDs allocated yet. The review action populates this index._
<!-- groundwork:auto:end ids -->

## Verification

_How we'll know each phase is done. Each item must be observable — a sequence's shots approved in Studio, the lookbook locked at {{vocab.freeze_gate_noun}}, a deliverable exported and delivered — not "the film looks good." Group by phase; later phases stay at sketch depth until current._
