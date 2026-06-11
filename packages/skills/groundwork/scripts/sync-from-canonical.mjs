#!/usr/bin/env node
/**
 * sync-from-canonical.mjs — one-way sync of the groundwork skill tree.
 *
 *   canonical repo  →  this package
 *   royalti-io/groundwork  (skills/groundwork/)   →   ./skills/groundwork/
 *
 * Per the G-SOURCE = FLIP decision (2026-06), `royalti-io/groundwork` is the
 * canonical source of truth for the groundwork skill and the
 * `npx skills add royalti-io/groundwork` install surface. The copy under this
 * package is GENERATED here purely so `@ikenga/skill-groundwork` can be
 * published to npm (Changesets, ADR-009). Never hand-edit ./skills/groundwork/
 * — edit the canonical repo and re-run this.
 *
 * This replaces the old forward flow (sync-from-dev.mjs + build-mirror.mjs),
 * which copied FROM the workspace and force-pushed the mirror. The mirror IS
 * the canonical repo now, so the direction is reversed and the push retires.
 *
 * Behaviour:
 *   - Shallow-clones the canonical repo (or uses a local checkout via --src),
 *     then mirrors its skills/groundwork/ into ./skills/groundwork/.
 *   - Re-banners .md / .html files to point at the canonical repo (strips any
 *     prior GENERATED banner first, so re-runs are byte-stable).
 *   - Mirrors: files removed upstream are removed here too.
 *
 * Usage:
 *   node ./scripts/sync-from-canonical.mjs              # clone canonical@main
 *   node ./scripts/sync-from-canonical.mjs --src <dir>  # use a local checkout's repo root
 *   GROUNDWORK_CANONICAL=<url> GROUNDWORK_REF=<ref> node ./scripts/sync-from-canonical.mjs
 */

import {
	readFileSync, writeFileSync, mkdirSync, mkdtempSync,
	readdirSync, statSync, rmSync, existsSync,
} from 'node:fs';
import { join, dirname, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const DEST = join(PKG_ROOT, 'skills', 'groundwork');

const CANONICAL = process.env.GROUNDWORK_CANONICAL ?? 'https://github.com/royalti-io/groundwork.git';
const REF = process.env.GROUNDWORK_REF ?? 'main';

const BANNER_TEXT =
	'GENERATED — edit the canonical repo royalti-io/groundwork instead. Synced by sync-from-canonical.mjs.';
const HTML_BANNER = `<!-- ${BANNER_TEXT} -->`;
// Strip ANY prior GENERATED banner (the old sync-from-dev one or this one),
// at the very top OR right after a leading YAML frontmatter block (SKILL.md).
const ANY_BANNER_RE = /^<!--\s*GENERATED — edit[\s\S]*?-->\n?/;
const FM_ANY_BANNER_RE = /^(---\n[\s\S]*?\n---\n)<!--\s*GENERATED — edit[\s\S]*?-->\n?/;
const BANNER_EXTS = new Set(['.md', '.html', '.htm']);

function listFiles(dir, base = dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
		else out.push(relative(base, full));
	}
	return out;
}

function stripBanner(content) {
	return content.replace(ANY_BANNER_RE, '').replace(FM_ANY_BANNER_RE, '$1');
}

/** Banner after a leading YAML frontmatter block (SKILL.md must keep frontmatter on line 1). */
function withBanner(content) {
	const body = stripBanner(content);
	const fm = body.match(/^(---\n[\s\S]*?\n---\n)/);
	if (fm) return `${fm[1]}${HTML_BANNER}\n${body.slice(fm[1].length)}`;
	return `${HTML_BANNER}\n${body}`;
}

function obtainSource() {
	const i = process.argv.indexOf('--src');
	if (i !== -1) return { src: join(resolve(process.argv[i + 1]), 'skills', 'groundwork'), tmp: null };
	const tmp = mkdtempSync(join(tmpdir(), 'groundwork-canonical-'));
	console.log(`[sync] cloning ${CANONICAL}@${REF} …`);
	execSync(`git clone --depth 1 --branch ${REF} ${CANONICAL} ${tmp}`, {
		stdio: ['ignore', 'inherit', 'inherit'],
	});
	return { src: join(tmp, 'skills', 'groundwork'), tmp };
}

function main() {
	const { src: SRC, tmp } = obtainSource();
	try {
		if (!existsSync(join(SRC, 'SKILL.md'))) {
			console.error(`[sync] canonical source missing skills/groundwork/SKILL.md at ${SRC}`);
			process.exit(1);
		}
		const srcFiles = listFiles(SRC);

		// Wipe the destination so upstream removals propagate.
		if (existsSync(DEST)) for (const rel of listFiles(DEST)) rmSync(join(DEST, rel));

		let copied = 0;
		let bannered = 0;
		for (const rel of srcFiles) {
			const sp = join(SRC, rel);
			const dp = join(DEST, rel);
			mkdirSync(dirname(dp), { recursive: true });
			if (BANNER_EXTS.has(extname(rel).toLowerCase())) {
				writeFileSync(dp, withBanner(readFileSync(sp, 'utf8')));
				bannered++;
			} else {
				writeFileSync(dp, readFileSync(sp));
			}
			copied++;
		}

		console.log(`[sync] canonical: ${CANONICAL}@${REF}`);
		console.log(`[sync] dest:      ${DEST}`);
		console.log(`[sync] copied ${copied} files (${bannered} re-bannered to point at the canonical repo)`);
	} finally {
		if (tmp) rmSync(tmp, { recursive: true, force: true });
	}
}

main();
