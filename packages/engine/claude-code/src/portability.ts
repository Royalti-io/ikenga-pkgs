/**
 * Portability adapter for Claude Code — ADR-012 Track C.
 *
 * Implements `EngineAdapter` from `@ikenga/contract` in parallel to the
 * runtime `ClaudeCodeEngine`. The kernel's `engine_assets` registry calls
 * these methods at pkg install / uninstall time so a user's skills,
 * commands, agents, and MCP servers survive an engine swap.
 *
 * Behavior is faithful to the existing Rust kernel:
 *   - Skills/commands/agents materialize as directory symlinks under
 *     `~/.claude/<kind>/<pkg-slug>/`. Conflict policy ported verbatim from
 *     `shell/src-tauri/src/pkg/registries/engine_assets.rs` lines 89-114.
 *   - MCP servers are written into `~/.claude/settings.json` (ADR §1/§7) —
 *     NOT into the legacy `~/.claude.json` path the kernel uses internally.
 *     Per ADR §7 entries are keyed `ikenga.<pkg-slug>.<server-name>`.
 *
 * No external runtime deps — Node built-ins only.
 */

import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rename,
	symlink,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type {
	EngineAdapter,
	InstallPlan,
	InstallReport,
	ManifestSnapshot,
} from '@ikenga/contract/engine';
import type { McpServer } from '@ikenga/contract/manifest';

type AssetKind = 'skills' | 'commands' | 'agents';

const SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET|PASSWORD)$/i;
const IKENGA_SECRET_PREFIX = '${IKENGA_SECRET:';

/** Resolve `$HOME/.claude`. Lazy + per-call so test scratch HOMEs work. */
function claudeHome(): string {
	const home = process.env.HOME;
	if (!home) throw new Error('HOME not set');
	return path.join(home, '.claude');
}

function settingsPath(): string {
	return path.join(claudeHome(), 'settings.json');
}

function targetForKind(kind: AssetKind, pkgSlug: string): string {
	return path.join(claudeHome(), kind, pkgSlug);
}

function mcpKey(pkgSlug: string, serverName: string): string {
	return `ikenga.${pkgSlug}.${serverName}`;
}

/**
 * Cross-platform directory symlink. On Windows pass `'junction'` so the
 * target need not be an absolute path that the user has perms to create
 * symlinks for (matches the Rust `cfg(windows)` `symlink_dir` path).
 */
async function symlinkDir(source: string, target: string): Promise<void> {
	if (process.platform === 'win32') {
		await symlink(source, target, 'junction');
	} else {
		await symlink(source, target);
	}
}

interface AssetClassification {
	kind: 'wrote' | 'skipped' | 'warning-replace' | 'error-nonsymlink';
	currentLink?: string;
}

/**
 * Inspect `target` and decide what an install would do, without writing.
 * Mirrors the match arms of `install_symlink` in
 * `engine_assets.rs:88-114`.
 */
async function classifySymlinkTarget(
	source: string,
	target: string,
): Promise<AssetClassification> {
	let stat;
	try {
		stat = await lstat(target);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return { kind: 'wrote' };
		}
		throw err;
	}
	if (!stat.isSymbolicLink()) {
		return { kind: 'error-nonsymlink' };
	}
	const current = await readlink(target);
	// Normalize: readlink may return relative path on some platforms.
	const resolved = path.isAbsolute(current)
		? current
		: path.resolve(path.dirname(target), current);
	if (resolved === source) {
		return { kind: 'skipped', currentLink: current };
	}
	return { kind: 'warning-replace', currentLink: current };
}

/**
 * Install one asset folder as a symlink at `~/.claude/<kind>/<pkgSlug>`.
 * Ported from `engine_assets.rs::install_symlink`.
 */
async function installAssetFolder(
	folder: string,
	kind: AssetKind,
	pkgSlug: string,
): Promise<InstallReport> {
	const source = path.resolve(folder);
	const parent = path.join(claudeHome(), kind);
	const target = targetForKind(kind, pkgSlug);

	const classification = await classifySymlinkTarget(source, target);

	if (classification.kind === 'error-nonsymlink') {
		throw new Error(
			`${target} exists and is not a symlink — refusing to overwrite`,
		);
	}

	if (classification.kind === 'skipped') {
		return { wrote: [], skipped: [target], warnings: [] };
	}

	await mkdir(parent, { recursive: true, mode: 0o755 });

	const warnings: string[] = [];
	if (classification.kind === 'warning-replace') {
		await unlink(target);
		warnings.push(
			`replaced stale symlink at ${target} (was pointing at ${classification.currentLink})`,
		);
	}

	await symlinkDir(source, target);
	return { wrote: [target], skipped: [], warnings };
}

