<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# {{plan_title}} — design-system planning folder

Living design system + UX capture for **{{plan_title}}**. Built with the [groundwork](https://github.com/royalti-io/groundwork) `design-system` profile.

> **Mode:** `brownfield` (has code — inventory + enhance) · `greenfield` (no reference — design from requirements). **Set this at init →** `<brownfield | greenfield>`. Ground truth is the **code** (brownfield) or the **requirements/job-stories** (greenfield).

## What's here

<!-- groundwork:auto:start spine-index -->
<!-- last_action: init · {{date}} -->
| File | What it is | When to read |
|---|---|---|
| [`01-plan.md`](01-plan.md) | The plan: mode, taxonomy, token architecture, phases, the per-part loop, verification. | Before starting. Source of truth. |
| [`02-research-external.md`](02-research-external.md) | Outside research — competitive/field scan, conventions. Cited URLs. | When questioning a design choice. |
| [`03-research-internal.md`](03-research-internal.md) | Inside research — code audit (brownfield) or domain/user research (greenfield). | When weighing reuse-vs-build. |
| [`04-discussion.md`](04-discussion.md) | Newest-first "Round N" decision log. | When the *why* isn't obvious. |
| [`05-tracking.md`](05-tracking.md) | **Master checklist of every part**, grouped Foundations → Components → Patterns → Screens, with maturity. | While working. Check off as parts lock. |
| [`parts-template.md`](parts-template.md) | The reusable per-part template (copy to `parts/<tier>/<part>.md`). | Starting any new part. |
| [`quality-gate.md`](quality-gate.md) | Nielsen heuristics + WCAG 2.2 AA review checklist. | At each part's review step. |
| `parts/<tier>/<part>.md` | One filled per part (the {{vocab.work_unit}} doc). | Per part. |
| `designs/index.html` | **The navigable living gallery** — every part by tier, status, live mockup thumbnails. *(create in session 1)* | The home page. Open first. |
| `designs/<part>.html` | Locked hi-fi mockup per part, on the canonical fixtures + live tokens. | Visual reference. |
| `designs/_fixtures/` | The canonical data universe (one cast/world all mockups share). *(create in session 1)* | Building any mockup. |
| `foundations/tokens/` | DTCG `*.tokens.json` source-of-truth → generates the `@theme`/CSS + a token reference. *(create in session 1)* | Token work. |
| `.groundwork.json` | Plan state anchor. | Read by every action. |
<!-- groundwork:auto:end spine-index -->

## Taxonomy (the master list is grouped by these tiers)

1. **Foundations** — design tokens (primitive → semantic → component), color, type, spacing, radius, shadow, motion. Chrome (shells/nav) lives here too.
2. **Components** — grouped by function: Actions · Inputs · Navigation · Feedback · Display · Layout · Overlay.
3. **Patterns** — multi-component recipes: forms, empty/error/loading states, search & filter, onboarding, notifications.
4. **Screens** — instances + their states (empty/loading/error/populated/mobile).
5. **Content** — voice & tone, UX writing, error copy. *(optional tier)*

## Maturity

`draft → alpha → beta → stable → deprecated`. Checkboxes in `05`: `[ ]`=draft · `[~]`=alpha/beta · `[x]`=stable (locked) · `[!]`=blocked. A part is **locked** when its doc is complete, a mockup is locked, and the **quality gate passed**.

## The per-part loop

research §1–2 (content-first gate) → `groundwork design` (≥2 variants on `_fixtures` + live tokens, lock one) → `groundwork review` + `quality-gate.md` → set `stable` + tick `05` → refresh the gallery.

## First session — create these (kept out of the auto-scaffold so the renderer never touches their JS/JSON)
1. `foundations/tokens/` — DTCG token source + a generated reference (see `01-plan.md` §Token architecture).
2. `designs/_fixtures/README.md` — the canonical cast/world all mockups use.
3. `designs/index.html` — the gallery (data-driven from `05`).

## Status

<!-- groundwork:auto:start status-block -->
<!-- last_action: init · {{date}} -->
- **Mode:** _set at init (brownfield | greenfield)_
- **Profile:** `{{profile}}`
- **Spine version:** 1
- **Parts locked:** _none yet_
- **Last review pass:** _none yet_
- **Research stamped:** _{{date}}_
<!-- groundwork:auto:end status-block -->

Hand-written prose is sacred: every action writes only inside `<!-- groundwork:auto:start ID -->` fences.
