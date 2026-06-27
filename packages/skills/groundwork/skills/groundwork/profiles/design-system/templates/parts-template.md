<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
<!--
  REUSABLE PER-PART TEMPLATE — design-system profile
  Copy to parts/<tier>/<part>.md and fill in. One "part" = one
  foundation token-set, component, pattern, OR screen.

  LOOP (content-first):
    1. Fill §1 (+ §2) BEFORE designing — the research gate.
       · brownfield: document what exists + gaps (ground truth = the code)
       · greenfield: write the job story + success metric first (ground truth = requirements)
    2. groundwork design → ≥2 variants on the canonical fixtures + live tokens; lock one to designs/<part>.html. Fill §3.
    3. groundwork review / impeccable → run quality-gate.md (Nielsen + WCAG 2.2 AA). Fill §4.
    4. Set status to `stable` here AND tick the box in 05-tracking. Update the gallery.
  LOCKED = all sections done + locked mockup + quality gate passed.
  DATA: use the canonical fixture universe (designs/_fixtures/README.md) — never invent names/values.
-->

# <Part name>

| | |
|---|---|
| **Status** | draft · alpha · beta · **stable** · deprecated  ← set one (maturity) |
| **Tier** | foundation · component · pattern · screen |
| **Type / group** | e.g. component→Actions / Inputs / Navigation / Feedback / Display / Layout / Overlay |
| **Route(s)** | `<path>` (screens) · n/a (shared) |
| **Roles** | who uses it |
| **Mockup** | `designs/<part>.html` |
| **Code** | `<paths>` (brownfield) · n/a-yet (greenfield) |

---

## 1. Content & Requirements  — FILL BEFORE DESIGN

**Brownfield (has code):**
- Purpose / job-to-be-done · who uses it & why · data shown (+ API) · key actions/outcomes · business rules · **gaps** (what's missing/broken/drifted).

**Greenfield (no reference):**
- **Job story:** When `<situation>`, I want to `<motivation>`, so I can `<outcome>`.
- **Users / roles:** primary · secondary · excluded.
- **Success metric (HEART → GSM):** focus `<Happiness|Engagement|Adoption|Retention|Task-success>` · Goal `<outcome>` · Signal `<observable behavior>` · Metric `<number + timeframe>`.
- **Content:** must contain · must not contain · edge cases (empty/loading/error).

## 2. Chrome & Navigation
- Layout shell · IA placement / breadcrumb · entry points · exits · responsive behavior.
- *(greenfield)* flow position: enters-from / exits-to / which user flow(s).

## 3. Interaction & State
- States: default · loading · empty · error · success.
- Element states: hover / focus / active / disabled / selected.
- Flow & validation · motion (durations + easing; honor `prefers-reduced-motion`).

## 4. Handoff
- **Tokens:** color / type / spacing / radius / shadow / motion used.
- **Composition:** primitives + custom components reused (cite paths/names).
- **Props / variants** · **responsive** · **accessibility** (roles, labels, focus, contrast, keyboard) · **API** (endpoint + shape).
- **Do / Don't:**
  - ✅ Do: `<the right way>`
  - ❌ Don't: `<the anti-pattern>`
- **Quality gate:** `[ ]` passed `quality-gate.md` (Nielsen + WCAG 2.2 AA) — reviewer / date.
