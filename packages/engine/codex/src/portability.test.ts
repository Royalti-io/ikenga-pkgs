/**
 * Tests for `CodexEngineAdapter` (ADR-012 Track C).
 *
 * Every test runs in an `os.tmpdir()` scratch directory used as HOME so the
 * real `~/.codex/` is never touched. The HOME override is restored after
 * each test. Where a test needs `IKENGA_CODEX_PROJECT_ROOT`, it sets a
 * second tempdir and restores the previous value.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { McpServer } from '@ikenga/contract/manifest';
import { codexTomlToMd } from '@ikenga/contract/engine';
import { CodexEngineAdapter, __internal } from './portability.js';

function mcpSpec(partial: Partial<McpServer> & { name: string; command: string }): McpServer {
	return {
		args: [],
		env: {},
		restart_when_changed: [],
		auto_restart: true,
		...partial,
	};
}

interface Scratch {
	home: string;
	projectRoot: string;
	pkgRoot: string;
	skillsFolder: string;
	commandsFolder: string;
	agentsFolder: string;
	cleanup: () => Promise<void>;
}

async function makeScratch(): Promise<Scratch> {
	const home = await mkdtemp(path.join(tmpdir(), 'codex-adapter-'));
	const projectRoot = await mkdtemp(path.join(tmpdir(), 'codex-project-'));
	const pkgRoot = path.join(home, 'pkg');
	const skillsFolder = path.join(pkgRoot, 'skills');
	const commandsFolder = path.join(pkgRoot, 'commands');
	const agentsFolder = path.join(pkgRoot, 'agents');
	await mkdir(skillsFolder, { recursive: true });
	await mkdir(commandsFolder, { recursive: true });
	await mkdir(agentsFolder, { recursive: true });
	await writeFile(path.join(skillsFolder, 'SKILL.md'), '# test skill\n', 'utf8');

	const prevHome = process.env.HOME;
	const prevProj = process.env.IKENGA_CODEX_PROJECT_ROOT;
	process.env.HOME = home;
	// Default: do NOT set project root. Tests opt in by setting it themselves.
	delete process.env.IKENGA_CODEX_PROJECT_ROOT;

	return {
		home,
		projectRoot,
		pkgRoot,
		skillsFolder,
		commandsFolder,
		agentsFolder,
		cleanup: async () => {
			process.env.HOME = prevHome;
			if (prevProj === undefined) delete process.env.IKENGA_CODEX_PROJECT_ROOT;
			else process.env.IKENGA_CODEX_PROJECT_ROOT = prevProj;
			await rm(home, { recursive: true, force: true });
			await rm(projectRoot, { recursive: true, force: true });
		},
	};
}

const PKG_ID = 'com.ikenga.test';
const PKG_SLUG = 'com-ikenga-test';

test('installAgents transcodes .md to .toml under ~/.codex/agents/<slug>/', async () => {
	const s = await makeScratch();
	try {
		await writeFile(
			path.join(s.agentsFolder, 'reviewer.md'),
			[
				'---',
				'name: reviewer',
				'description: Reviews code changes',
				'model: o4-mini',
				'---',
				'',
				'You are a code reviewer.',
				'Focus on correctness.',
			].join('\n'),
			'utf8',
		);

		const adapter = new CodexEngineAdapter();
		const report = await adapter.installAgents(s.agentsFolder, PKG_ID, PKG_SLUG);

		const perPkg = __internal.perPkgAgentsDir(PKG_SLUG);
		assert.deepEqual(report.wrote, [perPkg]);
		assert.deepEqual(report.skipped, []);
		assert.deepEqual(report.warnings, []);

		const tomlPath = path.join(perPkg, 'reviewer.toml');
		const toml = await readFile(tomlPath, 'utf8');
		assert.match(toml, /name = "reviewer"/);
		assert.match(toml, /model = "o4-mini"/);
		assert.match(toml, /system_prompt = """/);
	} finally {
		await s.cleanup();
	}
});

test('installAgents round-trip: re-read .toml back to MD frontmatter keys', async () => {
	const s = await makeScratch();
	try {
		const md = [
			'---',
			'name: planner',
			'description: Builds task plans',
			'model: gpt-5',
			'---',
			'',
			'You are a planner.',
		].join('\n');
		await writeFile(path.join(s.agentsFolder, 'planner.md'), md, 'utf8');

		const adapter = new CodexEngineAdapter();
		await adapter.installAgents(s.agentsFolder, PKG_ID, PKG_SLUG);

		const tomlPath = path.join(__internal.perPkgAgentsDir(PKG_SLUG), 'planner.toml');
		const toml = await readFile(tomlPath, 'utf8');
		const md2 = codexTomlToMd(toml);

		assert.match(md2, /name: planner/);
		assert.match(md2, /description: "?Builds task plans"?/);
		assert.match(md2, /model: gpt-5/);
		assert.match(md2, /You are a planner\./);
	} finally {
		await s.cleanup();
	}
});

test('installAgents is idempotent on re-call', async () => {
	const s = await makeScratch();
	try {
		await writeFile(
			path.join(s.agentsFolder, 'a.md'),
			'---\nname: a\ndescription: X\n---\n\nbody',
			'utf8',
		);
		const adapter = new CodexEngineAdapter();
		const r1 = await adapter.installAgents(s.agentsFolder, PKG_ID, PKG_SLUG);
		assert.equal(r1.wrote.length, 1);

		const r2 = await adapter.installAgents(s.agentsFolder, PKG_ID, PKG_SLUG);
		assert.deepEqual(r2.wrote, []);
		assert.equal(r2.skipped.length, 1);
	} finally {
		await s.cleanup();
	}
});

test('installSkills warns and skips when IKENGA_CODEX_PROJECT_ROOT is unset', async () => {
	const s = await makeScratch();
	try {
		const adapter = new CodexEngineAdapter();
		const report = await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);

		assert.deepEqual(report.wrote, []);
		assert.deepEqual(report.skipped, []);
		assert.equal(report.warnings.length, 1);
		assert.match(report.warnings[0]!, /IKENGA_CODEX_PROJECT_ROOT not set/);

		// Nothing materialized.
		const codexSkills = path.join(s.home, '.codex', 'skills');
		await assert.rejects(() => lstat(codexSkills));
	} finally {
		await s.cleanup();
	}
});

test('installSkills writes a symlink under <projectRoot>/.agents/skills when env var set', async () => {
	const s = await makeScratch();
	try {
		process.env.IKENGA_CODEX_PROJECT_ROOT = s.projectRoot;
		const adapter = new CodexEngineAdapter();
		const report = await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);

		const expected = path.join(s.projectRoot, '.agents', 'skills', PKG_SLUG);
		assert.deepEqual(report.wrote, [expected]);
		const link = await readlink(expected);
		assert.equal(link, s.skillsFolder);
	} finally {
		await s.cleanup();
	}
});

test('installCommands with allow_implicit_invocation: true writes as a skill', async () => {
	const s = await makeScratch();
	try {
		process.env.IKENGA_CODEX_PROJECT_ROOT = s.projectRoot;
		const cmd = [
			'---',
			'name: blog-pipeline',
			'description: Full blog creation flow',
			'allow_implicit_invocation: true',
			'---',
			'',
			'Do the thing.',
		].join('\n');
		await writeFile(path.join(s.commandsFolder, 'blog-pipeline.md'), cmd, 'utf8');

		const adapter = new CodexEngineAdapter();
		const report = await adapter.installCommands(s.commandsFolder, PKG_ID, PKG_SLUG);

		const dest = path.join(
			s.projectRoot,
			'.agents',
			'skills',
			PKG_SLUG,
			'blog-pipeline',
			'SKILL.md',
		);
		assert.deepEqual(report.wrote, [dest]);
		assert.deepEqual(report.warnings, []);
		const onDisk = await readFile(dest, 'utf8');
		assert.equal(onDisk, cmd);
	} finally {
		await s.cleanup();
	}
});

test('installCommands without allow_implicit_invocation warns and skips per file', async () => {
	const s = await makeScratch();
	try {
		process.env.IKENGA_CODEX_PROJECT_ROOT = s.projectRoot;
		await writeFile(
			path.join(s.commandsFolder, 'plain.md'),
			'---\nname: plain\ndescription: nope\n---\n\nbody',
			'utf8',
		);

		const adapter = new CodexEngineAdapter();
		const report = await adapter.installCommands(s.commandsFolder, PKG_ID, PKG_SLUG);

		assert.deepEqual(report.wrote, []);
		assert.deepEqual(report.skipped, []);
		assert.equal(report.warnings.length, 1);
		assert.match(report.warnings[0]!, /allow_implicit_invocation/);
	} finally {
		await s.cleanup();
	}
});

test('registerMcpServer writes a [mcp_servers.ikenga.<slug>.<name>] table to ~/.codex/config.toml', async () => {
	const s = await makeScratch();
	try {
		const adapter = new CodexEngineAdapter();
		const spec = mcpSpec({
			name: 'royalti-cms',
			command: 'bun',
			args: ['run', 'src/index.ts'],
		});
		const first = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);

		const configPath = path.join(s.home, '.codex', 'config.toml');
		const ref = `${configPath}#mcp_servers.ikenga.${PKG_SLUG}.royalti-cms`;
		assert.deepEqual(first.wrote, [ref]);

		const toml = await readFile(configPath, 'utf8');
		assert.match(toml, /\[mcp_servers\.ikenga\.com-ikenga-test\.royalti-cms\]/);
		assert.match(toml, /command = "bun"/);
		assert.match(toml, /args = \["run", "src\/index\.ts"\]/);

		// Idempotent re-run.
		const second = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);
		assert.deepEqual(second.wrote, []);
		assert.deepEqual(second.skipped, [ref]);
	} finally {
		await s.cleanup();
	}
});

test('registerMcpServer refuses ${IKENGA_SECRET:...} placeholders per Codex strict-refusal posture', async () => {
	const s = await makeScratch();
	try {
		const adapter = new CodexEngineAdapter();
		const spec = mcpSpec({
			name: 'exa',
			command: 'bun',
			env: { EXA_API_KEY: '${IKENGA_SECRET:exa_api_key}' },
		});

		const report = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);
		assert.deepEqual(report.wrote, []);
		assert.deepEqual(report.skipped, []);
		assert.ok(
			report.warnings.some((w) => /env-var indirection semantics unverified/.test(w)),
			`expected unverified-semantics warning, got ${JSON.stringify(report.warnings)}`,
		);

		// File was never created.
		const configPath = path.join(s.home, '.codex', 'config.toml');
		await assert.rejects(
			() => readFile(configPath, 'utf8'),
			(err: NodeJS.ErrnoException) => err.code === 'ENOENT',
		);
	} finally {
		await s.cleanup();
	}
});

test('registerMcpServer refuses plaintext *_API_KEY env values with a warning', async () => {
	const s = await makeScratch();
	try {
		const adapter = new CodexEngineAdapter();
		const spec = mcpSpec({
			name: 'exa',
			command: 'bun',
			env: { EXA_API_KEY: 'sk-plain-text-leak' },
		});

		const report = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);
		assert.deepEqual(report.wrote, []);
		assert.deepEqual(report.skipped, []);
		assert.ok(
			report.warnings.some((w) => /EXA_API_KEY/.test(w)),
			`expected EXA_API_KEY warning, got ${JSON.stringify(report.warnings)}`,
		);
	} finally {
		await s.cleanup();
	}
});

test('unregisterMcpServer removes only this pkg’s table and leaves user content alone', async () => {
	const s = await makeScratch();
	try {
		const adapter = new CodexEngineAdapter();
		const configPath = path.join(s.home, '.codex', 'config.toml');

		// Seed: a user-authored table + a registered ikenga entry.
		await mkdir(path.dirname(configPath), { recursive: true });
		await writeFile(
			configPath,
			[
				'[user]',
				'mode = "default"',
				'',
				'[mcp_servers.user-thing]',
				'command = "echo"',
				'',
			].join('\n'),
			'utf8',
		);

		await adapter.registerMcpServer(
			mcpSpec({ name: 'mine', command: 'bun' }),
			PKG_ID,
			PKG_SLUG,
		);

		// Sanity: both tables present.
		let toml = await readFile(configPath, 'utf8');
		assert.match(toml, /\[user\]/);
		assert.match(toml, /\[mcp_servers\.user-thing\]/);
		assert.match(toml, new RegExp(`\\[mcp_servers\\.ikenga\\.${PKG_SLUG}\\.mine\\]`));

		await adapter.unregisterMcpServer('mine', PKG_ID, PKG_SLUG);

		toml = await readFile(configPath, 'utf8');
		assert.match(toml, /\[user\]/);
		assert.match(toml, /\[mcp_servers\.user-thing\]/);
		assert.doesNotMatch(
			toml,
			new RegExp(`\\[mcp_servers\\.ikenga\\.${PKG_SLUG}\\.mine\\]`),
		);
	} finally {
		await s.cleanup();
	}
});

test('uninstallAgents removes the per-slug agents dir', async () => {
	const s = await makeScratch();
	try {
		await writeFile(
			path.join(s.agentsFolder, 'a.md'),
			'---\nname: a\n---\nbody',
			'utf8',
		);
		const adapter = new CodexEngineAdapter();
		await adapter.installAgents(s.agentsFolder, PKG_ID, PKG_SLUG);

		const perPkg = __internal.perPkgAgentsDir(PKG_SLUG);
		assert.ok((await lstat(perPkg)).isDirectory());

		await adapter.uninstallAgents(PKG_ID, PKG_SLUG);
		await assert.rejects(() => lstat(perPkg));
	} finally {
		await s.cleanup();
	}
});
