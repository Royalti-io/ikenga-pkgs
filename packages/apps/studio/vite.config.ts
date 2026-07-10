import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Single-bundle iframe app. `dist/studio/index.html` is what the manifest's
// ui.routes points at. Tailwind 4 runs through its Vite plugin (same setup as the shell);
// @ikenga/tokens is mapped into the @theme registry in src/studio/styles/
// index.css so utilities like `bg-base` / `text-fg` resolve to the active
// theme's CSS vars. Nothing externalized — views, store, MCP mock all bundle.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // manifest.json's ui.routes source is `dist/studio/index.html` (main's
    // shipped route, WP-08+); point the vite build at that same subpath.
    outDir: 'dist/studio',
  },
});
