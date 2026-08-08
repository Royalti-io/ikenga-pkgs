/**
 * Tests for `AntigravityEngineAdapter`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { McpServer } from '@ikenga/contract/manifest';
import { AntigravityEngineAdapter } from './portability.js';

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
	commandsFolder: string;
	cleanup: () => Promise<void>;
}

async function makeScratch(): Promise<Scratch> {
	const home = await mkdtemp(path.join(tmpdir(), 'antigravity-adapter-'));
	const pkgRoot = path.join(home, 'pkg');
	const skillsFolder = path.join(pkgRoot, 'skills');
	const commandsFolder = path.join(pkgRoot, 'commands');
	await mkdir(skillsFolder, { recursive: true });
	await writeFile(path.join(skillsFolder, 'SKILL.md'), '# test skill\n', 'utf8');
	await mkdir(commandsFolder, { recursive: true });

	const prevHome = process.env.HOME;
	process.env.HOME = home;

	return {
		home,
		pkgRoot,
		skillsFolder,
		commandsFolder,
		cleanup: async () => {
			process.env.HOME = prevHome;
			await rm(home, { recursive: true, force: true });
		},
	};
}

const PKG_ID = 'com.ikenga.test';
const PKG_SLUG = 'com-ikenga-test';

test('installSkills creates a symlink under ~/.gemini/antigravity-cli/skills/<slug>', async () => {
	const s = await makeScratch();
	try {
		const adapter = new AntigravityEngineAdapter();
		const report = await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);

		const target = path.join(s.home, '.gemini', 'antigravity-cli', 'skills', PKG_SLUG);
		assert.deepEqual(report.wrote, [target]);
		assert.deepEqual(report.skipped, []);
		assert.deepEqual(report.warnings, []);

		const stat = await lstat(target);
		assert.ok(stat.isSymbolicLink(), 'target should be a symlink');
	} finally {
		await s.cleanup();
	}
});

test('installSkills is idempotent on repeat with same inputs', async () => {
	const s = await makeScratch();
	try {
		const adapter = new AntigravityEngineAdapter();
		await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);
		const second = await adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG);

		const target = path.join(s.home, '.gemini', 'antigravity-cli', 'skills', PKG_SLUG);
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
		const target = path.join(s.home, '.gemini', 'antigravity-cli', 'skills', PKG_SLUG);
		await mkdir(target, { recursive: true });
		await writeFile(path.join(target, 'user.md'), 'hand-crafted\n', 'utf8');

		const adapter = new AntigravityEngineAdapter();
		await assert.rejects(
			() => adapter.installSkills(s.skillsFolder, PKG_ID, PKG_SLUG),
			/exists and is not a symlink — refusing to overwrite/,
		);

		const userFile = await readFile(path.join(target, 'user.md'), 'utf8');
		assert.equal(userFile, 'hand-crafted\n');
	} finally {
		await s.cleanup();
	}
});

test('installCommands walks .md files and emits transcoded .toml files', async () => {
	const s = await makeScratch();
	try {
		const adapter = new AntigravityEngineAdapter();

		// Two command files + one non-md decoy that must be ignored.
		await writeFile(
			path.join(s.commandsFolder, 'plan.md'),
			'---\ndescription: plan a thing\n---\n\nDo the plan: {input}\n',
			'utf8',
		);
		await writeFile(
			path.join(s.commandsFolder, 'review.md'),
			'---\ndescription: review it\n---\n\nReview {target}.\n',
			'utf8',
		);
		await writeFile(
			path.join(s.commandsFolder, 'notes.txt'),
			'must be ignored',
			'utf8',
		);

		const report = await adapter.installCommands(s.commandsFolder, PKG_ID, PKG_SLUG);
		const outDir = path.join(s.home, '.gemini', 'antigravity-cli', 'commands', PKG_SLUG);

		assert.deepEqual(report.wrote, [outDir]);
		assert.deepEqual(report.skipped, []);
		assert.deepEqual(report.warnings, []);

		const written = await readdir(outDir);
		written.sort();
		assert.deepEqual(written, ['plan.toml', 'review.toml']);

		const planToml = await readFile(path.join(outDir, 'plan.toml'), 'utf8');
		assert.match(planToml, /description = "plan a thing"/);
		assert.match(planToml, /prompt = """/);
		assert.match(planToml, /Do the plan: \{input\}/);
	} finally {
		await s.cleanup();
	}
});

test('installCommands is idempotent on re-call (byte-equal output → skipped)', async () => {
	const s = await makeScratch();
	try {
		const adapter = new AntigravityEngineAdapter();
		await writeFile(
			path.join(s.commandsFolder, 'plan.md'),
			'---\ndescription: plan\n---\n\nBody.\n',
			'utf8',
		);

		const first = await adapter.installCommands(s.commandsFolder, PKG_ID, PKG_SLUG);
		const outDir = path.join(s.home, '.gemini', 'antigravity-cli', 'commands', PKG_SLUG);
		assert.deepEqual(first.wrote, [outDir]);

		const second = await adapter.installCommands(s.commandsFolder, PKG_ID, PKG_SLUG);
		assert.deepEqual(second.wrote, []);
		assert.deepEqual(second.skipped, [outDir]);
		assert.deepEqual(second.warnings, []);
	} finally {
		await s.cleanup();
	}
});

test('registerMcpServer writes ikenga.<slug>.<name> into ~/.gemini/config/mcp_config.json', async () => {
	const s = await makeScratch();
	try {
		const adapter = new AntigravityEngineAdapter();
		const spec = mcpSpec({
			name: 'royalti-cms',
			command: 'bun',
			args: ['run', 'src/index.ts'],
		});
		const report = await adapter.registerMcpServer(spec, PKG_ID, PKG_SLUG);

		const settingsPath = path.join(s.home, '.gemini', 'config', 'mcp_config.json');
		const expectedKey = `ikenga.${PKG_SLUG}.royalti-cms`;
		assert.deepEqual(report.wrote, [`${settingsPath}#${expectedKey}`]);

		const onDisk = JSON.parse(await readFile(settingsPath, 'utf8'));
		assert.deepEqual(onDisk.mcpServers[expectedKey], {
			type: 'stdio',
			command: 'bun',
			args: ['run', 'src/index.ts'],
			env: {},
		});

		// Idempotent re-register.
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
		const adapter = new AntigravityEngineAdapter();
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

		const settingsPath = path.join(s.home, '.gemini', 'config', 'mcp_config.json');
		await assert.rejects(
			() => readFile(settingsPath, 'utf8'),
			(err: NodeJS.ErrnoException) => err.code === 'ENOENT',
		);
	} finally {
		await s.cleanup();
	}
});

test('uninstallCommands removes the per-pkg commands dir', async () => {
	const s = await makeScratch();
	try {
		const adapter = new AntigravityEngineAdapter();
		await writeFile(
			path.join(s.commandsFolder, 'plan.md'),
			'---\ndescription: plan\n---\n\nBody.\n',
			'utf8',
		);
		await adapter.installCommands(s.commandsFolder, PKG_ID, PKG_SLUG);

		const outDir = path.join(s.home, '.gemini', 'antigravity-cli', 'commands', PKG_SLUG);
		await lstat(outDir);

		await adapter.uninstallCommands(PKG_ID, PKG_SLUG);

		await assert.rejects(
			() => lstat(outDir),
			(err: NodeJS.ErrnoException) => err.code === 'ENOENT',
		);

		await adapter.uninstallCommands(PKG_ID, PKG_SLUG);
	} finally {
		await s.cleanup();
	}
});

test('unregisterMcpServer removes only our key and leaves others alone', async () => {
	const s = await makeScratch();
	try {
		const adapter = new AntigravityEngineAdapter();
		const settingsPath = path.join(s.home, '.gemini', 'config', 'mcp_config.json');

		await mkdir(path.dirname(settingsPath), { recursive: true });
		const seed = {
			mcpServers: {
				'user-entry': { type: 'stdio', command: 'echo' },
				'ikenga.other-pkg.thing': { type: 'stdio', command: 'echo' },
			},
		};
		await writeFile(settingsPath, JSON.stringify(seed), 'utf8');

		await adapter.registerMcpServer(
			mcpSpec({ name: 'mine', command: 'bun' }),
			PKG_ID,
			PKG_SLUG,
		);
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

test('installAgents creates a symlink under ~/.gemini/antigravity-cli/agents/<slug>', async () => {
	const s = await makeScratch();
	try {
		const agentsFolder = path.join(s.pkgRoot, 'agents');
		await mkdir(agentsFolder, { recursive: true });
		await writeFile(path.join(agentsFolder, 'a.md'), '---\nname: a\n---\nbody\n', 'utf8');

		const adapter = new AntigravityEngineAdapter();
		const report = await adapter.installAgents(agentsFolder, PKG_ID, PKG_SLUG);

		const target = path.join(s.home, '.gemini', 'antigravity-cli', 'agents', PKG_SLUG);
		assert.deepEqual(report.wrote, [target]);

		const stat = await lstat(target);
		assert.ok(stat.isSymbolicLink());
	} finally {
		await s.cleanup();
	}
});
