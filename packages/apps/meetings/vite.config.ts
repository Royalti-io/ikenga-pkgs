import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-bundle iframe app. `dist/index.html` is what the manifest's routes
// point at. Mirrors the delivery constraints proven out by com.ikenga.studio —
// see the comments below before changing any of these three settings.
export default defineConfig({
  // Relative base: the shell's iframe content server serves this bundle via a
  // per-request token URL, not from the site root, and on WebKitGTK/Linux
  // <base href> is ignored inside a srcdoc iframe — only relative asset URLs
  // get inlined by inline_subresources(). A root-absolute '/assets/..' (the
  // vite default) is skipped by both the absolutize and inline paths in
  // shell/src-tauri/src/pkg_content/mod.rs, so the iframe would load no
  // JS/CSS and render a blank pane. Keep this relative.
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // Inline every static asset as a base64 data: URI. The shell srcdoc-inlines
    // this pane and WebKitGTK drops HTTP fetches from a srcdoc iframe
    // (Tauri #12767), so a separate asset file would never load in-shell.
    assetsInlineLimit: 512 * 1024,
    // FLAT dist. The manifest's route source is `dist/index.html` — the served
    // HTML's own directory IS the dist root. The shell's pkg_content::mint_html
    // canonicalizes `./assets/*` subresource paths against the pkg's dist root
    // rather than the served HTML's directory, so a nested
    // `dist/<name>/index.html` never inlines and the pane renders blank.
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Single-chunk JS. The shell serves pkg iframes via a `srcdoc` document
        // that inlines only the top-level <script>/<link> tags; WebKitGTK
        // silently drops any HTTP fetch issued from inside a srcdoc iframe
        // (Tauri #12767), so dynamic-import chunks can never load. Forcing one
        // bundle means the whole app inlines with the single top-level <script>.
        inlineDynamicImports: true,
      },
    },
  },
});
