# action: pkg-onboard — build your first package

The most common way to contribute to Ikenga is a **package**, not a platform
change. This action orients a new author, then hands the mechanics to the
purpose-built `ikenga-pkg-builder` skill — it does **not** reimplement scaffolding.

## What it does

1. **Orient — what are you building?** A pkg contributes one or more of: a UI panel
   (iframe / webview), tools the AI engine can call (MCP server), a new AI backend
   (engine adapter), a supervised background worker (sidecar), or skills/commands
   only. Help the author name the archetype with a short `AskUserQuestion`:

   | You want… | Archetype |
   |---|---|
   | A panel rendering your own UI in the shell | `ui-iframe` |
   | To drive a third-party site that blocks iframes | `ui-webview` |
   | Tools the engine can call | `mcp-server` |
   | A new AI backend | `engine` |
   | A supervised background worker | `sidecar` |
   | Skills / commands / agents only | `skill-only` |

   Point them at [Build your first pkg](https://ikenga.dev/docs/build-a-pkg) and the
   [Pkgs](https://ikenga.dev/docs/pkgs) archetype matrix for the full picture.

2. **Delegate the scaffold.** Invoke the `ikenga-pkg-builder` skill (via the `Skill`
   tool) with the chosen archetype + identity. It runs the real interview
   (id/slug/permissions) and scaffolds from the canonical templates, then can
   hot-mount via `ikenga dev` if the CLI is on `$PATH`. If `ikenga-pkg-builder`
   isn't installed, tell the author to add it and point them at
   `docs/pkg-patterns/` + `_templates/` in the shell repo as the manual path.

3. **Dev loop.** Remind them of the hot-mount loop: `ikenga dev <path>` watches the
   manifest + reload globs and re-registers on save; `Ctrl-C` unregisters cleanly.

4. **Publish path (when ready).** Most pkgs live in the `ikenga-pkgs` monorepo and
   ship via Changesets:
   - Drop the pkg under `ikenga-pkgs/packages/<type>/<slug>/`.
   - Add a changeset (`pnpm changeset`).
   - Open a PR (hand off to `pr-workflow` for the commit/changeset/PR mechanics).
   - On merge, the registry + `npx skills add` / Ọba catalog pick it up.

   For a standalone skill repo instead, the install path is
   `npx skills add ikenga-hq/<repo>`.

## Notes

- This action is a thin orchestrator: orient → delegate to `ikenga-pkg-builder` →
  remind about publishing. Don't duplicate the builder's interview or the
  authoring guides; link to them.
- Carving a pkg out into its own standalone repo (vs the monorepo) requires an ADR —
  default to `ikenga-pkgs`.
