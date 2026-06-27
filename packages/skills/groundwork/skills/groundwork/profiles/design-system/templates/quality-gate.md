<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# Quality gate — per-part review checklist

Run at the **review** step of every part (with `groundwork review` / `impeccable`), before flipping it to `stable`/locked. Pass/fail each item; record blockers. Condensed from Nielsen's 10 heuristics + WCAG 2.2 **AA**.

> Part: ______________  ·  Reviewer: ______  ·  Date: ______

## Nielsen's 10 usability heuristics
- [ ] **H1 Status** — loading / progress / feedback present; multi-step shows where you are.
- [ ] **H2 Real-world language** — user vocabulary, not jargon/codes; logical order.
- [ ] **H3 Control & freedom** — cancel / back / undo always available; no dead ends.
- [ ] **H4 Consistency** — fonts, colors, buttons, terms match the system + platform conventions.
- [ ] **H5 Error prevention** — inline validation; destructive actions confirmed; constraints shown upfront.
- [ ] **H6 Recognition not recall** — options/actions visible; icons labeled; suggestions reduce memory load.
- [ ] **H7 Flexibility & efficiency** — shortcuts/accelerators for power users; novice + expert paths.
- [ ] **H8 Aesthetic & minimal** — every element earns its place; whitespace organizes hierarchy.
- [ ] **H9 Error recovery** — plain-language, specific, blame-free messages with a next step.
- [ ] **H10 Help** — findable from the screen; contextual near complex interactions.

## WCAG 2.2 AA quick-check
**Perceivable**
- [ ] 1.1.1 images/icons/controls have accessible names
- [ ] 1.3.1 headings/labels/lists semantically marked up (not just styled)
- [ ] 1.4.1 information not conveyed by color alone
- [ ] 1.4.3 text contrast ≥4.5:1 (small) / ≥3:1 (large/bold)
- [ ] 1.4.11 UI components (inputs/buttons/icons) ≥3:1 vs background

**Operable**
- [ ] 2.1.1 fully keyboard-operable · 2.1.2 no keyboard trap
- [ ] 2.4.3 logical focus order · 2.4.7 focus indicator always visible
- [ ] 2.4.11 **[2.2]** focused element not obscured by sticky headers/footers
- [ ] 2.5.7 **[2.2]** drag actions have a non-drag alternative
- [ ] 2.5.8 **[2.2]** interactive targets ≥24×24 CSS px (or adequate spacing)

**Understandable**
- [ ] 3.3.1 errors identify the field in text · 3.3.2 visible labels; required marked
- [ ] 3.3.4 legal/financial/delete actions: review step or undo
- [ ] 3.3.7 **[2.2]** no redundant re-entry of prior data
- [ ] 3.3.8 **[2.2]** accessible auth (no cognitive test; password paste allowed)

**Robust**
- [ ] 4.1.2 components expose name/role/state to assistive tech
- [ ] 4.1.3 dynamic status messages announced without stealing focus

## Outcome
Nielsen: __/10 · WCAG AA: __/16 · **Gate:** ☐ PASS ☐ PASS WITH NOTES ☐ FAIL (rework)

*(16 WCAG checkbox items covering 20 distinct 2.2 AA success criteria — some lines pair two related criteria.)*
