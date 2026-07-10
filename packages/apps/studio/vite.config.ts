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
    // FLAT dist (WP-13 delivery fix). The manifest's ui.routes source is
    // `dist/index.html` — the served HTML's own directory IS the dist root,
    // exactly like the working `com.ikenga.research` pkg. This dodges the
    // shell's `pkg_content::mint_html` defect (Finding A): it canonicalizes
    // `./assets/*` subresource paths against the pkg's `dist/` root rather
    // than the served HTML's directory, so a nested `dist/studio/index.html`
    // (whose assets live one level deeper at `dist/studio/assets/*`) never
    // inlines and the pane renders blank. Keeping HTML at dist root aligns
    // the two paths. Only this pkg-root `dist/` is emptied on build — the
    // separate `mcp/dist` and `sidecars/*/dist` trees are untouched.
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Single-chunk JS (Finding B). The shell serves pkg iframes via a
        // `srcdoc` document minted by `mint_html`, which inlines only the
        // top-level <script>/<link> tags; WebKitGTK silently drops any HTTP
        // fetch issued from inside a `srcdoc` iframe (Tauri #12767), so
        // dynamic-import chunks can never load and the MCP client — itself a
        // dynamic import — would never resolve, leaving the gallery empty.
        // Forcing a single bundle means the whole app (views + store + MCP
        // client) inlines with the one top-level <script>. This is NOT the
        // forbidden `vite-plugin-singlefile` (which the resume-contract §1
        // packaging rule bars) — it's a plain rollup output flag. See the
        // WP-13 report's amendment note to that contract row.
        inlineDynamicImports: true,
      },
    },
  },
});
