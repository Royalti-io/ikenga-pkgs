---
"@ikenga/skill-groundwork": patch
---

Reverse the groundwork sync. The canonical source of truth is now the standalone repo `royalti-io/groundwork` (the same repo `npx skills add` installs from); this package holds a generated copy synced one-way from it via `pnpm sync:from-canonical`, purely for the npm publish. Retires the old forward flow (`sync-from-dev` + `build-mirror` force-push). The published skill tree is brought current with canonical (adds the design-system `quality-gate` template, updates `groundwork_state.py`, re-banners synced files to point at the canonical repo). Install path and npm identity are unchanged.
