<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# {{plan_title}} — design-system plan

## Goal

<!-- groundwork:auto:start goal -->
<!-- last_action: init · {{date}} -->
{{goal}}
<!-- groundwork:auto:end goal -->

## Mode

`<brownfield | greenfield>` — set at init.
- **Brownfield:** the app has code/designs. Master list = inventory of routes/components; ground truth = the code; per-part §1 documents what exists + gaps; mockups reproduce-then-enhance; fixtures salvaged from existing data.
- **Greenfield:** no reference. Master list = derived from job stories → IA (content inventory → card sort → sitemap → user flows); ground truth = requirements; per-part §1 starts with a job story + success metric; mockups designed net-new from wireframes; fixtures invented as a canonical universe.

## Context

_Why now, what's at stake, who it's for._

## Taxonomy

Master list grouped: **Foundations → Components → Patterns → Screens (+ Content)**. (See `00-README.md` for the full breakdown.) Build **Foundations first** — every other part composes from its tokens + chrome.

## Token architecture

Source of truth = DTCG `foundations/tokens/*.tokens.json`, three tiers:
- **Primitive** (raw palette/scale, no references) → **Semantic** (intent: `color-action-primary`, themed light/dark by remapping primitives) → **Component** (optional; only where semantic isn't enough).
- Build with Style Dictionary v4 (`usesDtcg:true`) → a Tailwind v4 `@theme` block + CSS vars + a generated token reference page. JSON is the source; `@theme`/CSS is the artifact.
- *Brownfield:* round-trip from the existing `@theme`/`globals.css` into `tokens.json`. *Greenfield:* author `tokens.json` first; it works with zero app code.

## Phases

> Foundations → then domain by domain. Detail the current phase; sketch the next; stub the rest.

- **Phase 0 — Foundations** _(current)_ — tokens, theming, primitives, chrome (shells/nav), shared patterns (table, empty/error/loading).
- **Phase 1..N — by domain/tier** — Components → Patterns → Screens, in priority order.
- **Cross-cutting layers** (any horizontal capability that spans many screens — e.g. search, notifications, permissions, an assistant) — research + a concept spike *before* the screens they touch, so the pattern is inherited not retrofitted. Capture as a `decision-doc` subplan.

## The per-part loop

research §1–2 → design (≥2 variants on `_fixtures` + live tokens, lock one) → review + `quality-gate.md` → set `stable` + tick `05` → refresh gallery.

## Quality gate

Every part passes `quality-gate.md` (Nielsen's 10 + WCAG 2.2 AA) before locking. Cross-cutting concerns (responsive, a11y, motion, empty/loading/error) are captured per-part, not as separate parts.

## Risks + alternatives

_Drift over time (mitigate: the loop + `groundwork status` + in-repo versioning). Mockups diverging from real chrome (capture in-chrome). Scope (waves are independently shippable; foundations unblock the rest)._

## ID registry

<!-- groundwork:auto:start ids -->
<!-- last_action: init · {{date}} -->
_No IDs allocated yet. The review action populates this index._
<!-- groundwork:auto:end ids -->

## Verification

- `groundwork status` clean; every route/screen maps to exactly one part in `05` (no orphans).
- The gallery (`designs/index.html`) renders all tiers with correct locked/total counts.
- One part fully locked end-to-end (doc + mockup rendering in a browser on fixtures + live tokens + **quality gate passed**) proves the loop.
- Tokens build: `tokens.json` → `@theme`/CSS + reference page generate cleanly.
