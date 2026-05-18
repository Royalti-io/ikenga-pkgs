/**
 * Tests for `ClaudeCodeEngineAdapter` (ADR-012 Track C).
 *
 * Every test runs in an `os.tmpdir()` scratch directory used as HOME so the
 * real `~/.claude/` is never touched. The HOME override is restored after
 * each test.
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
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { McpServer } from '@ikenga/contract/manifest';
import { ClaudeCodeEngineAdapter } from './portability.js';

/** Materialize a McpServer with all the Zod-required defaults filled in. */
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
	pkgRoot: string;
	skillsFolder: string;
	cleanup: () => Promise<void>;
}

async function makeScratch(): Promise<Scratch> {
	const home = await mkdtemp(path.join(tmpdir(), 'cc-adapter-'));
	const pkgRoot = path.join(home, 'pkg');
	const skillsFolder = path.join(pkgRoot, 'skills');
	await mkdir(skillsFolder, { recursive: true });
	await writeFile(path.join(skillsFolder, 'SKILL.md'), '# test skill\n', 'utf8');

	const prevHome = process.env.HOME;
	process.env.HOME = home;

	return {
		home,
		pkgRoot,
		skillsFolder,
		cleanup: async () => {
			process.env.HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		},
	};
}

const PKG_ID = 'com.ikenga.test';
const PKG_SLUG = 'com-ikenga-test';

test('installSkills creates a symlink when the target does not exist', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();
		const report = await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);

		const target = path.join(s.home, '.claude', 'skills', PKG_SLUG);
		assert.deepEqual(report.wrote, [target]);
		assert.deepEqual(report.skipped, []);
		assert.deepEqual(report.warnings, []);

		const stat = await lstat(target);
		assert.ok(stat.isSymbolicLink(), 'target should be a symlink');
		const link = await readlink(target);
		assert.equal(link, s.skillsFolder);
	} finally {
		await s.cleanup();
	}
});

test('installSkills is idempotent on repeat with same inputs', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();
		await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);
		const second = await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);

		const target = path.join(s.home, '.claude', 'skills', PKG_SLUG);
		assert.deepEqual(second.wrote, []);
		assert.deepEqual(second.skipped, [target]);
		assert.deepEqual(second.warnings, []);
	} finally {
		await s.cleanup();
	}
});

test('installSkills refuses to overwrite a non-symlink at the target', async () => {
	const s = await makeScratch();
	try {
		const target = path.join(s.home, '.claude', 'skills', PKG_SLUG);
		await mkdir(target, { recursive: true });
		await writeFile(path.join(target, 'user.md'), 'hand-crafted\n', 'utf8');

		const adapter = new ClaudeCodeEngineAdapter();
		await assert.rejects(
			() => adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG),
			/exists and is not a symlink — refusing to overwrite/,
		);

		// Original contents untouched.
		const userFile = await readFile(path.join(target, 'user.md'), 'utf8');
		assert.equal(userFile, 'hand-crafted\n');
	} finally {
		await s.cleanup();
	}
});

test('installSkills replaces a stale symlink pointing elsewhere, with a warning', async () => {
	const s = await makeScratch();
	try {
		// Drop a stale symlink at the target pointing at a different dir.
		const stalePoint = path.join(s.home, 'stale-source');
		await mkdir(stalePoint, { recursive: true });
		const parent = path.join(s.home, '.claude', 'skills');
		await mkdir(parent, { recursive: true });
		const target = path.join(parent, PKG_SLUG);
		await symlink(stalePoint, target);

		const adapter = new ClaudeCodeEngineAdapter();
		const report = await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);

		assert.deepEqual(report.wrote, [target]);
		assert.deepEqual(report.skipped, []);
		assert.equal(report.warnings.length, 1);
		assert.match(report.warnings[0]!, /replaced stale symlink/);

		const link = await readlink(target);
		assert.equal(link, s.skillsFolder);
	} finally {
		await s.cleanup();
	}
});

test('registerMcpServer writes the namespaced entry atomically and idempotently', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();
		const spec = mcpSpec({
			name: 'royalti-cms',
			command: 'bun',
			args: ['run', 'src/index.ts'],
		});
		const first = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);

		const settingsPath = path.join(s.home, '.claude', 'settings.json');
		const expectedKey = `ikenga.${PKG_SLUG}.royalti-cms`;
		assert.deepEqual(first.wrote, [`${settingsPath}#${expectedKey}`]);
		assert.deepEqual(first.skipped, []);
		assert.deepEqual(first.warnings, []);

		const onDisk = JSON.parse(await readFile(settingsPath, 'utf8'));
		assert.deepEqual(onDisk.mcpServers[expectedKey], {
			type: 'stdio',
			command: 'bun',
			args: ['run', 'src/index.ts'],
			env: {},
		});

		// Idempotent re-run.
		const second = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);
		assert.deepEqual(second.wrote, []);
		assert.deepEqual(second.skipped, [`${settingsPath}#${expectedKey}`]);
	} finally {
		await s.cleanup();
	}
});

test('registerMcpServer refuses plaintext *_API_KEY env values with a warning', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();
		const spec = mcpSpec({
			name: 'exa',
			command: 'bun',
			env: { EXA_API_KEY: 'sk-plain-text-leak' },
		});

		const report = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);
		assert.deepEqual(report.wrote, []);
		assert.deepEqual(report.skipped, []);
		assert.equal(report.warnings.length, 1);
		assert.match(report.warnings[0]!, /EXA_API_KEY/);
		assert.match(report.warnings[0]!, /\$\{IKENGA_SECRET:/);

		// File was never created.
		const settingsPath = path.join(s.home, '.claude', 'settings.json');
		await assert.rejects(
			() => readFile(settingsPath, 'utf8'),
			(err: NodeJS.ErrnoException) => err.code === 'ENOENT',
		);
	} finally {
		await s.cleanup();
	}
});

