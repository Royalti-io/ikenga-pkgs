/**
 * Interim local store for the user-supplied OpenAI API key (WP-19).
 *
 * The intended home for this value is the shell's Stronghold vault: F-9's
 * settings-secret env injector (`resolve_settings_secret_env` in
 * `shell/src-tauri/src/commands/secrets.rs`) already knows how to read a
 * `type:"secret"` settings field's value out of Stronghold, scoped to this
 * pkg, and set it as an env var on THIS process before spawn — see the
 * `openai_api_key` entry in `../../manifest.json`'s `settings.schema`, which
 * declares exactly that (`env: "OPENAI_API_KEY"`), mirroring how
 * `com.ikenga.studio` gets `FAL_KEY`.
 *
 * What's missing is a way to WRITE that value in the first place from here.
 * Checked 2026-09-04:
 *   - No `host.*` verb bridges `pkg_settings_set` or the Stronghold
 *     `secrets_set_scoped` command to a pkg iframe
 *     (`shell/src/components/pkg/pkg-iframe-host.tsx` has no such verb).
 *   - The shell's own generic per-pkg Settings tab
 *     (`shell/src/components/pkg/v2/pkg-loupe.tsx`, `TabSettings`) DOES let a
 *     human type a value for a `type:"secret"` field, but its `onChange`
 *     unconditionally calls `pkgSettingsSet` → the `pkg_settings_set` Tauri
 *     command, which upserts into the plaintext `pkg_settings` SQLite table.
 *     It never calls `secrets_set_scoped`. So a key typed there today is
 *     stored in the clear in a different table than the one F-9 actually
 *     reads from, and never reaches this process's env.
 *
 * Until one of those is fixed shell-side, this file is the real source of
 * truth for a key entered through this pkg's own first-run/settings UI:
 * `getOpenAiKey` still checks `OPENAI_API_KEY` first, so the day the gap
 * above closes, this store becomes a fallback rather than the only path.
 *
 * This is NOT Stronghold — no OS keychain, just a `0600` file under this
 * user's home directory. It sits under `~/.ikenga/media/**`, which the
 * manifest already grants `fs.write` for (recording audio lives there too),
 * rather than under `$pkg_data`: a plain Node child spawned by the shell has
 * no manifest-free way to learn Tauri's `app_data_dir` for this install, so
 * there is nothing more precise to anchor it to without guessing an OS path
 * convention. Treat its secrecy as "as strong as this machine's normal user
 * account boundary," not as vault-grade.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Test seam only: lets `mcp/src/openai-tool.test.ts` exercise the real
// read/write/clear path against a throwaway tmpdir instead of this user's
// actual `~/.ikenga`. Unset in every real install.
function storeDir(): string {
  return process.env.IKENGA_MEETINGS_STT_STORE_DIR ?? path.join(os.homedir(), '.ikenga', 'media', '.meetings-stt');
}
function storeFile(): string {
  return path.join(storeDir(), 'config.json');
}

interface SttLocalConfig {
  openai_api_key?: string;
}

async function readConfig(): Promise<SttLocalConfig> {
  try {
    const raw = await fs.readFile(storeFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as SttLocalConfig) : {};
  } catch {
    return {};
  }
}

async function writeConfig(cfg: SttLocalConfig): Promise<void> {
  await fs.mkdir(storeDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(storeFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  // mkdir/writeFile's `mode` is subject to umask; chmod is not.
  await fs.chmod(storeFile(), 0o600).catch(() => {});
}

/**
 * Resolve the OpenAI key to actually use. The env var (settings-secret /
 * launch-env) wins when present — that's the path that works transparently
 * once the shell resolves it from Stronghold, or when a developer sets it by
 * hand for testing.
 */
export async function getOpenAiKey(): Promise<string | undefined> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const cfg = await readConfig();
  return cfg.openai_api_key || undefined;
}

export async function hasOpenAiKey(): Promise<boolean> {
  return Boolean(await getOpenAiKey());
}

export async function setOpenAiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error('OpenAI API key cannot be empty');
  }
  const cfg = await readConfig();
  cfg.openai_api_key = trimmed;
  await writeConfig(cfg);
}

export async function clearOpenAiKey(): Promise<void> {
  const cfg = await readConfig();
  delete cfg.openai_api_key;
  await writeConfig(cfg);
}
