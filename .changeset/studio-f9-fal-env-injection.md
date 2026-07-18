---
"@ikenga/pkg-studio": minor
---

F-9 — deliver the fal API key to the render sidecar from Stronghold in-shell.

The render sidecar reads its key from `process.env.FAL_KEY` (the `render-runner`
vault shim maps `studio.fal` → `process.env.FAL_KEY`), but nothing injected it
in-shell: it only worked when a launch-env `FAL_KEY` happened to be present, and
the shell's sanitized dev/reload respawn dropped it. The old comment claiming
"the real Stronghold vault surface replaces this" was false.

This declares the mapping on the `fal_api_key` **settings** secret via a new
`"env": "FAL_KEY"` field. The shell's pkg supervisor resolves that secret from
Stronghold (studio pkg scope) and injects `FAL_KEY` into the sidecar's env at
spawn — at BOTH spawn sites, so a dev-reloaded sidecar gets it too. This rides
the `settings` block, NOT `permissions.vault.keys`, so it introduces no
permission change and cannot park the pkg. A launch-env `FAL_KEY` remains the
headless/standalone fallback. The render-runner comment now states the true
contract.

Requires the shell-side supervisor injection (shipped separately in the shell).