test('registerMcpServer accepts properly indirected secret env values', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();
		const spec = mcpSpec({
			name: 'exa',
			command: 'bun',
			env: { EXA_API_KEY: '${IKENGA_SECRET:exa_api_key}' },
		});

		const report = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);
		assert.equal(report.wrote.length, 1);
		assert.deepEqual(report.warnings, []);
	} finally {
		await s.cleanup();
	}
});

test('registerMcpServer with lifecycle: long-lived sets disabled: true', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();
		const spec = mcpSpec({
			name: 'pkg-browser',
			command: 'bun',
			lifecycle: 'long-lived',
		});

		await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);

		const settingsPath = path.join(s.home, '.claude', 'settings.json');
		const onDisk = JSON.parse(await readFile(settingsPath, 'utf8'));
		const entry = onDisk.mcpServers[`ikenga.${PKG_SLUG}.pkg-browser`];
		assert.equal(entry.disabled, true);
	} finally {
		await s.cleanup();
	}
});

test('unregisterMcpServer removes only this pkg’s key and leaves others alone', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();
		const settingsPath = path.join(s.home, '.claude', 'settings.json');

		// Seed: one user entry + one ikenga entry from another pkg.
		await mkdir(path.dirname(settingsPath), { recursive: true });
		const seed = {
			mcpServers: {
				'user-entry': { type: 'stdio', command: 'echo' },
				'ikenga.other-pkg.thing': { type: 'stdio', command: 'echo' },
			},
		};
		await writeFile(settingsPath, JSON.stringify(seed), 'utf8');

		// Register ours.
		await adapter.registerMcpServer(
			mcpSpec({ name: 'mine', command: 'bun' }),
			PKG_ID,
			PKG_SLUG,
		);

		// Unregister.
		await adapter.unregisterMcpServer('mine', PKG_ID, PKG_SLUG);

		const onDisk = JSON.parse(await readFile(settingsPath, 'utf8'));
		assert.deepEqual(Object.keys(onDisk.mcpServers).sort(), [
			'ikenga.other-pkg.thing',
			'user-entry',
		]);
	} finally {
		await s.cleanup();
	}
});

test('plan() classifies wrote/skipped/warning without touching disk', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();

		// Pre-existing settings with one matching entry (skipped) and one
		// different entry (would be replaced — wrote).
		const settingsPath = path.join(s.home, '.claude', 'settings.json');
		await mkdir(path.dirname(settingsPath), { recursive: true });
		const seed = {
			mcpServers: {
				[`ikenga.${PKG_SLUG}.alpha`]: {
					type: 'stdio',
					command: 'bun',
					args: [],
					env: {},
				},
			},
		};
		await writeFile(settingsPath, JSON.stringify(seed), 'utf8');

		const snapshotMtimeBefore = (await lstat(settingsPath)).mtimeMs;

		const plan = await adapter.plan(PKG_ID, PKG_SLUG, {
			id: PKG_ID,
			slug: PKG_SLUG,
			skills: s.skillsFolder,
			mcp: [
				mcpSpec({ name: 'alpha', command: 'bun' }), // same → skipped
				mcpSpec({ name: 'beta', command: 'node' }), // new → wrote
				mcpSpec({
					name: 'leaky',
					command: 'bun',
					env: { LEAK_API_KEY: 'sk-plain' },
				}), // secret refusal → warning, no wrote
			],
		});

		assert.equal(plan.engineId, 'claude-code');
		assert.equal(plan.pkgId, PKG_ID);

		// Skills folder target absent → wrote.
		const skillsTarget = path.join(s.home, '.claude', 'skills', PKG_SLUG);
		assert.ok(plan.wrote.includes(skillsTarget), 'plan should include skills target in wrote');

		// One MCP wrote, one skipped, one warning.
		assert.ok(plan.wrote.some((p) => p.endsWith(`#ikenga.${PKG_SLUG}.beta`)));
		assert.ok(plan.skipped.some((p) => p.endsWith(`#ikenga.${PKG_SLUG}.alpha`)));
		assert.ok(plan.warnings.some((w) => /LEAK_API_KEY/.test(w)));

		// Disk untouched.
		await assert.rejects(() => lstat(skillsTarget));
		const after = (await lstat(settingsPath)).mtimeMs;
		assert.equal(after, snapshotMtimeBefore, 'settings.json should not be rewritten by plan()');
	} finally {
		await s.cleanup();
	}
});

test('uninstallSkills is idempotent and leaves user-managed dirs alone', async () => {
	const s = await makeScratch();
	try {
		const adapter = new ClaudeCodeEngineAdapter();

		// First: nothing to remove — must not throw.
		await adapter.uninstallSkills(PKG_ID, PKG_SLUG);

		// Install, then uninstall.
		await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);
		await adapter.uninstallSkills(PKG_ID, PKG_SLUG);

		const target = path.join(s.home, '.claude', 'skills', PKG_SLUG);
		await assert.rejects(() => lstat(target));

		// User-managed dir at the target — uninstall must not throw, must not delete.
		await mkdir(target, { recursive: true });
		await writeFile(path.join(target, 'user.md'), 'user\n', 'utf8');
		await adapter.uninstallSkills(PKG_ID, PKG_SLUG);
		const userFile = await readFile(path.join(target, 'user.md'), 'utf8');
		assert.equal(userFile, 'user\n');
	} finally {
		await s.cleanup();
	}
});
