// Boot stub for com.ikenga.studio.
//
// This file is intentionally minimal at WP-07 commit 1 — it confirms the Vite
// build resolves @ikenga/tokens, mounts a React root, and renders something
// recognizable inside the iframe sandbox. The real boot path lands in WP-07
// commit 2 (AppBridge handshake + hostContext) and commit 5 (<App /> + layout
// switcher). Everything below this line will be replaced by then.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './studio/styles/index.css';

function ScaffoldPlaceholder() {
  return (
    <main className="studio-scaffold">
      <h1 className="studio-scaffold__title">Studio</h1>
      <p className="studio-scaffold__hint">
        WP-07 scaffold — bridge, store, views, and launcher land in later commits.
      </p>
    </main>
  );
}

const host = document.getElementById('root');
if (!host) {
  throw new Error('com.ikenga.studio: #root not found in iframe document');
}
createRoot(host).render(
  <StrictMode>
    <ScaffoldPlaceholder />
  </StrictMode>,
);