/**
 * Tear down one asset symlink. Ported from `engine_assets.rs::remove_target`.
 * Non-symlink at the target is a warning, not an error — uninstall stays
 * idempotent on a user-managed directory.
 */
async function uninstallAssetFolder(kind: AssetKind, pkgSlug: string): Promise<void> {
	const target = targetForKind(kind, pkgSlug);
	let stat;
	try {
		stat = await lstat(target);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw err;
	}
	if (!stat.isSymbolicLink()) {
		// eslint-disable-next-line no-console
		console.warn(
			`[engine-claude-code] target ${target} is not a symlink — skipping (user-managed?)`,
		);
		return;
	}
	await unlink(target);
}

interface ParsedSettings {
	/** Top-level JSON object. Always an object (or freshly created). */
	root: Record<string, unknown>;
	/** Whether the file existed on disk when loaded. */
	existed: boolean;
}

/** Load `~/.claude/settings.json`. Missing/empty → empty `{}`. */
async function readSettings(): Promise<ParsedSettings> {
	let raw: string;
	try {
		raw = await readFile(settingsPath(), 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return { root: {}, existed: false };
		}
		throw err;
	}
	const trimmed = raw.trim();
	if (trimmed.length === 0) return { root: {}, existed: true };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`parse ${settingsPath()}: ${(err as Error).message}`,
		);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(
			`${settingsPath()} is not a JSON object — refusing to overwrite`,
		);
	}
	return { root: parsed as Record<string, unknown>, existed: true };
}

/**
 * Atomic write: serialize → temp file in same dir → rename. Mirrors
 * `mcp.rs::save_config`. Rename is atomic on POSIX.
 */
async function writeSettings(root: Record<string, unknown>): Promise<void> {
	const dest = settingsPath();
	const parent = path.dirname(dest);
	await mkdir(parent, { recursive: true, mode: 0o755 });
	const pretty = `${JSON.stringify(root, null, 2)}\n`;
	const tmp = path.join(parent, `.settings.json.${process.pid}.${Date.now()}.tmp`);
	await writeFile(tmp, pretty, 'utf8');
	await rename(tmp, dest);
}

/**
 * Build the JSON entry shape for one MCP server. Returns the value plus
 * any warnings (e.g. secret-bearing env var refusals).
 */
function buildMcpEntry(spec: McpServer): { value: Record<string, unknown>; warnings: string[] } {
	const warnings: string[] = [];
	const env = spec.env ?? {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value !== 'string') continue;
		if (value.startsWith(IKENGA_SECRET_PREFIX)) continue;
		if (SECRET_KEY_PATTERN.test(key)) {
			warnings.push(
				`secret-bearing env var \`${key}\` must use \${IKENGA_SECRET:<vault-key>} indirection`,
			);
		}
	}
	const value: Record<string, unknown> = {
		type: 'stdio',
		command: spec.command,
		args: spec.args ?? [],
		env,
	};
	if (spec.lifecycle === 'long-lived') {
		value.disabled = true;
	}
	return { value, warnings };
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}
	if (typeof a === 'object') {
		if (typeof b !== 'object' || Array.isArray(b)) return false;
		const ao = a as Record<string, unknown>;
		const bo = b as Record<string, unknown>;
		const ak = Object.keys(ao);
		const bk = Object.keys(bo);
		if (ak.length !== bk.length) return false;
		for (const k of ak) {
			if (!deepEqual(ao[k], bo[k])) return false;
		}
		return true;
	}
	return false;
}

export class ClaudeCodeEngineAdapter implements EngineAdapter {
	readonly id = 'claude-code';

	installSkills(folder: string, _pkgId: string, pkgSlug: string): Promise<InstallReport> {
		return installAssetFolder(folder, 'skills', pkgSlug);
	}

	installCommands(folder: string, _pkgId: string, pkgSlug: string): Promise<InstallReport> {
		return installAssetFolder(folder, 'commands', pkgSlug);
	}

	installAgents(folder: string, _pkgId: string, pkgSlug: string): Promise<InstallReport> {
		return installAssetFolder(folder, 'agents', pkgSlug);
	}

	uninstallSkills(_pkgId: string, pkgSlug: string): Promise<void> {
		return uninstallAssetFolder('skills', pkgSlug);
	}

	uninstallCommands(_pkgId: string, pkgSlug: string): Promise<void> {
		return uninstallAssetFolder('commands', pkgSlug);
	}

	uninstallAgents(_pkgId: string, pkgSlug: string): Promise<void> {
		return uninstallAssetFolder('agents', pkgSlug);
	}

