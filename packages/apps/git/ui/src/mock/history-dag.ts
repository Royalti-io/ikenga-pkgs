// com.ikenga.git · mocked commit history (WP-08 half of the WP-06 mock)
//
// The WP-06 mock shipped three hard-coded commits, which is enough to prove
// "the History route renders" and not enough to prove anything WP-08 claims:
// no merges means no graph, and three rows means no pagination. This generates
// a deterministic DAG with the shape a real repo has — a mainline, feature
// branches that fork and merge back, one root commit, and a realistic mix of
// commits that carry a `Co-Authored-By` trailer and commits that don't
// (02-research-external.md [27][28] — BOTH are normal).
//
// Deterministic from a string seed, so a screenshot or a bug report is
// reproducible: same repo path in, same DAG out, forever.

import type { CommitSummary } from '../app/rpc';

/** xorshift32 over a string seed — small, deterministic, no dependency. */
function makeRandom(seed: string): () => number {
  let state = 0x811c_9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 0x0100_0193) >>> 0;
  }
  if (state === 0) state = 0x9e37_79b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function hex40(rand: () => number): string {
  let out = '';
  for (let i = 0; i < 40; i += 1) out += Math.floor(rand() * 16).toString(16);
  return out;
}

const SCOPES = ['sidecar', 'ui', 'core', 'mcp', 'graph', 'manifest', 'kernel', 'bridge', 'argv', 'parse'];
const FEATS = [
  'thread the repo path through discovery',
  'render the commit rail from %P',
  'reject option-injection in pathspecs',
  'coalesce watcher events per repo',
  'stage explicit paths only',
  'read ahead/behind without fetching',
  'paginate the log 500 then 200',
  'mirror the parent theme attributes',
  'surface the cross-repo staging guard',
  'clear the child env before spawning git',
];
const FIXES = [
  'stop the rail drifting on odd row heights',
  'keep a dangling parent edge instead of dropping it',
  'quote nothing — shell:false means no quoting bug',
  'handle a root commit with no parents',
  'survive a repo with no upstream',
  'retry a locked index instead of failing the call',
];
const CHORES = [
  'bump the contract to the frozen RPC',
  'move the plan docs out of the public repo',
  'wire the changeset for the next release',
];

const PEOPLE: Array<{ name: string; email: string }> = [
  { name: 'Chinedum Okerengwor', email: 'nedjamez@gmail.com' },
  { name: 'Chinedum Okerengwor', email: 'nedjamez@gmail.com' },
  { name: 'Chinedum Okerengwor', email: 'nedjamez@gmail.com' },
  { name: 'Ada Nwosu', email: 'ada@example.test' },
];

const CO_AUTHOR = { name: 'Claude Fable 5', email: 'noreply@anthropic.com' };

export interface SyntheticHistoryOptions {
  /** Anything stable — the repo path is what mock-sidecar passes. */
  seed: string;
  /** How many commits to generate. */
  count: number;
  /** Decorates row 0 as `HEAD -> <branch>` when set. */
  branch?: string | null;
  /** Remote-tracking ref to decorate row 0 with, when the repo has one. */
  upstream?: string | null;
  /** Newest commit's timestamp, epoch seconds. Defaults to now. */
  newestAt?: number;
  /** Share of commits carrying a `Co-Authored-By` trailer. */
  coAuthoredShare?: number;
}

/**
 * Generate a commit list in `git log` order (newest first).
 *
 * Construction runs OLDEST first so a parent always exists before its child —
 * the same invariant a real `git log` traversal guarantees — then reverses.
 */
export function makeSyntheticHistory(options: SyntheticHistoryOptions): CommitSummary[] {
  const rand = makeRandom(options.seed);
  const count = Math.max(1, options.count);
  const newestAt = options.newestAt ?? Math.floor(Date.now() / 1000);
  const coAuthoredShare = options.coAuthoredShare ?? 0.66;

  interface Built {
    sha: string;
    parents: string[];
    subject: string;
    person: { name: string; email: string };
    coAuthored: boolean;
  }

  const built: Built[] = [];
  const tips: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const sha = hex40(rand);
    const roll = rand();
    let parents: string[];
    if (i === 0) {
      parents = [];
      tips.push(sha);
    } else if (tips.length > 1 && roll < 0.16) {
      const other = 1 + Math.floor(rand() * (tips.length - 1));
      parents = [tips[0] as string, tips[other] as string];
      tips.splice(other, 1);
      tips[0] = sha;
    } else if (roll < 0.26 && tips.length < 5) {
      const from = Math.floor(rand() * tips.length);
      parents = [tips[from] as string];
      tips.unshift(sha);
    } else {
      parents = [tips[0] as string];
      tips[0] = sha;
    }

    const scope = SCOPES[Math.floor(rand() * SCOPES.length)] as string;
    const kindRoll = rand();
    const subject =
      parents.length > 1
        ? `Merge branch 'feat/${scope}' into main`
        : kindRoll < 0.55
          ? `feat(${scope}): ${FEATS[Math.floor(rand() * FEATS.length)] as string}`
          : kindRoll < 0.85
            ? `fix(${scope}): ${FIXES[Math.floor(rand() * FIXES.length)] as string}`
            : `chore: ${CHORES[Math.floor(rand() * CHORES.length)] as string}`;

    built.push({
      sha,
      parents,
      subject,
      person: PEOPLE[Math.floor(rand() * PEOPLE.length)] as { name: string; email: string },
      // Older commits are less likely to carry the trailer — the convention
      // arrived partway through most repos' lives.
      coAuthored: rand() < coAuthoredShare * Math.min(1, 0.35 + (i / count) * 1.1),
    });
  }

  const logOrder = [...built].reverse();

  return logOrder.map((commit, row) => {
    // ~2.5 h apart, jittered, newest first.
    const at = newestAt - Math.floor(row * 9000 * (0.4 + rand()));
    const refs: string[] = [];
    if (row === 0) {
      if (options.branch) refs.push(`HEAD -> ${options.branch}`);
      if (options.upstream) refs.push(options.upstream);
    }
    if (row === Math.min(logOrder.length - 1, 37)) refs.push('tag: v0.1.0');
    return {
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 7),
      parents: commit.parents,
      authorName: commit.person.name,
      authorEmail: commit.person.email,
      authorAt: at,
      committerName: commit.person.name,
      committerEmail: commit.person.email,
      committedAt: at,
      subject: commit.subject,
      refs,
      coAuthors: commit.coAuthored ? [{ ...CO_AUTHOR }] : [],
    } satisfies CommitSummary;
  });
}

/**
 * The `%B` a synthetic commit would have had. `history.commit` needs a body to
 * render, and it has to agree with `coAuthors` — a detail pane showing a
 * trailer the summary said wasn't there would make the one thing this view is
 * supposed to be careful about (attribution) untrustworthy in the mock.
 */
export function syntheticBody(commit: CommitSummary): string {
  const paragraphs = [commit.subject];
  if (commit.parents.length > 1) {
    paragraphs.push(`Brings the feature branch back onto the mainline.`);
  } else {
    paragraphs.push(
      `Keeps the change scoped to one repo — every mutation in this pkg is\nper-repo, and cross-repo staging is refused rather than guessed at.`
    );
  }
  if (commit.coAuthors.length > 0) {
    paragraphs.push(commit.coAuthors.map((a) => `Co-Authored-By: ${a.name} <${a.email}>`).join('\n'));
  }
  return `${paragraphs.join('\n\n')}\n`;
}
