---
"@ikenga/skill-groundwork": minor
---

Initial release of `@ikenga/skill-groundwork` — the canonical, ADR-009 home for the `groundwork` Claude Code skill (research → design → plan → orchestrate → act). The skill tree is synced one-way from the workspace dev source via `scripts/sync-from-dev.mjs` (every synced file carries a GENERATED banner; the dev copy stays the editable source of truth). `scripts/build-mirror.mjs` emits a standalone mirror-repo tree (package.json + install.sh + README + LICENSE + `skills/groundwork/`) that becomes the `npx skills add royalti-io/groundwork` install surface. A `PORTABILITY.md` ships inside the skill, disclosing the this-workspace `plans/studio` / `plans/groundwork` doc references and the standalone board's runtime fallbacks as a known, deferred limitation (document-don't-fix).
