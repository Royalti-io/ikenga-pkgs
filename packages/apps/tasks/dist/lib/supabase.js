// Lazy Supabase client — keys arrive async via hostContext, so createClient()
// cannot run at module-eval time. Call setSupabaseConfig() once after the
// bridge resolves, then getSupabase() everywhere else.
//
// Single-user / RLS-only — no JWT handshake. The shell resolves the Supabase
// url + anon key from its Stronghold vault and threads them through the
// AppBridge `hostContext.supabase` block (capabilities.supabase in
// manifest.json). In standalone dev, app.js reads them from the query string.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let client = null;

export function setSupabaseConfig(config) {
  if (!config?.url || !config?.anonKey) {
    client = null;
    return;
  }
  client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getSupabase() {
  if (!client) throw new Error('[tasks] supabase client not configured yet');
  return client;
}

export function hasSupabase() {
  return client !== null;
}
