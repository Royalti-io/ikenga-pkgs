---
name: studio-archetype-build
description: Interview the user to design a custom archetype — chain existing blocks into an ordered sequence with per-instance bindings — then save it as a custom archetype.json via archetype.save_custom.
---

# studio-archetype-build

Author a **custom** archetype by chaining existing blocks.

## What it does

1. Interviews the user: what's the video for, how long, what beats matter.
2. Lists available blocks (`block.list`) so you can pick atoms by `kind` (hook / beat / transition / cta / …).
3. Builds an ordered `chain[]` of `{ block_id, bindings }` entries, where `bindings` map each block's parameter names to values.
4. Validates the draft against `ArchetypeSchema` (from `@ikenga/studio-schema`).
5. Saves via MCP `archetype.save_custom`, which writes `<project>/archetypes/<id>/archetype.json`. Custom archetypes are then discoverable alongside the seven built-ins.

## Output shape

```jsonc
{
  "id": "product-demo-30s",
  "name": "Product demo (30s)",
  "description": "...",
  "builtin": false,
  "chain": [
    { "block_id": "hook.stat", "bindings": { "stat": "10x faster" } },
    { "block_id": "beat.demo", "bindings": {} },
    { "block_id": "cta.talk-to-us", "bindings": {} }
  ],
  "default_total_duration_ms": 30000,
  "metadata": {}
}
```

## Usage

```
/studio-archetype-build
# → interview → pick blocks → save custom archetype → instantiate into a project
```

To author a brand-new *block* (not just chain existing ones), use `studio-block-author`.
