# @ikenga/studio-breakdown

## 0.2.0

### Minor Changes

- [#43](https://github.com/Royalti-io/ikenga-pkgs/pull/43) [`12f7128`](https://github.com/Royalti-io/ikenga-pkgs/commit/12f7128dad658951e44434e4f796e8dd4dabd9c8) Thanks [@nedjamez](https://github.com/nedjamez)! - Fix the tag procedure to resolve against real boards. The step-4 tag-writeback
  this corrects has not shipped yet (it is unreleased in
  `studio-breakdown-tag-writeback`), and as written it was **wrong on any board the
  skill did not author itself** — which is precisely the retag case it exists to
  serve.

  **The false invariant.** Step 2 declared `label` to be "the OTIO shot id
  `sc<N>_sh<M>`" and step 4 told the Chi to tag with "the same `sc<N>_sh<M>` id you
  set in step 2". That holds only for boards this skill minted. Verified against
  the real `ikenga-forge` board: cell `c1-forge` has `label: "Forge glowing"`
  (prose) while the other five happen to be `sc1_sh2..sc1_sh6`. Breakdown resolves
  a shot as `label || beat_id || uid` and indexes `{shotId → shot, uid → shot}`, so
  a Chi trusting the invariant writes `[[sc1_sh1]]`, which is **not a key in that
  map at all** — shot 1 unlinks silently. The rail then draws 5 of 6 lines and the
  "tag this script" affordance disappears (it only renders when `railIds` is
  empty), removing the user's only in-rail escape. A confident 5/6 rail is exactly
  what D-1a exists to prevent.

  The skill now **reads the live board (`storyboard.list_cells`) and tags with each
  cell's `uid`**, verified character-identical against that board before writing.
  `uid` is schema-required, unique per board, and inserted into Breakdown's lookup
  last, so it wins collisions — it is the only key guaranteed to resolve on any
  board, whoever built it. Never assume an id from a naming convention.

  **`beat_id` is not a key.** The old step 4 claimed a tag matching any cell's
  "`label`/`beat_id`/`uid`" would link. `beat_id` is only reachable when `label` is
  empty; a non-empty `label` shadows it completely. On `c1-forge` — `beat_id` _is_
  `sc1_sh1` — tagging by `beat_id` fails on the exact cell where it matters. That
  sentence manufactured the bug above; it is gone.

  **Retag branch added.** Old step 4 scoped tagging to shots "you just created",
  while the only path that reaches it (the pane's CTA, and `breakdown.run`'s
  `ambiguous-needs-chi` hand-off) forbids creating cells — two contradicting
  instructions on the one path that matters. The branch is now explicit and chosen
  by `list_cells`, not by intent: non-empty board → create/delete/reorder nothing,
  match paragraphs to existing cells by reading both, tag by `uid`. Counts are
  expected to disagree (the forge script: 8 action paragraphs, 6 cells — a scene's
  establishing prose has no cell and shouldn't get one), so nth-paragraph→nth-cell
  is called out as wrong. Anything not confidently matched is left untagged and
  reported.

  **Step 2's field table completed.** It omitted `uid` — which `CellSchema`
  requires with no default — so a Chi following it literally got `invalid-args`
  instead of a cell. Executing `CellSchema.safeParse({})` shows ten required,
  defaultless fields; the table was missing six of them (`uid`, `index`, `time`,
  `frames`, `content_path`, `rungs`, `last_edited`) and now documents all ten,
  with `cells/beatsheet/<uid>/content.html` (the short `rungDir` token, not the
  enum value) for `content_path`.

  Also corrects two enum errors found while verifying: `camera_move` was
  advertised as `static/pan/tilt/dolly/push-in/orbit/handheld…`, but `push-in` is
  not in `CameraMoveSchema` and is rejected as `invalid_enum_value`, failing the
  whole `create_cell` (a scripted "slow push-in" is `dolly` or `zoom-in`); and
  `shot_type`'s default guidance changes from a guessed `ms` to the honest `unset`,
  matching what `breakdown.run` already writes.

- [#43](https://github.com/Royalti-io/ikenga-pkgs/pull/43) [`12f7128`](https://github.com/Royalti-io/ikenga-pkgs/commit/12f7128dad658951e44434e4f796e8dd4dabd9c8) Thanks [@nedjamez](https://github.com/nedjamez)! - Teach the skill to write shot tags back into `script.fountain`. This is the
  procedure the Studio Breakdown pane's "Send to your Chi" CTA asks for, and the
  skill had no such step — previously nothing in it mentioned `[[` tags or
  `storyboard.write_fountain` at all, so the request had nowhere to land. The
  skill is the single source of truth for the tag procedure; the pane sends the
  request to your Chi rather than carrying its own copy of the steps.

  New step 4 ("Tag the script", narrative projects only). After segmenting shots:
  `storyboard.list_cells` → `storyboard.read_fountain` → append a `[[<uid>]]`
  Fountain note to each action paragraph you matched to a cell →
  `storyboard.write_fountain` with the **entire** modified script. The tag value
  is the cell's `uid`, read off the live board and verified character-identical
  against it before writing — never assumed from a naming convention.

  Two branches, chosen by what `list_cells` actually returns rather than by
  intent:

  - **Scaffold** — the board was empty and step 2 minted the cells, so their uids
    are already known to resolve.
  - **Retag** — the board already has cells: create, delete and reorder nothing;
    match paragraphs to the existing cells by reading both, and add notes only.
    This is the branch the pane's CTA and `breakdown.run`'s `ambiguous-needs-chi`
    hand-off both land in, and counts are expected to disagree (an establishing
    paragraph has no cell and shouldn't get one), so nth-paragraph→nth-cell is
    called out as wrong.

  The step spells out the sharp edges: `write_fountain` is a wholesale overwrite
  with no patch/append API, so sending back anything less than the complete script
  destroys the rest of the file; a paragraph already carrying a correct tag is
  left alone rather than having a second note stacked on it, and a tag that
  _disagrees_ with your reading is a stop-and-report, never an overwrite of a
  human's authored link; and a paragraph or cell you cannot confidently match is
  left untagged and reported by uid — an untagged paragraph draws no line, while a
  wrong one draws a confident wrong line, which is worse.

  Step 2 now gates on `list_cells` before creating anything (a parallel set of
  shots alongside someone's existing board is the one unrecoverable mistake in
  this skill), and drops a field that does not exist: `Cell` has no `shot_id`
  (that name exists only on `ScriptBeat`, a different object), so an id written
  there was silently stripped and the shot became unlinkable.

  Also updates the skill's `description` to name the tagging step (it drives when
  the skill gets picked up), and the Output contract and Anti-patterns to match —
  `read_fountain` now promises that tagged paragraphs carry a `[[<uid>]]` note
  naming a cell that exists on this board, verified against `list_cells` rather
  than assumed, and that paragraphs with no confident match carry no note.

  No change to the skill's spend or generation guarantees — still populate-only,
  zero spend, never `render.enqueue` / `anchor.generate`, never invents beats,
  never advances a cell past rung 0.

## 0.1.0

Initial release. Script → storyboard breakdown: segment a script into shots (cells) with OTIO scene/shot ids + shot/camera metadata + draft prompts, and extract recurring characters/locations/props/style as reusable anchors. Populate-only — no generation, no spend; leaves the board as an approvable proposal at rung 0. Backs the AI-filmmaker workflow (`plans/studio/16-ai-filmmaker-workflow.md`, Stage 2).
