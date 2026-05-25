// Tasks root — bridge → supabase → mount <TasksView/>.
//
// Single-feature app (unlike Suite, no feature registry / sidebar router). The
// source main.tsx mounts TasksView directly inside a QueryClientProvider; we
// mirror that. Standalone mode reads Supabase keys from the query string so the
// pkg is previewable outside the shell.

import {
  html,
  useState,
  useEffect,
  createRoot,
  QueryClient,
  QueryClientProvider,
} from './lib/ui.js';
import { connectBridge, isStandalone } from './lib/bridge.js';
import { setSupabaseConfig, hasSupabase } from './lib/supabase.js';
import { TasksView } from './features/tasks/tasks-view.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeError, setBridgeError] = useState(null);
  // Bump to force a re-render once Supabase config lands (so hasSupabase()
  // flips from false → true and the view mounts).
  const [, setSbTick] = useState(0);
  const bumpSb = () => setSbTick((n) => n + 1);

  useEffect(() => {
    if (isStandalone()) {
      // Standalone dev — read keys from query string for quick iteration:
      // ?url=https://xxx.supabase.co&anon_key=eyJ...
      const params = new URLSearchParams(location.search);
      const url = params.get('url');
      const anonKey = params.get('anon_key');
      if (url && anonKey) {
        setSupabaseConfig({ url, anonKey });
        bumpSb();
      }
      setBridgeReady(true);
      return;
    }
    connectBridge({
      name: 'Tasks',
      version: '0.2.0',
      onContextChange: (ctx) => {
        if (ctx?.supabase) {
          setSupabaseConfig(ctx.supabase);
          bumpSb();
        }
      },
    })
      .then((ctx) => {
        if (ctx?.supabase) {
          setSupabaseConfig(ctx.supabase);
          bumpSb();
        }
        setBridgeReady(true);
      })
      .catch((e) => setBridgeError(e.message ?? String(e)));
  }, []);

  if (bridgeError) {
    return html`<div style=${{ padding: '2rem', color: 'var(--danger)' }}>Bridge error: ${bridgeError}</div>`;
  }
  if (!bridgeReady) {
    return html`<div style=${{ padding: '2rem', color: 'var(--fg-muted)' }}>Connecting…</div>`;
  }
  if (!hasSupabase()) {
    return html`
      <div style=${{ padding: '2rem', color: 'var(--fg-muted)' }}>
        <p>Supabase not configured.</p>
        <p>In standalone mode, pass <code>?url=…&amp;anon_key=…</code>. Inside the shell, ensure the vault has Supabase keys.</p>
      </div>
    `;
  }

  return html`<${QueryClientProvider} client=${queryClient}><${TasksView} /></${QueryClientProvider}>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
