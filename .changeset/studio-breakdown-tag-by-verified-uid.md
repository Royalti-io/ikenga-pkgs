---
"@ikenga/studio-breakdown": minor
---

Fix the tag procedure to resolve against real boards. The step-4 tag-writeback
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
empty; a non-empty `label` shadows it completely. On `c1-forge` — `beat_id` *is*
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
