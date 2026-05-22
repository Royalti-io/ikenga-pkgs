// Boot stub for com.ikenga.studio.
//
// This file mounts the React root and kicks off the host-bridge handshake in
// parallel — by the time WP-07 commit 5 wires the real <App />, the bridge
// will already have resolved (or thrown into standalone-dev fallback). The
// ScaffoldPlaceholder below is replaced in commit 5; nothing else needs to
// change in this file.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { connectBridge, isStandalone } from './studio/bridge';
import './studio/styles/index.css';

function ScaffoldPlaceholder({ mode }: { mode: 'shell' | 'standalone' | 'connecting' }) {
  return (
    <main className="studio-scaffold">
      <h1 className="studio-scaffold__title">Studio</h1>
      <p className="studio-scaffold__hint">
        WP-07 scaffold — bridge, store, views, and launcher land in later commits.
      </p>
      <p className="studio-scaffold__mode" data-mode={mode}>
        bridge: {mode}
      </p>
    </main>
  );
}

const host = document.getElementById('root');
if (!host) {
  throw new Error('com.ikenga.studio: #root not found in iframe document');
}

// Fire the handshake immediately. We don't await it — the placeholder renders
// straight away and shows the resolved mode once connectBridge() settles. Real
// boot ordering (await before mount, suspense-style transitions) is a commit 5
// concern.
const root = createRoot(host);
root.render(
  <StrictMode>
    <ScaffoldPlaceholder mode={isStandalone() ? 'standalone' : 'connecting'} />
  </StrictMode>,
);

connectBridge().then((conn) => {
  root.render(
    <StrictMode>
      <ScaffoldPlaceholder mode={conn.mode} />
    </StrictMode>,
  );
}).catch((err) => {
  // Never crash the iframe — the placeholder stays visible and the dev sees
  // the failure in devtools. Real error UI is a launcher concern (commit 11).
  // eslint-disable-next-line no-console
  console.error('[studio] connectBridge() failed', err);
});
