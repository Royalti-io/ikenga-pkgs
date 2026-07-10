import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Single-bundle iframe app. `dist/studio/index.html` is what the manifest's
// ui.routes points at. Tailwind 4 runs through its Vite plugin (same setup as the shell);
// @ikenga/tokens is mapped into the @theme registry in src/studio/styles/
// index.css so utilities like `bg-base` / `text-fg` resolve to the active
// theme's CSS vars. Nothing externalized — views, store, MCP mock all bundle.
export default defineConfig({
  // Relative base: the shell's iframe content server serves this bundle out
  // of dist/studio via a per-request token URL, not from the site root, and
  // on WebKitGTK/Linux <base href> is ignored inside a srcdoc iframe — only
  // relative asset URLs get inlined by inline_subresources(). A root-absolute
  // '/assets/..' (the vite default) is skipped by both absolutize + inline
  // paths in shell/src-tauri/src/pkg_content/mod.rs, so the iframe would load
  // no JS/CSS and render a blank pane. Keep this relative.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // manifest.json's ui.routes source is `dist/studio/index.html` (main's
    // shipped route, WP-08+); point the vite build at that same subpath.
    outDir: 'dist/studio',
  },
});
