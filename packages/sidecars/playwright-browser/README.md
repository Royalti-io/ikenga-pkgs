# @ikenga/sidecar-playwright-browser

Playwright verb engine behind Ikenga's `/iyke/browser/*` contract — the replacement for the Rust chromiumoxide Chrome engine ([ADR-018](../../../../docs/adr/018-chrome-automation-adopt-playwright.md), plan: `plans/playwright-adoption/`).

## Status — WP-03 (the verb engine)

`src/engine.ts` is **built + tested green** (`bun install && node --test --import=tsx 'src/**/*.test.ts'`). It implements the verb contract via **Playwright-native locators** (auto-waiting/actionability — the point of adopting Playwright), with a mode-agnostic `data-ik-ref` ref scheme so the same path works for both modes.

| Verb | Playwright | Notes |
|---|---|---|
| `open` | `launchPersistentContext({channel:"chrome"})` (managed) / extension (attach, WP-02) | per-pane session registry |
| `snapshot` | re-tag interactive els → `e<N>` refs | refs invalidate on next snapshot (contract) |
| `click` / `fill` / `select` / `press_key` | `locator(...).click/fill/...` | auto-wait + actionability |
| `eval` | `page.evaluate("(() => { …script… })()")` | honors the IIFE-`return` contract (shell PR #46) |
| `screenshot` | `page.screenshot()` | base64 PNG (the verb WebKit 501'd) |
| `goto`/`back`/`forward`/`reload`/`wait_for` | native Playwright | |

**Modes:** `managed` (dedicated profile, no extension — testable now) is live; `attach` (everyday Chrome via the official Playwright extension) throws a clear error until **WP-02** wires the extension pairing.

## Remaining (WP-04)
- `src/sidecar.ts` — stdio-JSON wrapper exposing these methods to the kernel sidecar runtime.
- Bridge routing: `/iyke/browser/*` with `mode:attach|managed` → this sidecar; WebKit stays the default.
- Then **WP-06** deletes the Rust engine.
