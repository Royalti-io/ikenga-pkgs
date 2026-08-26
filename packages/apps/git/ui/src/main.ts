// com.ikenga.git · boot (WP-06)
//
// Owns the theme BEFORE first paint (setupTheme), mounts a neutral
// "Connecting…" placeholder, then swaps in the real App once the AppBridge
// handshake resolves (shell or standalone — both valid, standalone just means
// the mocked sidecar per app/transport.ts).

import { setupTheme } from './app/theme';
import './app/styles.css';

setupTheme();

const root = document.getElementById('root');
if (!root) {
  throw new Error('com.ikenga.git: #root not found in iframe document');
}

root.innerHTML = '<div class="git-loading">Connecting to your workspace…</div>';

import('./app/App')
  .then(({ mountApp }) => {
    mountApp(root);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[git] failed to boot', err);
    root.innerHTML = `<div class="git-empty-state"><div class="git-empty-state__title">Git couldn't start</div><div class="git-empty-state__hint">${String(
      err instanceof Error ? err.message : err
    )}</div></div>`;
  });
