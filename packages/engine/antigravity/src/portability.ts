/**
 * Portability adapter for Antigravity CLI.
 *
 * Fans out into `~/.gemini/antigravity-cli/` and configures MCP in `~/.gemini/config/mcp_config.json`.
 */

import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rename,
	rm,
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
import { mdToGeminiCommandToml } from '@ikenga/contract/engine';
import type { McpServer } from '@ikenga/contract/manifest';

type SymlinkAssetKind = 'extensions' | 'agents';

const SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET|PASSWORD)$/i;
const IKENGA_SECRET_PREFIX = '${IKENGA_SECRET:';

/** Resolve `$HOME/.gemini`. Lazy + per-call so test scratch HOMEs work. */
function geminiHome(): string {
	const home = process.env.HOME;
	if (!home) throw new Error('HOME not set');
	return path.join(home, '.gemini');
}

function antigravityCliHome(): string {
	return path.join(geminiHome(), 'antigravity-cli');
}

function settingsPath(): string {
	return path.join(geminiHome(), 'config', 'mcp_config.json');
}

function symlinkTargetFor(kind: SymlinkAssetKind, pkgSlug: string): string {
	return path.join(antigravityCliHome(), kind === 'extensions' ? 'skills' : 'agents', pkgSlug);
}

function commandsDirFor(pkgSlug: string): string {
	return path.join(antigravityCliHome(), 'commands', pkgSlug);
}

function mcpKey(pkgSlug: string, serverName: string): string {
	return `ikenga.${pkgSlug}.${serverName}`;
}

/** Cross-platform directory symlink. Same shape as the Claude adapter. */
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
 * Identical semantics to the Claude adapter's classifier.
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
	const resolved = path.isAbsolute(current)
		? current
		: path.resolve(path.dirname(target), current);
	if (resolved === source) {
		return { kind: 'skipped', currentLink: current };
	}
	return { kind: 'warning-replace', currentLink: current };
}

/**
 * Install one asset folder as a symlink.
 * Used for both skills (`skills`) and agents.
 */
async function installSymlinkFolder(
	folder: string,
	kind: SymlinkAssetKind,
	pkgSlug: string,
): Promise<InstallReport> {
	const source = path.resolve(folder);
	const parent = path.dirname(symlinkTargetFor(kind, pkgSlug));
	const target = symlinkTargetFor(kind, pkgSlug);

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

/** Tear down one asset symlink. Non-symlink at target → warn-and-skip. */
async function uninstallSymlinkFolder(
	kind: SymlinkAssetKind,
	pkgSlug: string,
): Promise<void> {
	const target = symlinkTargetFor(kind, pkgSlug);
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
			`[engine-antigravity] target ${target} is not a symlink — skipping (user-managed?)`,
		);
		return;
	}
	await unlink(target);
}

/**
 * Walk `.md` files in `folder` and transcode each into a `.toml` file
 * under `~/.gemini/antigravity-cli/commands/<pkgSlug>/<basename>.toml`.
 */
async function installCommandsTranscoded(
	folder: string,
	pkgSlug: string,
): Promise<InstallReport> {
	const source = path.resolve(folder);
	const outDir = commandsDirFor(pkgSlug);

	// Read the source dir. Missing source is an error (callers always pass a
	// real folder); zero `.md` entries is fine — emits an empty per-pkg dir.
	const entries = await readdir(source, { withFileTypes: true });

	await mkdir(outDir, { recursive: true, mode: 0o755 });

	let perFileWrote = 0;
	let perFileSkipped = 0;
	const warnings: string[] = [];

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (!entry.name.toLowerCase().endsWith('.md')) continue;

		const srcFile = path.join(source, entry.name);
		const outName = `${entry.name.slice(0, -'.md'.length)}.toml`;
		const outFile = path.join(outDir, outName);

		const md = await readFile(srcFile, 'utf8');
		let toml: string;
		try {
			toml = mdToGeminiCommandToml(md);
		} catch (err) {
			warnings.push(`${entry.name}: ${(err as Error).message}`);
			continue;
		}

		// Idempotency: byte-equal existing output → skipped, no write.
		let existing: string | undefined;
		try {
			existing = await readFile(outFile, 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
		}
		if (existing === toml) {
			perFileSkipped++;
			continue;
		}

		// Atomic write — temp file in same dir, then rename.
		const tmp = path.join(
			outDir,
			`.${outName}.${process.pid}.${Date.now()}.tmp`,
		);
		await writeFile(tmp, toml, 'utf8');
		await rename(tmp, outFile);
		perFileWrote++;
	}

	// Reported as one directory entry — see slug-recovery contract above.
	const report: InstallReport = {
		wrote: perFileWrote > 0 ? [outDir] : [],
		skipped: perFileWrote === 0 && perFileSkipped > 0 ? [outDir] : [],
		warnings,
	};
	return report;
}

