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
//   - flat `dist/`      — manifest.json's ui.routes source is `ui/dist/
//                        index.html`; this project's own `dist/` IS that
//                        root, so no nested `dist/ui/` nesting to trip the
//                        pkg_content path-canonicalization defect.
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
    outDir: 'dist',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