	async registerMcpServer(
		spec: McpServer,
		_pkgId: string,
		pkgSlug: string,
	): Promise<InstallReport> {
		if (!spec.name) throw new Error('mcp server has empty name');
		if (!spec.command) throw new Error(`mcp server \`${spec.name}\` has empty command`);

		const key = mcpKey(pkgSlug, spec.name);
		const { value, warnings } = buildMcpEntry(spec);

		// Strict v1: refuse to write if any env var looks like a plaintext
		// secret. Caller sees the warning and the entry isn't materialized.
		if (warnings.length > 0) {
			return { wrote: [], skipped: [], warnings };
		}

		const { root } = await readSettings();
		const existingServers = root.mcpServers;
		let servers: Record<string, unknown>;
		if (existingServers === undefined) {
			servers = {};
			root.mcpServers = servers;
		} else if (
			existingServers !== null &&
			typeof existingServers === 'object' &&
			!Array.isArray(existingServers)
		) {
			servers = existingServers as Record<string, unknown>;
		} else {
			throw new Error(
				`${settingsPath()} \`mcpServers\` is not an object — refusing to overwrite`,
			);
		}

		const existingEntry = servers[key];
		if (existingEntry !== undefined && deepEqual(existingEntry, value)) {
			return { wrote: [], skipped: [`${settingsPath()}#${key}`], warnings: [] };
		}

		servers[key] = value;
		await writeSettings(root);
		return { wrote: [`${settingsPath()}#${key}`], skipped: [], warnings: [] };
	}

	async unregisterMcpServer(
		serverName: string,
		_pkgId: string,
		pkgSlug: string,
	): Promise<void> {
		let parsed: ParsedSettings;
		try {
			parsed = await readSettings();
		} catch {
			// Corrupt or missing — nothing to remove. Match the kernel's
			// uninstall warn-and-continue behavior.
			return;
		}
		if (!parsed.existed) return;
		const servers = parsed.root.mcpServers;
		if (
			servers === null ||
			typeof servers !== 'object' ||
			Array.isArray(servers)
		) {
			return;
		}
		const map = servers as Record<string, unknown>;
		const key = mcpKey(pkgSlug, serverName);
		if (!(key in map)) return;
		delete map[key];
		await writeSettings(parsed.root);
	}

	async plan(
		pkgId: string,
		pkgSlug: string,
		manifestSnapshot: ManifestSnapshot,
	): Promise<InstallPlan> {
		const wrote: string[] = [];
		const skipped: string[] = [];
		const warnings: string[] = [];

		// Asset folders — classify without writing.
		const kinds: { kind: AssetKind; rel?: string }[] = [
			{ kind: 'skills', rel: manifestSnapshot.skills },
			{ kind: 'commands', rel: manifestSnapshot.commands },
			{ kind: 'agents', rel: manifestSnapshot.agents },
		];
		for (const { kind, rel } of kinds) {
			if (!rel) continue;
			const source = path.resolve(rel);
			const target = targetForKind(kind, pkgSlug);
			const cls = await classifySymlinkTarget(source, target);
			if (cls.kind === 'wrote') wrote.push(target);
			else if (cls.kind === 'skipped') skipped.push(target);
			else if (cls.kind === 'warning-replace') {
				wrote.push(target);
				warnings.push(
					`would replace stale symlink at ${target} (currently → ${cls.currentLink})`,
				);
			} else if (cls.kind === 'error-nonsymlink') {
				warnings.push(`${target} exists and is not a symlink — install would refuse`);
			}
		}

		// MCP servers — read settings (if any) and classify each entry.
		let settings: ParsedSettings | null = null;
		try {
			settings = await readSettings();
		} catch (err) {
			warnings.push(`could not parse ${settingsPath()}: ${(err as Error).message}`);
		}
		const serversMap: Record<string, unknown> | null = (() => {
			if (!settings) return null;
			const s = settings.root.mcpServers;
			if (s && typeof s === 'object' && !Array.isArray(s)) {
				return s as Record<string, unknown>;
			}
			return null;
		})();

		for (const spec of manifestSnapshot.mcp) {
			const key = mcpKey(pkgSlug, spec.name);
			const ref = `${settingsPath()}#${key}`;
			const { value, warnings: entryWarnings } = buildMcpEntry(spec);
			if (entryWarnings.length > 0) {
				warnings.push(...entryWarnings);
				continue;
			}
			const existing = serversMap?.[key];
			if (existing !== undefined && deepEqual(existing, value)) {
				skipped.push(ref);
			} else {
				wrote.push(ref);
			}
		}

		return { engineId: this.id, pkgId, wrote, skipped, warnings };
	}
}

// Re-exported for tests that want to drive a fresh scratch HOME.
export const __internal = {
	claudeHome,
	settingsPath,
	targetForKind,
	mcpKey,
	mkdtempScratch: async (label: string) => mkdtemp(path.join(tmpdir(), label)),
};
