import { defineConfig } from 'vite';

// Single-bundle iframe app for com.ikenga.git's UI (WP-06), same delivery
// contract com.ikenga.studio proved out (plans/studio 14-…-findings.md
// Finding A/B) — every rule below exists to avoid a blank pane in-shell:
//
//   - `base: './'`     — relative asset URLs. The shell's pkg content server
//                        srcdoc-inlines this bundle from a per-request token
//                        URL, not the site root, and WebKitGTK/Linux ignores
//                        <base href> inside a srcdoc iframe — only relative
//                        URLs get inline_subresources()-rewritten.
//   - `outDir: '../dist'` — the PKG ROOT's `dist/`, not `ui/dist/`. This is
//                        not a preference: the shell hardcodes an iframe
//                        pkg's content root to `<pkg>/dist`
//                        (`pkg_content/mod.rs:493`, `server/pkg_static.rs:
//                        211`) and `mint_html` only strips a leading `dist/`
//                        from the manifest's `source` before joining it to
//                        that root. `UiBlock` has no `dist_root` field to
//                        override. A bundle at `ui/dist/` is therefore
//                        unreachable — the pane mounts an error page, not the
//                        app. `emptyOutDir` is required because the dir is
//                        outside vite's root and it refuses to clear it
//                        otherwise.
//   - flat output       — `index.html` sits directly in that `dist/`, with
//                        no nested `dist/ui/` to trip the pkg_content path
//                        canonicalization. `mcp/dist` and `sidecar/dist` are
//                        separate directories and are untouched by this.
//   - single JS chunk   — WebKitGTK drops any HTTP fetch issued from inside a
//                        srcdoc iframe (Tauri #12767), so a dynamic-import
//                        chunk (code-splitting's whole point) can never load.
//                        `inlineDynamicImports` folds everything into the one
//                        top-level <script> the srcdoc-inliner keeps.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
