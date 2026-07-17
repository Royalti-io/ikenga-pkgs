---
"@ikenga/pkg-studio": minor
---

Link the script to the storyboard: a deterministic `breakdown.run` verb, a
hand-off to your Chi for the judgment half, and a Breakdown rail that only
draws links it can prove.

- **New `breakdown.run` MCP tool** (+ matching sidecar RPC, registered in all
  three places a method needs: the `RpcMethod` union, the `EXTENDED_METHODS`
  set, and the `extended` switch — `tsc` cannot catch a missing set entry, it
  fails at runtime with `-32601`). It has **two modes, chosen automatically by
  whether the board already has cells**:
  - **Scaffold** (board empty) — mints one rung-0 cell per Fountain action
    paragraph with OTIO ids (`sc<N>` scene, `sc<N>_sh<M>` shot, used as both
    uid and `label`) and writes the matching `[[sc<N>_sh<M>]]` tags back into
    `script.fountain`.
  - **Retag** (board has cells) — creates **nothing**. Matches action
    paragraphs to the cells already there and writes only the tags, using each
    cell's uid as the tag value.

  Retag auto-matches **only when the reading is forced**: one paragraph per
  cell, in order, with no authored tag contradicting that order. Anything else
  returns `outcome: 'ambiguous-needs-chi'` with the real counts and a
  plain-language `detail`, and writes nothing — matching paragraphs to shots is
  judgment, and this server has no LLM. Branch on `outcome`: `scaffolded` |
  `retagged` | `already-tagged` | `ambiguous-needs-chi` | `script-write-failed`
  | `planned` (dry run). `dry_run: true` plans only and touches no disk.

  Mechanical only, by construction: `shot_type` / `camera_move` stay `'unset'`,
  `prompt` is `''`, `anchors` is `[]`, `duration_ms` is `0` — those need the
  `studio-breakdown` skill, and `run` refuses to guess them. Zero spend: the
  handler imports no renderer and no queue, so it can never reach
  `render.enqueue` or `anchor.generate`. Non-destructive: it never deletes or
  overwrites a cell, and never overwrites an authored `[[tag]]` — a tag that
  disagrees with the order match makes the call ambiguous instead of being
  clobbered. Every count it reports is measured; `script_bytes` is `null` when
  nothing was written rather than a placeholder.

- **The Breakdown rail is now tag-only, and this changes what you see.**
  Previously the rail linked script lines to shots **positionally**, and only
  when the action-paragraph count happened to equal the shot count — on a real
  hard-wrapped script the counts never matched, so no rail drew at all; on a
  script where they did match, the links were positional guesses. Both are
  gone. The rail now links a paragraph to a shot **only** via an explicit
  `[[tag]]` naming that shot's uid or id. A script with no tags yet gets no
  rail and says so ("rail: no `[[tags]]` in this script yet — nothing to
  link"), with a one-click "Send to your Chi" to go tag it. **If your board's
  counts previously lined up and drew a positional rail, it will now draw
  nothing until the script is tagged** — run `breakdown.run` or send it to your
  Chi. A drawn line is now always exact.

- **`permissions.engine: ["invoke"]`** added to the manifest (the same grant
  tasks/research/content already ship). Without it `host.sendToActiveSession`
  is scope-denied for Studio. This backs the "Send to your Chi" half of the
  Breakdown split CTA (Scaffold shots · Send to your Chi), wired in this same
  change via a typed `sendToChi(prompt, source?)` bridge helper. Refusals are
  surfaced honestly and distinctly: `scope-denied` names the shell's manifest
  check (the Chi never saw the request), `no-active-session` means a shell is
  present but no chat pane is focused, and `no-host` means standalone dev with
  no shell at all — it no longer tells you to focus a pane that cannot exist.

- **Engine chip now requires a finished render.** It composes `engine ▸ model`
  from a render record whose `status === 'done'` only. A queued, running,
  failed or cancelled render previously chipped "engine that rendered this
  shot" onto a shot that had rendered nothing; those now fall back to the
  labelled Track A/B pill.

- **Track A/B is labelled as the estimate it is**, and a capability matrix that
  failed to load is now a distinct third state (`unknown`) rather than being
  silently counted as Track B — a failed fetch no longer looks like a genuine
  all-Track-B board, and the tooltip no longer cites a matrix that isn't there.

- **No money on this board.** The cost strip is gone; the facts strip carries
  counts and the Track split only. The old `est $2.10` had no source — no price
  field exists on `EngineCapability`, and cost is only known post-hoc on a
  `RenderRecord`.

- **Internal type fix**: `EngineCapability.max_duration_ms` was typed `number`,
  but the fal adapter really reports `null` ("no advertised cap"); it is now
  `number | null`, and callers must read `null` as "unknown / no cap", not as
  zero. This is internal to this pkg's bundle — `@ikenga/pkg-studio` publishes
  a manifest plus built `dist/` and declares no `exports` map, so no consumer
  imports this type and nothing downstream breaks. Noted here because the
  in-repo callers changed, not because it is a public API break.

- The Fountain parser moved to `@ikenga/studio-schema/fountain` so the sidecar
  and the pane segment a script identically — one parser, no drift between what
  Breakdown shows and what the scaffold generates. The parser now joins
  hard-wrapped lines into whole paragraphs and lifts the title page out of the
  body (it used to leak `Title:` / `Credit:` / `Draft date:` in as the first
  action paragraphs of a phantom `UNTITLED` scene).

- Demo/standalone mode no longer invents results: `breakdown.run` there returns
  `outcome: 'demo-inert'` with `null` counts and says plainly that it did
  nothing, instead of reporting tags written against a JS template literal.
