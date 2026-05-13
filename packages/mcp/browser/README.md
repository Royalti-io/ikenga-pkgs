# @ikenga/mcp-browser

MCP server that lets agents drive native child webviews inside the
running Ikenga desktop app — open a pane on a partner portal (Spotify
for Artists, Bandcamp, Linkfire, Google sign-in, etc.), snapshot it,
click, fill, wait.

Bypasses iframe CSP `frame-ancestors` restrictions by using the system
webview (`add_child` on macOS/Windows, borderless top-level on Linux).

## Tools

| Tool | Use |
|------|-----|
| `browser_open` | Open a new pane navigated to a URL. Returns `b1, b2, …`. |
| `browser_close` | Close a pane (cookie partition on disk is preserved). |
| `browser_list` | List open panes owned by this MCP. |
| `browser_focus` | No-op on v1 (kernel doesn't yet expose focus). |
| `browser_goto` | Navigate a pane to a new URL. |
| `browser_back` / `browser_forward` / `browser_reload` | History controls. |
| `browser_snapshot` | Accessibility-tree snapshot with stable `e0, e1, …` refs. |
| `browser_read_text` | Read one element's text by ref. |
| `browser_click` / `browser_fill` / `browser_select` / `browser_press_key` | Interactions; specify a ref (preferred), selector, or text. |
| `browser_wait_for` | Wait until url / text / ref / idle. |
| `browser_eval` | Escape hatch — evaluate arbitrary JS in the pane. |
| `browser_screenshot` | Not implemented yet (Phase 4+). |

## How it works

The MCP reads the same `control.json` the Iyke MCP and CLI use to
discover the desktop app's localhost bridge (port + bearer token). All
calls go to `/iyke/browser/*` on that bridge.

Snapshot/interaction tools eval a small helper inside the child webview
that POSTs results back to a per-request `/iyke/browser/_reply` endpoint;
that endpoint validates a per-request `oneshot_token` (not the global
bearer) so partner-site JS can't impersonate replies or learn the bearer.

The MCP itself is stateless: it allocates `bN` ids in memory and
reconciles with the shell on every `browser_list`. Restarting the MCP
loses the in-memory map but the underlying panes survive — call
`browser_list` to re-discover them.

## Install

```bash
npm i -g @ikenga/mcp-browser
```

Then point your MCP client (Claude Code, Claude Desktop, Cursor) at it:

```jsonc
{
  "mcpServers": {
    "browser": { "command": "browser-mcp" }
  }
}
```

The Ikenga desktop app must be running for any tool to succeed; calls
fail with a structured error if `control.json` is missing or stale.

## License

[Apache-2.0](https://github.com/Royalti-io/ikenga-pkgs/blob/main/LICENSE).
