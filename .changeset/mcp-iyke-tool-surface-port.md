---
"@ikenga/mcp-iyke": minor
---

Port 11 commits of MCP tool surface from the legacy `Royalti-io/ikenga-pkg-mcp-iyke` clone that had diverged after the subtree-add in `9134a94`. Brings the canonical monorepo copy up to date so the legacy clone can be archived.

Tools added / updated:

- `iyke_open` — adds `artifact-studio` kind with `density` (grid / loupe / compare) and `vs` (second artifact path for compare). `artifact-grid` kept as a back-compat alias.
- `iyke_pin_read` / `iyke_pin_acknowledge` / `iyke_pin_resolve` — artifact-grid pin lifecycle from the chat dispatcher loop.
- `iyke_pkg_violations_list` + shell.execute declaration.
- `iyke_pkg_trust_status` / `iyke_pkg_trust_list` (Phase 9 trust tools).
- `iyke_secret_get` / `iyke_secret_set` / `iyke_secret_delete` / `iyke_secret_list` (Phase 7 secret tools).
- `iyke_layout_get` / `iyke_layout_reset` (Phase 6 layout tools).
- Phase 5 MCP tools + carry-forward pins listing.
- Claude asset tools — list / pin / unpin (Phase 4).
- Session tools — list / move (Phase 3 projects-first-class).
- Pkg scope tools — list / scope-set / uninstall.
- Timer tools — schedule / cancel / list.
- Phase 0 project tools + Phase 1 memory primitives.

Original commits (preserved by ref): `ee3766b 8fc1106 e574601 0104532 68270e9 e7331bb 38074ae 597a740 1344900 9918986 06c1632`.
