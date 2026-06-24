---
"@ikenga/mcp-browser": minor
---

Add an `engine` discriminant to the browser MCP so agents can target Managed-mode Chrome. `browser_open` gains an optional `engine: "webkit" | "chrome"` (default `"webkit"`) that is forwarded in the open body and reported in the result; `browser_list` now surfaces each pane's `engine`. The wire shape stays engine-agnostic — the shell fixes the engine at open and later verbs inherit it via the pane id. Requires `@ikenga/contract@^0.11.0` (the `BROWSER_ENGINES` discriminant). chrome-pkg WP-08.
