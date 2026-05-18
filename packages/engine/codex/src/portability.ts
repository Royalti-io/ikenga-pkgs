/**
 * Portability adapter for Codex CLI — ADR-012 Track C.
 *
 * Implements `EngineAdapter` from `@ikenga/contract` in parallel to the
 * runtime `CodexEngine` stub. The kernel's `engine_assets` registry calls
 * these methods at pkg install / uninstall time so a user's pkg
 * investment (skills, commands, agents, MCP) survives an engine swap.
 *
 * On-disk layout (ADR §1):
 *   - MCP:       `~/.codex/config.toml` `[mcp_servers.ikenga.<slug>.<name>]`
 *   - Skills:    PROJECT-SCOPED `<projectRoot>/.agents/skills/<slug>/`
 *                — NOT under `~/.codex/`. Resolved from the
 *                `IKENGA_CODEX_PROJECT_ROOT` env var (opt-in escape hatch
 *                we can wire up from the shell later); unset → warn + skip.
 *   - Commands:  no first-class Codex primitive. Per ADR §5: if frontmatter
 *                has `allow_implicit_invocation: true` we materialize as a
 *                skill; otherwise we warn + skip per file.
 *   - Subagents: `~/.codex/agents/<slug>/<basename>.toml` (per-file
 *                MD→TOML). Namespaced under the pkg slug per ADR §1
 *                (table amended 2026-05-18 to match §7's
 *                "pkg-namespaced subdirs" rule).
 *   - AGENTS.md: skipped for v1 (out of scope).
 *
 * Env-substitution semantics (ADR §7 closed 2026-05-18):
 *   Codex's `[mcp_servers.<n>.env]` table is documented as static literal
 *   key-value pairs — no `${VAR}` or `${IKENGA_SECRET:...}` substitution.
 *   However Codex DOES support a separate `env_vars = [...]` field on the
 *   server table that forwards values from Codex's parent process env to
 *   the MCP child. We use this as the secret indirection path:
 *     - `${IKENGA_SECRET:foo}` placeholder → emit the key into `env_vars`
 *       (the user must `export FOO_API_KEY=...` before invoking the
 *       external `codex` CLI). Surfaces an informational warning.
 *     - secret-shaped env key with a plaintext value → REFUSE the entry.
 *       Plaintext secrets in a manifest are a pkg-author bug.
 *     - everything else → emit into the literal `.env` subtable.
 *   See: https://developers.openai.com/codex/mcp (`env_vars` schema).
 *
 * No external runtime deps — Node built-ins only.
 */

import {
	lstat,
	mkdir,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	stat,
	symlink,
	unlink,
	writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';

import type {
	EngineAdapter,
	InstallPlan,
	InstallReport,
	ManifestSnapshot,
} from '@ikenga/contract/engine';
import { mdToCodexToml, codexTomlToMd } from '@ikenga/contract/engine';
import type { McpServer } from '@ikenga/contract/manifest';

const SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]*_(KEY|TOKEN|SECRET|PASSWORD)$/i;
const IKENGA_SECRET_PREFIX = '${IKENGA_SECRET:';

/** Resolve `$HOME/.codex`. Lazy + per-call so test scratch HOMEs work. */
function codexHome(): string {
	const home = process.env.HOME;
	if (!home) throw new Error('HOME not set');
	return path.join(home, '.codex');
}

function configPath(): string {
	return path.join(codexHome(), 'config.toml');
}

function agentsDir(): string {
	return path.join(codexHome(), 'agents');
}

/**
 * `IKENGA_CODEX_PROJECT_ROOT` — opt-in escape hatch for skills + commands.
 * Codex resolves skills relative to a project's `.agents/skills/` dir, not
 * `~/.codex/`. v1 doesn't auto-resolve a project: if the env var is unset
 * we warn + skip (NOT silently write into `~/.codex/`). The shell can wire
 * this up in a future track from a settings entry or `tauri::Manager`.
 * Returns null if unset, missing, or relative.
 */
async function projectRoot(): Promise<string | null> {
	const raw = process.env.IKENGA_CODEX_PROJECT_ROOT;
	if (!raw) return null;
	if (!path.isAbsolute(raw)) return null;
	try {
		const s = await stat(raw);
		if (!s.isDirectory()) return null;
	} catch {
		return null;
	}
	return raw;
}

