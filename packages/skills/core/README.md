# @ikenga/skill-core

The lean **dependency hub** for the Ikenga skill graph. Every domain skill
(tasks, mail, outbound, sales, finance, content, research, strategy) declares
`depends_on: ['skill-core']` — a one-way star (G-04). skill-core itself depends
on nothing.

## Install

```bash
npx skills add ikenga-hq/skill-core   # coming in the publish session
```

Or via the Ikenga CLI once the 3-copy publish sync is wired (see
[PUBLISHING.md](./PUBLISHING.md)).

## What it does

| Action | Mode | Description |
|---|---|---|
| `setup` | streaming | Infer the project's identity (brand, founder voice, product, ICP) and write `.atelier/skill-core/manifest.json` |

`setup` is the **only** action. skill-core is deliberately lean: no domain
logic, no shared lore / editorial bundle, no shared query / pipeline base
(those are deferred — R-03 query-collapse, R-04 pipeline base). Its single job
is to resolve the `depends_on: ['skill-core']` edge and localise the project
identity the domain skills read.

All `setup` does is write the project-config instance file
`.atelier/skill-core/manifest.json` via the host `fs` capability — **0 CRUD**,
no `sqlite`, no Supabase, no network.

## License

Apache-2.0 — see [LICENSE](../../LICENSE) (monorepo root).

## Phase

WP-15 (atelier Phase 4 prerequisite). Shipping this resolves the
`depends_on: ['skill-core']` edge that `@ikenga/skill-pa` — and every future
domain skill — already declares. Publish sync (npm + `ikenga-hq/skill-core`
mirror) is the supervised follow-up in [PUBLISHING.md](./PUBLISHING.md).
