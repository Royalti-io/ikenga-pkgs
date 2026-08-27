/**
 * com.ikenga.git · History — real-repository harness (WP-08).
 *
 * The unit tests in `src/views/history/graph-layout.test.ts` prove the layout
 * on synthetic DAGs. This proves it on a REAL one, through the real chain:
 *
 *     git log -z --format=<NUL>   (git-core argv.ts + exec.ts)
 *       → parseLog                (git-core parse/log.ts)
 *       → computeGraphLayout      (views/history/graph-layout.ts)
 *       → ASCII rail              (layoutToAscii)
 *
 * Nothing is mocked and no fixture is committed: it reads whatever repo you
 * point it at, right now.
 *
 *   # eyeball the rail against `git log --graph --oneline`
 *   node --import=tsx ui/tools/history-cli.ts ascii <repo> [--limit 60]
 *
 *   # write a dev fixture the standalone UI renders with `?live=1`
 *   node --import=tsx ui/tools/history-cli.ts dump <repo> [--limit 500]
 *
 * `dump` writes `ui/dev/history-fixture.json`, which is gitignored on purpose:
 * a real repo's history moves, so a committed snapshot of it would be a lie
 * within a day. Regenerate it; don't archive it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as argv from '../../core/src/argv.js';
import { run } from '../../core/src/exec.js';
import { chunkNulRecords, LOG_FIELD_COUNT, parseLog, parseTrailers } from '../../core/src/parse/log.js';
import { parseNumstat } from '../../core/src/parse/numstat.js';
import type { CommitSummary, FileChange } from '../../core/src/rpc.js';
import { computeGraphLayout, layoutToAscii } from '../src/views/history/graph-layout';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(HERE, '..', 'dev', 'history-fixture.json');

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function readLog(repo: string, limit: number, skip: number): Promise<CommitSummary[]> {
  const built = argv.log({ limit, skip });
  const res = await run('git', built, { cwd: repo });
  if (res.ok !== true) {
    throw new Error(`git log failed in ${repo}: ${res.reason} — ${res.message}`);
  }
  return parseLog(res.outcome.stdout);
}

async function cmdAscii(repo: string, limit: number): Promise<void> {
  const commits = await readLog(repo, limit, 0);
  const layout = computeGraphLayout(commits);
  const byShaSummary = new Map(commits.map((c) => [c.sha, c]));

  console.log(`repo:    ${repo}`);
  console.log(`commits: ${String(layout.nodes.length)} (limit ${String(limit)})`);
  console.log(`columns: ${String(layout.columns)}${layout.clamped ? ' (CLAMPED)' : ''}`);
  console.log(`merges:  ${String(layout.nodes.filter((n) => n.isMerge).length)}`);
  console.log(`roots:   ${String(layout.nodes.filter((n) => n.isRoot).length)}`);
  console.log(
    `edges:   ${String(layout.edges.length)} (${String(layout.edges.filter((e) => e.dangling).length)} running off the bottom of the page)`
  );
  console.log(
    `co-authored: ${String(commits.filter((c) => c.coAuthors.length > 0).length)} of ${String(commits.length)} carry a Co-Authored-By trailer`
  );
  console.log('');
  console.log(
    layoutToAscii(layout, (node) => {
      const commit = byShaSummary.get(node.sha);
      if (!commit) return node.sha.slice(0, 7);
      const co = commit.coAuthors.length > 0 ? ' [co]' : '';
      const refs = commit.refs.length > 0 ? ` (${commit.refs.join(', ')})` : '';
      return `${commit.shortSha}${co} ${commit.subject.slice(0, 64)}${refs}`;
    })
  );

  // The invariant the forbidden-column rule exists to produce, re-checked on
  // real data rather than only on the synthetic DAGs the unit tests use.
  const nodeAt = new Map<string, string>();
  for (const node of layout.nodes) nodeAt.set(`${node.row}:${node.column}`, node.sha);
  let violations = 0;
  for (const edge of layout.edges) {
    for (let row = edge.fromRow + 1; row < edge.toRow; row += 1) {
      if (nodeAt.has(`${row}:${edge.column}`)) violations += 1;
    }
  }
  console.log('');
  console.log(`no-crossing invariant: ${violations === 0 ? 'HOLDS' : `VIOLATED ×${String(violations)}`}`);
  if (violations > 0) process.exitCode = 1;
}

/**
 * `%B` and the parsed trailer block per commit, from the SAME `git log` output
 * the summaries came from — re-chunked rather than re-fetched, so the body a
 * fixture carries provably belongs to the summary next to it.
 */