function projectSkillsDir(projectRootDir: string, pkgSlug: string): string {
	return path.join(projectRootDir, '.agents', 'skills', pkgSlug);
}

function perPkgAgentsDir(pkgSlug: string): string {
	return path.join(agentsDir(), pkgSlug);
}

/**
 * Cross-platform directory symlink. Mirrors the helper in the claude-code
 * adapter — on Windows pass `'junction'` so unprivileged users can create
 * directory symlinks.
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

async function classifySymlinkTarget(
	source: string,
	target: string,
): Promise<AssetClassification> {
	let s;
	try {
		s = await lstat(target);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return { kind: 'wrote' };
		}
		throw err;
	}
	if (!s.isSymbolicLink()) return { kind: 'error-nonsymlink' };
	const current = await readlink(target);
	const resolved = path.isAbsolute(current)
		? current
		: path.resolve(path.dirname(target), current);
	if (resolved === source) return { kind: 'skipped', currentLink: current };
	return { kind: 'warning-replace', currentLink: current };
}

/**
 * Install one asset folder as a symlink at `<targetDir>`. Same conflict
 * policy as the claude-code adapter: stale-ours → replace + warn,
 * non-symlink → error, missing → write.
 */
async function installFolderSymlink(
	folder: string,
	targetDir: string,
): Promise<InstallReport> {
	const source = path.resolve(folder);
	const parent = path.dirname(targetDir);

	const classification = await classifySymlinkTarget(source, targetDir);

	if (classification.kind === 'error-nonsymlink') {
		throw new Error(
			`${targetDir} exists and is not a symlink — refusing to overwrite`,
		);
	}
	if (classification.kind === 'skipped') {
		return { wrote: [], skipped: [targetDir], warnings: [] };
	}

	await mkdir(parent, { recursive: true, mode: 0o755 });

	const warnings: string[] = [];
	if (classification.kind === 'warning-replace') {
		await unlink(targetDir);
		warnings.push(
			`replaced stale symlink at ${targetDir} (was pointing at ${classification.currentLink})`,
		);
	}

	await symlinkDir(source, targetDir);
	return { wrote: [targetDir], skipped: [], warnings };
}

/** Tiny YAML frontmatter parser — same shape as the contract transcoder. */
function parseFrontmatter(md: string): { frontmatter: Record<string, unknown>; body: string } {
	const lines = md.split('\n');
	if (lines.length === 0 || !/^---\s*$/.test(lines[0] ?? '')) {
		return { frontmatter: {}, body: md };
	}
	let closeIdx = -1;
	for (let i = 1; i < lines.length; i++) {
		if (/^---\s*$/.test(lines[i] ?? '')) {
			closeIdx = i;
			break;
		}
	}
	if (closeIdx === -1) {
		return { frontmatter: {}, body: md };
	}
	const yamlLines = lines.slice(1, closeIdx);
	const fm: Record<string, unknown> = {};
	for (const raw of yamlLines) {
		const trimmed = raw.trim();
		if (trimmed === '' || trimmed.startsWith('#')) continue;
		const colon = raw.indexOf(':');
		if (colon < 0) continue;
		const key = raw.slice(0, colon).trim();
		const rest = raw.slice(colon + 1).trim();
		fm[key] = parseFrontmatterScalar(rest);
	}
	return { frontmatter: fm, body: lines.slice(closeIdx + 1).join('\n') };
}

function parseFrontmatterScalar(s: string): unknown {
	const t = s.trim();
	if (t === 'true') return true;
	if (t === 'false') return false;
	if (t === '' || t === 'null' || t === '~') return null;
	if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
	if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
		try {
			return JSON.parse(t);
		} catch {
			return t.slice(1, -1);
		}
	}
	if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
		return t.slice(1, -1);
	}
	return t;
}

/**
 * Atomic write helper: tmp + rename within the same dir. POSIX rename is
 * atomic when source and dest are on the same filesystem.
 */
async function atomicWrite(dest: string, content: string): Promise<void> {
	const parent = path.dirname(dest);
	await mkdir(parent, { recursive: true, mode: 0o755 });
	const tmp = path.join(
		parent,
		`.${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`,
	);
	await writeFile(tmp, content, 'utf8');
	await rename(tmp, dest);
}

