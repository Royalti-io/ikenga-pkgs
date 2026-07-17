---
"@ikenga/studio-breakdown": minor
---

Teach the skill to write shot tags back into `script.fountain`. This is the
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
*disagrees* with your reading is a stop-and-report, never an overwrite of a
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