function readDetails(raw: string): Map<string, { body: string; trailers: Array<{ key: string; value: string }> }> {
  const out = new Map<string, { body: string; trailers: Array<{ key: string; value: string }> }>();
  for (const fields of chunkNulRecords(raw, LOG_FIELD_COUNT)) {
    const sha = fields[0] ?? '';
    const body = fields[11] ?? '';
    if (sha.length > 0) out.set(sha, { body, trailers: parseTrailers(body) });
  }
  return out;
}

/** Per-commit numstat, `concurrency` calls in flight. */
async function readNumstat(
  repo: string,
  shas: readonly string[],
  concurrency: number
): Promise<Map<string, FileChange[]>> {
  const out = new Map<string, FileChange[]>();
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const sha = shas[index];
      if (sha === undefined) return;
      const res = await run('git', argv.logCommitNumstat({ sha }), { cwd: repo });
      if (res.ok !== true) {
        out.set(sha, []);
        continue;
      }
      out.set(
        sha,
        parseNumstat(res.outcome.stdout).map((entry) => ({
          path: entry.path,
          origPath: entry.origPath,
          kind: 'ordinary' as const,
          staged: '.' as const,
          unstaged: '.' as const,
          score: null,
          submodule: null,
          added: entry.added,
          deleted: entry.deleted,
          binary: entry.binary,
        }))
      );
    }
  });
  await Promise.all(workers);
  return out;
}

async function cmdDump(repo: string, limit: number, out: string): Promise<void> {
  const built = argv.log({ limit, skip: 0 });
  const res = await run('git', built, { cwd: repo });
  if (res.ok !== true) throw new Error(`git log failed in ${repo}: ${res.reason} — ${res.message}`);
  const commits = parseLog(res.outcome.stdout);
  const bodies = readDetails(res.outcome.stdout);
  const numstat = await readNumstat(
    repo,
    commits.map((c) => c.sha),
    8
  );

  const details: Record<string, { body: string; trailers: Array<{ key: string; value: string }>; files: FileChange[] }> =
    {};
  for (const commit of commits) {
    const record = bodies.get(commit.sha);
    details[commit.sha] = {
      body: record?.body ?? `${commit.subject}\n`,
      trailers: record?.trailers ?? [],
      files: numstat.get(commit.sha) ?? [],
    };
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify({ repo, capturedAt: Date.now(), commits, details })}\n`, 'utf8');
  console.log(
    `wrote ${String(commits.length)} commits (with bodies + numstat) from ${repo} → ${out}\nrun the UI with \`?mock=1&live=1&view=history\` to render them`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const repo = args[1];
  if (!command || !repo || (command !== 'ascii' && command !== 'dump')) {
    console.error('usage: history-cli.ts <ascii|dump> <repo> [--limit N] [--out FILE]');
    process.exitCode = 2;
    return;
  }
  const limit = Number.parseInt(flag(args, 'limit') ?? (command === 'ascii' ? '60' : '500'), 10);
  if (command === 'ascii') await cmdAscii(resolve(repo), limit);
  else await cmdDump(resolve(repo), limit, resolve(flag(args, 'out') ?? DEFAULT_FIXTURE));
}

void main();