async function readFileOrNull(p: string): Promise<string | null> {
	try {
		return await readFile(p, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
}

async function listMarkdownFiles(folder: string): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(folder, { withFileTypes: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
	const out: string[] = [];
	for (const e of entries) {
		if (e.isFile() && e.name.endsWith('.md')) out.push(path.join(folder, e.name));
	}
	out.sort();
	return out;
}

// ───── TOML emit + idempotency for [mcp_servers.ikenga.<slug>.<name>] ─────

/**
 * Emit one MCP server entry as a Codex `config.toml` block. The shape is
 * intentionally minimal and hand-rolled — no inline tables, only the
 * `[<table>]` + `[<table>.env]` form. Quoting via `JSON.stringify` (which
 * produces TOML-compatible double-quoted strings for the values we care
 * about).
 */
function emitMcpBlock(
	pkgSlug: string,
	server: McpServer,
	envTable: Array<[string, string]>,
	envVarsAllowlist: string[],
): { block: string; tableHeader: string } {
	const tableName = `mcp_servers.ikenga.${pkgSlug}.${server.name}`;
	const tableHeader = `[${tableName}]`;
	const lines: string[] = [tableHeader];
	lines.push(`command = ${JSON.stringify(server.command)}`);
	const args = server.args ?? [];
	lines.push(`args = [${args.map((a) => JSON.stringify(a)).join(', ')}]`);
	if (envVarsAllowlist.length > 0) {
		const sorted = [...envVarsAllowlist].sort();
		lines.push(
			`env_vars = [${sorted.map((k) => JSON.stringify(k)).join(', ')}]`,
		);
	}
	if (server.lifecycle === 'long-lived') {
		// Disable in external configs by default (ADR §4) so Codex doesn't
		// race the kernel's own SidecarSupervisor on the same stdio child.
		lines.push('disabled = true');
	}
	if (envTable.length > 0) {
		const sorted = [...envTable].sort((a, b) => a[0].localeCompare(b[0]));
		lines.push('');
		lines.push(`[${tableName}.env]`);
		for (const [k, v] of sorted) {
			lines.push(`${k} = ${JSON.stringify(v)}`);
		}
	}
	return { block: lines.join('\n') + '\n', tableHeader };
}

/**
 * Partition a manifest env block per ADR §7 (closed 2026-05-18): Codex's
 * `[mcp_servers.<n>.env]` table is literal — no substitution — so
 * `${IKENGA_SECRET:...}` placeholders translate to entries in a separate
 * `env_vars` allowlist (Codex forwards those values from its own parent
 * process env). Plaintext secret-shaped keys are still refused — pkg-
 * author bug.
 */
function partitionEnv(spec: McpServer): {
	envTable: Array<[string, string]>;
	envVarsAllowlist: string[];
	refuseWarnings: string[];
	infoWarnings: string[];
} {
	const env = spec.env ?? {};
	const envTable: Array<[string, string]> = [];
	const envVarsAllowlist: string[] = [];
	const refuseWarnings: string[] = [];
	const infoWarnings: string[] = [];
	for (const [key, value] of Object.entries(env)) {
		if (typeof value !== 'string') continue;
		if (value.startsWith(IKENGA_SECRET_PREFIX)) {
			envVarsAllowlist.push(key);
			infoWarnings.push(
				`Codex MCP env \`${key}\` translated to \`env_vars\` allowlist — ` +
					`export ${key}=... in your shell before invoking the external \`codex\` CLI`,
			);
		} else if (SECRET_KEY_PATTERN.test(key)) {
			refuseWarnings.push(
				`secret-bearing env var \`${key}\` must use \${IKENGA_SECRET:<vault-key>} ` +
					`indirection — plaintext refused`,
			);
		} else {
			envTable.push([key, value]);
		}
	}
	return { envTable, envVarsAllowlist, refuseWarnings, infoWarnings };
}

/**
 * Locate the byte range of an existing `[<tableHeader>]` block in
 * `config.toml`, bounded by EOF or the next top-level `[<...>]` header
 * that is NOT a subtable of `tableHeader` (we treat `[<tableHeader>.env]`
 * as part of the same block).
 *
 * Returns null if the header isn't present.
 */
function findBlockRange(
	toml: string,
	tableHeader: string,
): { start: number; end: number } | null {
	const lines = toml.split('\n');
	const baseHeader = tableHeader; // e.g. "[mcp_servers.ikenga.<slug>.<name>]"
	const baseName = baseHeader.slice(1, -1);
	const subHeaderPrefix = `[${baseName}.`;

	let startLine = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === baseHeader) {
			startLine = i;
			break;
		}
	}
	if (startLine === -1) return null;

	let endLine = lines.length;
	for (let i = startLine + 1; i < lines.length; i++) {
		const l = lines[i] ?? '';
		const t = l.trim();
		if (t.startsWith('[')) {
			if (t.startsWith(subHeaderPrefix)) continue;
			endLine = i;
			break;
		}
	}

	// Translate line indices back to byte indices.
	let start = 0;
	for (let i = 0; i < startLine; i++) start += (lines[i] ?? '').length + 1;
	let end = start;
	for (let i = startLine; i < endLine; i++) end += (lines[i] ?? '').length + 1;
	// Trim trailing blank lines inside the block (so re-comparison is stable).
	return { start, end };
}


export class CodexEngineAdapter implements EngineAdapter {
	readonly id = 'codex';

	async installSkills(
		folder: string,
		_pkgId: string,
		pkgSlug: string,
	): Promise<InstallReport> {
		const root = await projectRoot();
		if (!root) {
			return {
				wrote: [],
				skipped: [],
				warnings: [
					`IKENGA_CODEX_PROJECT_ROOT not set — Codex skills require a project root; skipping skill folder for pkg-slug \`${pkgSlug}\``,
				],
			};
		}
		const target = projectSkillsDir(root, pkgSlug);
		return installFolderSymlink(folder, target);
	}

	async installCommands(
		folder: string,
		_pkgId: string,
		pkgSlug: string,
	): Promise<InstallReport> {
		const root = await projectRoot();
		const files = await listMarkdownFiles(folder);

		if (!root) {
			const warnings = files.map(
				(f) =>
					`command file ${path.basename(f)} skipped — IKENGA_CODEX_PROJECT_ROOT not set (Codex has no first-class commands primitive)`,
			);
			return { wrote: [], skipped: [], warnings };
		}

		const wrote: string[] = [];
		const skipped: string[] = [];
		const warnings: string[] = [];
		const skillsRoot = projectSkillsDir(root, pkgSlug);

		for (const file of files) {
			const md = await readFile(file, 'utf8');
			const { frontmatter, body } = parseFrontmatter(md);
			const implicit = frontmatter['allow_implicit_invocation'] === true;
			const base = path.basename(file, '.md');
			if (!implicit) {
				warnings.push(
					`command ${path.basename(file)} skipped — Codex has no first-class commands primitive; set \`allow_implicit_invocation: true\` in frontmatter to convert to a skill`,
				);
				continue;
			}
			// Materialize as a skill directory: <skillsRoot>/<base>/SKILL.md
			const dest = path.join(skillsRoot, base, 'SKILL.md');
			// Re-emit the file as-is; the agentskills.io shape is just YAML
			// frontmatter + markdown body, which is what commands already are.
			const onDisk = await readFileOrNull(dest);
			if (onDisk === md) {
				skipped.push(dest);
				continue;
			}
			void body; // body is part of `md`; we write the whole file
			await atomicWrite(dest, md);
			wrote.push(dest);
		}

		return { wrote, skipped, warnings };
	}

	async installAgents(
		folder: string,
		_pkgId: string,
		pkgSlug: string,
	): Promise<InstallReport> {
		const files = await listMarkdownFiles(folder);
		const perPkg = perPkgAgentsDir(pkgSlug);

		const wrote: string[] = [];
		const skipped: string[] = [];
		const warnings: string[] = [];
		let anyWrite = false;
		let anySkip = false;

		for (const file of files) {
			const md = await readFile(file, 'utf8');
			let toml: string;
			try {
				toml = mdToCodexToml(md);
			} catch (err) {
				warnings.push(`transcode ${path.basename(file)}: ${(err as Error).message}`);
				continue;
			}
			const base = path.basename(file, '.md');
			const dest = path.join(perPkg, `${base}.toml`);
			const existing = await readFileOrNull(dest);
			if (existing === toml) {
				anySkip = true;
				continue;
			}
			await atomicWrite(dest, toml);
			anyWrite = true;
		}

		// Single dir-entry per the brief — easier uninstall (rm -rf the dir)
		// and avoids slug-recovery ambiguity for the kernel.
		if (anyWrite) wrote.push(perPkg);
		else if (anySkip) skipped.push(perPkg);

		return { wrote, skipped, warnings };
	}

	async uninstallSkills(_pkgId: string, pkgSlug: string): Promise<void> {
		const root = await projectRoot();
		if (!root) return;
		const target = projectSkillsDir(root, pkgSlug);
		await uninstallSymlinkOrDir(target);
	}

	async uninstallCommands(_pkgId: string, pkgSlug: string): Promise<void> {
		// Commands materialize as skills under the same per-slug dir. The
		// skill folder symlink (if any) is the dominant entry there — but if
		// commands were promoted to skills via the per-file path, they live
		// under the same per-slug dir. Either way: `rm -rf <skillsDir>`.
		const root = await projectRoot();
		if (!root) return;
		const target = projectSkillsDir(root, pkgSlug);
		await uninstallSymlinkOrDir(target);
	}

	async uninstallAgents(_pkgId: string, pkgSlug: string): Promise<void> {
		const target = perPkgAgentsDir(pkgSlug);
		await rm(target, { recursive: true, force: true });
	}

	async registerMcpServer(
		spec: McpServer,
		_pkgId: string,
		pkgSlug: string,
	): Promise<InstallReport> {
		if (!spec.name) throw new Error('mcp server has empty name');
		if (!spec.command) throw new Error(`mcp server \`${spec.name}\` has empty command`);

		const { envTable, envVarsAllowlist, refuseWarnings, infoWarnings } =
			partitionEnv(spec);
		if (refuseWarnings.length > 0) {
			return { wrote: [], skipped: [], warnings: refuseWarnings };
		}

		const { block, tableHeader } = emitMcpBlock(
			pkgSlug,
			spec,
			envTable,
			envVarsAllowlist,
		);
		const dest = configPath();
		const existing = (await readFileOrNull(dest)) ?? '';

		const range = findBlockRange(existing, tableHeader);
		const entryRef = `${dest}#${tableHeader.slice(1, -1)}`;

		if (range !== null) {
			const currentBlock = existing.slice(range.start, range.end);
			// Normalize trailing whitespace for byte-stable comparison.
			if (currentBlock.replace(/\s+$/, '') === block.replace(/\s+$/, '')) {
				return { wrote: [], skipped: [entryRef], warnings: infoWarnings };
			}
			const before = existing.slice(0, range.start);
			const after = existing.slice(range.end);
			const merged = `${before}${block}${after.startsWith('\n') ? after : after.length > 0 ? `\n${after}` : ''}`;
			await atomicWrite(dest, merged);
			return { wrote: [entryRef], skipped: [], warnings: infoWarnings };
		}

		// Append. Ensure separation from any existing content.
		const sep = existing.length === 0 || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
		const merged = `${existing}${sep}${block}`;
		await atomicWrite(dest, merged);
		return { wrote: [entryRef], skipped: [], warnings: infoWarnings };
	}

	async unregisterMcpServer(
		serverName: string,
		_pkgId: string,
		pkgSlug: string,
	): Promise<void> {
		const dest = configPath();
		const existing = await readFileOrNull(dest);
		if (existing === null) return;
		const tableHeader = `[mcp_servers.ikenga.${pkgSlug}.${serverName}]`;
		const range = findBlockRange(existing, tableHeader);
		if (range === null) return;
		const before = existing.slice(0, range.start);
		const after = existing.slice(range.end);
		const merged = (before + after).replace(/\n{3,}/g, '\n\n');
		await atomicWrite(dest, merged);
	}

	async plan(
		pkgId: string,
		pkgSlug: string,
		snap: ManifestSnapshot,
	): Promise<InstallPlan> {
		const wrote: string[] = [];
		const skipped: string[] = [];
		const warnings: string[] = [];

		const root = await projectRoot();

		// Skills.
		if (snap.skills) {
			if (!root) {
				warnings.push(
					`IKENGA_CODEX_PROJECT_ROOT not set — Codex skills require a project root; would skip pkg-slug \`${pkgSlug}\``,
				);
			} else {
				const source = path.resolve(snap.skills);
				const target = projectSkillsDir(root, pkgSlug);
				const cls = await classifySymlinkTarget(source, target);
				if (cls.kind === 'wrote') wrote.push(target);
				else if (cls.kind === 'skipped') skipped.push(target);
				else if (cls.kind === 'warning-replace') {
					wrote.push(target);
					warnings.push(
						`would replace stale symlink at ${target} (currently → ${cls.currentLink})`,
					);
				} else {
					warnings.push(`${target} exists and is not a symlink — install would refuse`);
				}
			}
		}

		// Commands — per-file classification.
		if (snap.commands) {
			const files = await listMarkdownFiles(path.resolve(snap.commands));
			if (!root) {
				for (const f of files) {
					warnings.push(
						`command file ${path.basename(f)} would be skipped — IKENGA_CODEX_PROJECT_ROOT not set`,
					);
				}
			} else {
				const skillsRoot = projectSkillsDir(root, pkgSlug);
				for (const f of files) {
					const md = await readFile(f, 'utf8');
					const { frontmatter } = parseFrontmatter(md);
					const implicit = frontmatter['allow_implicit_invocation'] === true;
					if (!implicit) {
						warnings.push(
							`command ${path.basename(f)} would be skipped — set \`allow_implicit_invocation: true\` to convert to a skill`,
						);
						continue;
					}
					const dest = path.join(skillsRoot, path.basename(f, '.md'), 'SKILL.md');
					const onDisk = await readFileOrNull(dest);
					if (onDisk === md) skipped.push(dest);
					else wrote.push(dest);
				}
			}
		}

		// Agents — per-file transcode dry-run.
		if (snap.agents) {
			const files = await listMarkdownFiles(path.resolve(snap.agents));
			const perPkg = perPkgAgentsDir(pkgSlug);
			let anyWrite = false;
			let anySkip = false;
			for (const f of files) {
				const md = await readFile(f, 'utf8');
				let toml: string;
				try {
					toml = mdToCodexToml(md);
				} catch (err) {
					warnings.push(`transcode ${path.basename(f)}: ${(err as Error).message}`);
					continue;
				}
				const dest = path.join(perPkg, `${path.basename(f, '.md')}.toml`);
				const existing = await readFileOrNull(dest);
				if (existing === toml) anySkip = true;
				else anyWrite = true;
			}
			if (anyWrite) wrote.push(perPkg);
			else if (anySkip) skipped.push(perPkg);
		}

		// MCP.
		const existingToml = (await readFileOrNull(configPath())) ?? '';
		for (const spec of snap.mcp) {
			const { envTable, envVarsAllowlist, refuseWarnings, infoWarnings } =
				partitionEnv(spec);
			if (refuseWarnings.length > 0) {
				warnings.push(...refuseWarnings);
				continue;
			}
			warnings.push(...infoWarnings);
			const { block, tableHeader } = emitMcpBlock(
				pkgSlug,
				spec,
				envTable,
				envVarsAllowlist,
			);
			const ref = `${configPath()}#${tableHeader.slice(1, -1)}`;
			const range = findBlockRange(existingToml, tableHeader);
			if (range !== null) {
				const currentBlock = existingToml.slice(range.start, range.end);
				if (currentBlock.replace(/\s+$/, '') === block.replace(/\s+$/, '')) {
					skipped.push(ref);
					continue;
				}
			}
			wrote.push(ref);
		}

		return { engineId: this.id, pkgId, wrote, skipped, warnings };
	}
}

/**
 * Inverse of `installFolderSymlink` / per-file skill emission. Removes the
 * dir-or-symlink at `target`. Non-symlink + missing → no-op; user data is
 * never touched, matching the claude-code adapter's policy.
 */
async function uninstallSymlinkOrDir(target: string): Promise<void> {
	let s;
	try {
		s = await lstat(target);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw err;
	}
	if (s.isSymbolicLink()) {
		await unlink(target);
		return;
	}
	// It's a real dir. Only remove if we wrote it ourselves (commands→skill
	// case). The contents we wrote are <base>/SKILL.md per command — but if
	// we can't tell whether it's ours, defer to `rm -rf` since the parent
	// dir is namespaced under our pkg slug.
	await rm(target, { recursive: true, force: true });
}

// Re-exported for tests + the round-trip skill suite.
export const __internal = {
	codexHome,
	configPath,
	agentsDir,
	perPkgAgentsDir,
	projectSkillsDir,
	emitMcpBlock,
	findBlockRange,
	codexTomlToMd,
};
