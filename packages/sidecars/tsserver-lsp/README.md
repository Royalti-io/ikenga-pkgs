# `com.ikenga.tsserver-lsp`

Long-lived sidecar that wraps `typescript-language-server` for the Ikenga
shell. Bridges between the shell's line-delimited JSON-RPC sidecar envelope
and LSP's `Content-Length` framed messages, so any pkg with a code editor
can wire TypeScript IntelliSense via `@ikenga/ui-lib`'s `<CodeEditor>`.

## Build

```bash
bun install
bun run build          # writes dist/pa-com-ikenga-tsserver-lsp-bridge-<target>
```

The binary is a Bun-compiled, single-file executable. `typescript-language-server`
and its `typescript` dep are bundled in.

## Wire

```
shell                 bridge                       tsserver-lsp child
  ┃   line JSON         ┃   LSP Content-Length         ┃
  ┣━━━━━━━━━━━━━━━━━━━━▶┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▶┃
  ┃                     ┃                              ┃
  ┃◀━━━━━━━━━━━━━━━━━━━━┫◀━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
```

`stdin` lines and `stdout` lines on the bridge are JSON-RPC 2.0 messages with
no framing. The bridge wraps them in LSP framing for the child and unwraps
the child's framed output back to lines.

`stderr` is free-form logging only — the supervisor drains it.

## Type acquisition

v1 relies on the **project's own `node_modules`** for type resolution
(strategy (c) in `plans/.../07-monaco-swap.md`). Open a cell with
`rootUri = file:///path/to/your/remotion-project/` and tsserver picks up
`@types/react`, `remotion`, etc. from there.

A follow-up phase will bundle an ATA cache so scratchpad cells without a
project root also get IntelliSense — see `plans/.../07-monaco-swap.md` §5.
