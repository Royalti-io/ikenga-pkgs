import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-bundle iframe app. `dist/index.html` is what the manifest's ui.routes
// points at — Vite resolves the @ikenga/tokens CSS import via the workspace
// symlink in src/studio/styles/index.css. Nothing externalized at this stage;
// later commits (bridge, store, MCP mock, views) all land inside the bundle.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // manifest.json's ui.routes source is `dist/studio/index.html` (main's
    // shipped route, WP-08+); point the vite build at that same subpath.
    outDir: 'dist/studio',
  },
});
