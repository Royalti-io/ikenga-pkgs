# @ikenga/tsserver-lsp-sidecar

## 0.2.0

### Minor Changes

- [`f070162`](https://github.com/Royalti-io/ikenga-pkgs/commit/f070162f8983ee189ab12d13b696d11d4ddc98d8) Thanks [@nedjamez](https://github.com/nedjamez)! - Initial release of `@ikenga/ui-lib` — shared React UI primitives for Ikenga
  pkgs. Ships `<CodeEditor>`, a CodeMirror 6 backed editor themed via
  `@ikenga/tokens`, with anchor-insertion / Ikenga keymap extensions and an
  opt-in LSP wiring. Includes a `tauri-direct` transport that pairs with the
  new `pkg_sidecar_rpc_send` Tauri command for shell-resident consumers; an
  `app-bridge` transport for iframe pkgs lands in a follow-up.

  Initial release of `com.ikenga.tsserver-lsp` — long-lived sidecar that
  wraps `typescript-language-server --stdio` and bridges between the shell's
  line-delimited sidecar envelope and LSP `Content-Length` framing. Required
  for the `<CodeEditor lspClient={...}>` path. v1 resolves types from the
  project's own `node_modules`; bundled ATA cache for scratchpad cells is a
  follow-up phase.

  Together they replace the artifact-studio loupe's previous Monaco editor
  (`@monaco-editor/react`) with a ~20× smaller bundle and prepare the
  foundation Studio P1 (`plans/studio/01-plan.md`) will consume.