async function uninstallCommandsDir(pkgSlug: string): Promise<void> {
	const dir = commandsDirFor(pkgSlug);
	// rm -rf semantics with `force: true` — missing dir is a no-op.
	await rm(dir, { recursive: true, force: true });
}

interface ParsedSettings {
	root: Record<string, unknown>;
	existed: boolean;
}

/** Load `~/.gemini/config/mcp_config.json`. Missing/empty → empty `{}`. */
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

/** Atomic write: serialize → temp file in same dir → rename. */
async function writeSettings(root: Record<string, unknown>): Promise<void> {
	const dest = settingsPath();
	const parent = path.dirname(dest);
	await mkdir(parent, { recursive: true, mode: 0o755 });
	const pretty = `${JSON.stringify(root, null, 2)}\n`;
	const tmp = path.join(parent, `.mcp_config.json.${process.pid}.${Date.now()}.tmp`);
	await writeFile(tmp, pretty, 'utf8');
	await rename(tmp, dest);
}

/** Build the JSON entry shape for one MCP server. */
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

export class AntigravityEngineAdapter implements EngineAdapter {
	readonly id = 'antigravity-cli';

	installSkills(folder: string, _pkgId: string, pkgSlug: string): Promise<InstallReport> {
		return installSymlinkFolder(folder, 'extensions', pkgSlug);
	}

	installCommands(folder: string, _pkgId: string, pkgSlug: string): Promise<InstallReport> {
		return installCommandsTranscoded(folder, pkgSlug);
	}

	installAgents(folder: string, _pkgId: string, pkgSlug: string): Promise<InstallReport> {
		return installSymlinkFolder(folder, 'agents', pkgSlug);
	}

	uninstallSkills(_pkgId: string, pkgSlug: string): Promise<void> {
		return uninstallSymlinkFolder('extensions', pkgSlug);
	}

	uninstallCommands(_pkgId: string, pkgSlug: string): Promise<void> {
		return uninstallCommandsDir(pkgSlug);
	}

	uninstallAgents(_pkgId: string, pkgSlug: string): Promise<void> {
		return uninstallSymlinkFolder('agents', pkgSlug);
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

		// Skills + agents — classify symlink targets without writing.
		const symlinkKinds: { kind: SymlinkAssetKind; rel?: string }[] = [
			{ kind: 'extensions', rel: manifestSnapshot.skills },
			{ kind: 'agents', rel: manifestSnapshot.agents },
		];
		for (const { kind, rel } of symlinkKinds) {
			if (!rel) continue;
			const source = path.resolve(rel);
			const target = symlinkTargetFor(kind, pkgSlug);
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

		// Commands — walk source dir read-only and classify each output file.
		if (manifestSnapshot.commands) {
			const cmdSource = path.resolve(manifestSnapshot.commands);
			const outDir = commandsDirFor(pkgSlug);
			let entries: { name: string; isFile: () => boolean }[] = [];
			try {
				entries = await readdir(cmdSource, { withFileTypes: true });
			} catch (err) {
				warnings.push(
					`could not read commands source ${cmdSource}: ${(err as Error).message}`,
				);
			}
			let anyWrote = false;
			let anySkipped = false;
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				if (!entry.name.toLowerCase().endsWith('.md')) continue;
				const outFile = path.join(
					outDir,
					`${entry.name.slice(0, -'.md'.length)}.toml`,
				);
				const md = await readFile(path.join(cmdSource, entry.name), 'utf8');
				let toml: string;
				try {
					toml = mdToGeminiCommandToml(md);
				} catch (err) {
					warnings.push(`${entry.name}: ${(err as Error).message}`);
					continue;
				}
				let existing: string | undefined;
				try {
					existing = await readFile(outFile, 'utf8');
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
						warnings.push(
							`stat ${outFile}: ${(err as Error).message}`,
						);
						continue;
					}
				}
				if (existing === toml) anySkipped = true;
				else anyWrote = true;
			}
			if (anyWrote) wrote.push(outDir);
			else if (anySkipped) skipped.push(outDir);
		}

		// MCP servers — same classification as Claude adapter.
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
	geminiHome,
	antigravityCliHome,
	settingsPath,
	symlinkTargetFor,
	commandsDirFor,
	mcpKey,
	mkdtempScratch: async (label: string) => mkdtemp(path.join(tmpdir(), label)),
};
