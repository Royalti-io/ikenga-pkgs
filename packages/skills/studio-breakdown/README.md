# @ikenga/studio-breakdown

Script → storyboard, in one pass. Segments a script into shots (cells) and extracts the recurring characters, locations, and props as reusable, seed-lockable anchors — the "populate the board + asset checklist" step for `com.ikenga.studio`.

**It generates nothing and spends nothing.** Breakdown proposes a board; a human reviews it, locks/generates the anchor plates, approves shots, then generates video. That separation is the supervised-loop contract.

## Install

```
/plugin marketplace add ikenga-hq/marketplace
/plugin install studio-breakdown@ikenga
```

## Use

With a Studio project open (via the `com.ikenga.studio` MCP):

```
studio-breakdown --project <slug>
```

The agent reads the project's script (`storyboard.read_fountain` for narrative projects, or provided text), creates one `Cell` per shot with shot/camera metadata + a draft prompt, and creates one `Anchor` per distinct character/location/prop/style. Everything lands at rung 0 as an approvable proposal.

See `skills/studio-breakdown/SKILL.md` for the full procedure and output contract.

## Peer

Validates against `Cell` / `Anchor` / `ScriptBeat` from **@ikenga/studio-schema** (provided by the Studio app at runtime). For music videos, composes with **@ikenga/studio-beat-detect**.

## License

Apache-2.0.
