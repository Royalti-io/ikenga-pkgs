# `@ikenga/ui-lib`

Shared React UI primitives for Ikenga packages.

Currently ships:

- **`<CodeEditor>`** — CodeMirror 6 backed editor, themed from `@ikenga/tokens`.
  Supports `html`, `tsx`, `css`, `json`, and `markdown` out of the box. Composes
  cleanly with extra extensions and an optional LSP client.

```tsx
import { CodeEditor } from '@ikenga/ui-lib';

<CodeEditor
  value={src}
  onChange={setSrc}
  language="html"
  readOnly={isSaving}
/>
```

For Studio's anchor insertion (`Cmd+I` → `<img data-anchor="aXX">`):

```tsx
import { anchorInsertExtension } from '@ikenga/ui-lib/extensions';

<CodeEditor
  value={src}
  onChange={setSrc}
  language="html"
  keymapExtensions={[anchorInsertExtension()]}
/>
```

For TypeScript IntelliSense via the `com.ikenga.tsserver-lsp` sidecar:

```tsx
import { createTsLspClient } from '@ikenga/ui-lib/lsp';
import { createTauriDirectTransport } from '@ikenga/ui-lib/lsp/transports/tauri-direct';

const client = createTsLspClient(createTauriDirectTransport({
  pkgId: 'com.ikenga.tsserver-lsp',
  sidecarName: 'pa-tsserver-lsp-bridge',
}));

<CodeEditor value={src} onChange={setSrc} language="tsx" lspClient={client} />
```

## Sub-entries

Tree-shake by entry, not by re-export, so non-LSP surfaces never pay for LSP code:

| Import | Use for |
|--------|---------|
| `@ikenga/ui-lib` | `<CodeEditor>` + types |
| `@ikenga/ui-lib/extensions` | `anchorInsertExtension`, `insertAnchor`, ikenga keymap |
| `@ikenga/ui-lib/theme` | `tokensTheme()` |
| `@ikenga/ui-lib/lsp` | `createLspClient`, `createTsLspClient`, transport interface |
| `@ikenga/ui-lib/lsp/transports/tauri-direct` | Shell-resident Tauri transport |
| `@ikenga/ui-lib/lsp/transports/app-bridge` | iframe pkg AppBridge transport |
