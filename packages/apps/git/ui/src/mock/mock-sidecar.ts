// com.ikenga.git · in-memory mocked sidecar (WP-06)
//
// Implements `RpcHandlers` (rpc.ts) purely in-memory, against fixture data
// shaped like this workspace itself (a root meta-repo + nested child repos)
// so every view has something real-shaped to render before WP-04 lands. This
// is the mock named in the WP-06 spec ("in-memory sidecar mock against
// drafts/rpc.ts") — it is what proves the G-RPC DoD's second half ("a UI mock
// … compiles against it").
//
// `MOCK_ROOTS` lets the UI exercise every G-05 no-root state and the
// not-a-repository-but-has-nested-repos DELTA-3 case from one dev toggle
// (see app/dev-controls.ts) without a real filesystem.

import {
  type ArgsOf,
  type BranchInfo,
  type CommitSummary,
  type FileChange,
  type NestedRepo,
  type ProjectRollup,
  type RepoSnapshot,
  type ResultOf,
  type RpcClient,
  type RpcHandlers,
  type RpcMethod,
  assertNever,
} from '../app/rpc';
import { makeSyntheticHistory, syntheticBody } from './history-dag';

const NOW = Date.now();

function commit(sha: string, subject: string, minsAgo: number, refs: string[] = []): CommitSummary {
  const t = Math.floor((NOW - minsAgo * 60_000) / 1000);
  return {
    sha: sha.padEnd(40, '0'),
    shortSha: sha.slice(0, 7),
    parents: [],
    authorName: 'Chinedum Okerengwor',
    authorEmail: 'nedjamez@gmail.com',
    authorAt: t,
    committerName: 'Chinedum Okerengwor',
    committerEmail: 'nedjamez@gmail.com',
    committedAt: t,
    subject,
    refs,
    coAuthors: minsAgo % 3 === 0 ? [{ name: 'Claude Fable 5', email: 'noreply@anthropic.com' }] : [],
  };
}

function fileChange(path: string, staged: 'M' | 'A' | 'D' | '.', unstaged: 'M' | 'A' | 'D' | '.', added: number | null, deleted: number | null): FileChange {
  return {
    path,
    origPath: null,
    // Untracked entries are built here and then have `kind` overridden to
    // 'untracked' by the caller — see the `untracked:` fixture below.
    kind: 'ordinary',
    staged: staged as FileChange['staged'],
    unstaged: unstaged as FileChange['unstaged'],
    score: null,
    submodule: null,
    added,
    deleted,
    binary: false,
  };
}

interface MockRepo {
  snapshot: RepoSnapshot;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  log: CommitSummary[];
  branches: BranchInfo[];
  nested: NestedRepo[];
}

function makeRepo(opts: {
  repo: string;
  name: string;
  relPath: string;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  staged?: FileChange[];
  unstaged?: FileChange[];
  untracked?: FileChange[];
  nested?: NestedRepo[];
  /** How deep a synthetic history to generate (WP-08). The root repo gets 646
   *  — the real commit count of this workspace's meta-repo — so the mocked
   *  History view exercises the real 500 + 200 pagination path and a DAG wide
   *  enough to have something to lay out. */
  historyCount?: number;
}): MockRepo {
  const staged = opts.staged ?? [];
  const unstaged = opts.unstaged ?? [];
  const untracked = opts.untracked ?? [];
  const log = makeSyntheticHistory({
    seed: opts.repo,
    count: opts.historyCount ?? 120,
    branch: opts.branch,
    upstream: opts.upstream,
  });
  const lastCommit =
    log[0] ??
    commit('a1b2c3d4e5', 'chore: initial mock history', 42, opts.branch ? [`HEAD -> ${opts.branch}`] : []);
  const snapshot: RepoSnapshot = {
    repo: opts.repo,
    name: opts.name,
    relPath: opts.relPath,
    gitDir: `${opts.repo}/.git`,
    isBare: false,
    headSha: lastCommit.sha,
    branch: opts.branch,
    detached: opts.branch === null,
    upstream: opts.upstream,
    ahead: opts.ahead,
    behind: opts.behind,
    staged: staged.length,
    unstaged: unstaged.length,
    untracked: untracked.length,
    conflicted: 0,
    stashCount: 0,
    operation: 'none',
    lastCommit,
    worktrees: [
      {
        path: opts.repo,
        head: lastCommit.sha,
        branch: opts.branch ? `refs/heads/${opts.branch}` : null,
        detached: opts.branch === null,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
        isMain: true,
        ownerTerminalId: null,
      },
    ],
    nested: opts.nested ?? [],
    capturedAt: NOW,
    stale: false,
  };
  const branches: BranchInfo[] = [
    {
      name: opts.branch ?? 'HEAD',
      fullRef: `refs/heads/${opts.branch ?? 'HEAD'}`,
      isHead: true,
      isRemote: false,
      upstream: opts.upstream,
      ahead: opts.ahead,
      behind: opts.behind,
      lastCommit,
      worktreePath: null,
    },
    {
      name: 'main',
      fullRef: 'refs/heads/main',
      isHead: opts.branch === 'main',
      isRemote: false,
      upstream: opts.upstream ? 'origin/main' : null,
      ahead: 0,
      behind: 0,
      lastCommit: commit('9f8e7d6c5b', 'merge: latest from main', 4320),
      worktreePath: null,
    },
  ];
  return {
    snapshot,
    staged,
    unstaged,
    untracked,
    log,
    branches,
    nested: opts.nested ?? [],
  };
}

/** One project-root scenario per key. `?mock=<key>` selects it for dev/QA;
 *  defaults to `'workspace'`. */
export const MOCK_ROOTS = {
  /** Happy path: a nested-repo project, matching G-11's dogfood target. */
  workspace: 'ok' as const,
  /** G-05(a). */
  noProject: 'no-project' as const,
  /** G-05(b). */
  noProjectRoot: 'no-project-root' as const,
  /** G-05(c) — zero nested repos. */
  notARepository: 'not-a-repository' as const,
  /** DELTA-3 — root is not a repo but nested repos exist. */
  notARepoButNested: 'not-a-repo-but-nested' as const,
  /** G-05(d). */
  unreadable: 'unreadable' as const,
};
export type MockRootKey = keyof typeof MOCK_ROOTS;

const childGit = makeRepo({
  repo: '/home/nedjamez/royalti-co/ikenga/shell',
  name: 'shell',
  relPath: 'shell',
  branch: 'feat/activity-bar-badge',
  upstream: null,
  ahead: null,
  behind: null,
  historyCount: 214,
  unstaged: [
    fileChange('src/lib/pkg/pkg-menu-store.ts', '.', 'M', 12, 2),
    fileChange('src-tauri/src/pkg/lifecycle.rs', '.', 'M', 4, 0),
  ],
});

const childContract = makeRepo({
  repo: '/home/nedjamez/royalti-co/ikenga/contract',
  name: 'contract',
  relPath: 'contract',
  branch: 'feat/sidecar-event-envelope',
  upstream: 'origin/feat/sidecar-event-envelope',
  ahead: 1,
  behind: 0,
  historyCount: 47,
});

const rootRepo = makeRepo({
  repo: '/home/nedjamez/royalti-co/ikenga',
  name: 'ikenga',
  relPath: '.',
  branch: 'git/phase-1',
  upstream: 'origin/git/phase-1',
  ahead: 3,
  behind: 0,
  historyCount: 646,
  staged: [fileChange('plans/git/05-tracking.md', 'M', '.', 18, 3)],
  untracked: [{ ...fileChange('plans/git/drafts/schema-notes.md', '.', '.', null, null), kind: 'untracked' }],
  nested: [
    { repo: childGit.snapshot.repo, relPath: 'shell', name: 'shell', depth: 1, isSubmodule: false, ignoredByParent: true },
    { repo: childContract.snapshot.repo, relPath: 'contract', name: 'contract', depth: 1, isSubmodule: false, ignoredByParent: true },
  ],
});

const REPOS_BY_PATH = new Map<string, MockRepo>([
  [rootRepo.snapshot.repo, rootRepo],
  [childGit.snapshot.repo, childGit],
  [childContract.snapshot.repo, childContract],
]);

function reposForRoot(rootKey: MockRootKey): { rootIsRepo: boolean; repos: MockRepo[] } {
  switch (MOCK_ROOTS[rootKey]) {
    case 'ok':
      return { rootIsRepo: true, repos: [rootRepo, childGit, childContract] };
    case 'not-a-repo-but-nested':
      return { rootIsRepo: false, repos: [childGit, childContract] };
    default:
      return { rootIsRepo: true, repos: [] };
  }
}

let _activeRootKey: MockRootKey = 'workspace';
export function setMockRoot(key: MockRootKey): void {
  _activeRootKey = key;
}
export function getMockRoot(): MockRootKey {
  return _activeRootKey;
}

// ── Dev-only: render THIS workspace's real history ──────────────────────────
//
// `?live=1` (dev server only) swaps the synthetic DAG for a snapshot of a real
// repo, produced by `tools/history-cli.ts dump` through the real chain
// (git → git-core argv/exec → parseLog). That is what lets WP-08's "renders
// this workspace's root repo history" be a screenshot of the actual view
// rather than a claim about one.
//
// The snapshot lives at `ui/dev/history-fixture.json` and is GITIGNORED on
// purpose: a repo's history moves, so a committed copy would be stale within a
// day. `import.meta.env.DEV` is a compile-time constant, so this whole branch
// — fetch included — is dead-code-eliminated out of `vite build` output; the
// shipped bundle has no fixture path in it at all.

interface LiveFixture {
  repo: string;
  commits: CommitSummary[];
  details: Record<string, { body: string; trailers: Array<{ key: string; value: string }>; files: FileChange[] }>;
}

let _liveFixture: LiveFixture | null | undefined;

async function liveFixture(): Promise<LiveFixture | null> {
  if (!import.meta.env.DEV) return null;
  if (_liveFixture !== undefined) return _liveFixture;
  let wanted = false;
  try {
    wanted = new URLSearchParams(window.location.search).get('live') === '1';
  } catch {
    wanted = false;
  }
  if (!wanted) {
    _liveFixture = null;
    return null;
  }
  try {
    const res = await fetch('/dev/history-fixture.json');
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    _liveFixture = (await res.json()) as LiveFixture;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[git] ?live=1 but ui/dev/history-fixture.json is unreadable — generate it with\n' +
        '      node --import=tsx ui/tools/history-cli.ts dump <repo>',
      err
    );
    _liveFixture = null;
  }
  return _liveFixture;
}

function findRepo(repo: string): MockRepo | undefined {
  return REPOS_BY_PATH.get(repo);
}

function notOk(reason: string, message: string) {
  return { ok: false as const, reason: reason as never, message };
}

const handlers: RpcHandlers = {
  'system.probe': async () => ({
    ok: true,
    version: '0.0.0-mock',
    gitVersion: '2.43.0',
    gh: { present: true, authenticated: false, hosts: [], version: '2.60.0' },
    platform: 'linux',
    watcherBackend: 'inotify',
  }),

  'project.scan': async (args: ArgsOf<'project.scan'>): Promise<ResultOf<'project.scan'>> => {
    if (args.root === undefined) return notOk('no-project', 'No active project.');
    if (args.root === null) return notOk('no-project-root', 'This project has no folder yet.');

    const key = _activeRootKey;
    switch (MOCK_ROOTS[key]) {
      case 'no-project':
        return notOk('no-project', 'No active project.');
      case 'no-project-root':
        return notOk('no-project-root', 'This project has no folder yet.');
      case 'unreadable':
        return notOk('unreadable', 'Permission denied reading this folder.');
      case 'not-a-repository':
        return notOk('not-a-repository', "This folder isn't a git repository.");
      case 'not-a-repo-but-nested':
      case 'ok': {
        const { rootIsRepo, repos } = reposForRoot(key);
        const rollup: ProjectRollup = {
          root: args.root,
          rootIsRepo,
          repos: repos.map((r) => r.snapshot),
          truncated: false,
          capturedAt: Date.now(),
        };
        return { ok: true, project: rollup };
      }
    }
  },

  'repo.snapshot': async (args: ArgsOf<'repo.snapshot'>): Promise<ResultOf<'repo.snapshot'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    return { ok: true, snapshot: r.snapshot };
  },

  'repo.aheadBehind': async (args: ArgsOf<'repo.aheadBehind'>): Promise<ResultOf<'repo.aheadBehind'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    return {
      ok: true,
      counts: { base: args.base, head: args.head ?? 'HEAD', ahead: r.snapshot.ahead ?? 0, behind: r.snapshot.behind ?? 0, mergeBase: r.snapshot.headSha },
    };
  },

  'repo.fetch': async (args: ArgsOf<'repo.fetch'>): Promise<ResultOf<'repo.fetch'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    return { ok: true, remote: args.remote ?? 'origin', updated: [], snapshot: r.snapshot };
  },

  'changes.list': async (args: ArgsOf<'changes.list'>): Promise<ResultOf<'changes.list'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    return {
      ok: true,
      repo: args.repo,
      staged: r.staged,
      unstaged: r.unstaged,
      untracked: r.untracked,
      conflicted: [],
      capturedAt: Date.now(),
    };
  },

  'changes.diff': async (args: ArgsOf<'changes.diff'>): Promise<ResultOf<'changes.diff'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    return {
      ok: true,
      diff: {
        repo: args.repo,
        path: args.path,
        origPath: null,
        side: args.side,
        patch: `--- a/${args.path}\n+++ b/${args.path}\n@@ -1,1 +1,1 @@\n-mock\n+mock (WP-07 renders this for real)\n`,
        binary: false,
        isNew: false,
        isDeleted: false,
        added: 1,
        deleted: 1,
        truncated: false,
      },
    };
  },

  'changes.stage': async (args: ArgsOf<'changes.stage'>): Promise<ResultOf<'changes.stage'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    for (const p of args.paths) {
      const outsideOwner = [...REPOS_BY_PATH.values()].find(
        (other) => other !== r && (other.staged.some((f) => f.path === p) || other.unstaged.some((f) => f.path === p))
      );
      if (outsideOwner) {
        return { ok: false, reason: 'cross-repo-path', message: `${p} belongs to another repo.`, path: p, ownerRepo: outsideOwner.snapshot.repo };
      }
    }
    return { ok: true, repo: args.repo, changed: [...args.paths], snapshot: r.snapshot };
  },

  'changes.unstage': async (args: ArgsOf<'changes.unstage'>): Promise<ResultOf<'changes.unstage'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    return { ok: true, repo: args.repo, changed: [...args.paths], snapshot: r.snapshot };
  },

  'commit.create': async (args: ArgsOf<'commit.create'>): Promise<ResultOf<'commit.create'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    const sha = 'deadbeef' + Math.random().toString(16).slice(2, 10).padEnd(32, '0');
    return {
      ok: true,
      repo: args.repo,
      sha,
      summary: `[${r.snapshot.branch ?? 'HEAD'} ${sha.slice(0, 7)}] ${args.message.split('\n')[0]}`,
      signed: null,
      snapshot: r.snapshot,
    };
  },

  'history.log': async (args: ArgsOf<'history.log'>): Promise<ResultOf<'history.log'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    const fixture = await liveFixture();
    const source = fixture && fixture.repo === args.repo ? fixture.commits : r.log;
    const skip = args.skip ?? 0;
    const limit = args.limit ?? 500;
    const page = source.slice(skip, skip + limit);
    return {
      ok: true,
      repo: args.repo,
      commits: page,
      nextSkip: skip + page.length < source.length ? skip + page.length : null,
    };
  },

  'history.commit': async (args: ArgsOf<'history.commit'>): Promise<ResultOf<'history.commit'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    const fixture = await liveFixture();
    if (fixture && fixture.repo === args.repo) {
      const summary = fixture.commits.find((c0) => c0.sha === args.sha);
      const detail = fixture.details[args.sha];
      if (summary && detail) {
        return {
          ok: true,
          commit: { ...summary, body: detail.body, trailers: detail.trailers, files: detail.files, signature: null },
        };
      }
      return notOk('git-failed', `${args.sha} is not in the dev fixture.`);
    }
    const c = r.log.find((c0) => c0.sha === args.sha) ?? r.log[0];
    if (!c) return notOk('git-failed', 'No commits.');
    return {
      ok: true,
      commit: {
        ...c,
        // The body has to AGREE with `coAuthors` — a detail pane showing a
        // trailer the row said wasn't there would poison the one thing the
        // History view is careful about (02-research-external.md [27][28]).
        body: syntheticBody(c),
        trailers: c.coAuthors.map((a) => ({ key: 'Co-Authored-By', value: `${a.name} <${a.email}>` })),
        files: [...r.staged, ...r.unstaged],
        // `%G?` = N means unsigned, which git-core reports as `null` rather
        // than a `{status:'N'}` object (core/src/parse/log.ts).
        signature: null,
      },
    };
  },

  'branch.list': async (args: ArgsOf<'branch.list'>): Promise<ResultOf<'branch.list'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    return { ok: true, repo: args.repo, branches: r.branches };
  },

  'branch.create': async (args: ArgsOf<'branch.create'>): Promise<ResultOf<'branch.create'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    const branch: BranchInfo = {
      name: args.name,
      fullRef: `refs/heads/${args.name}`,
      isHead: !!args.checkout,
      isRemote: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      lastCommit: r.log[0] ?? null,
      worktreePath: null,
    };
    r.branches = [branch, ...r.branches];
    return { ok: true, repo: args.repo, branch, snapshot: r.snapshot };
  },

  'branch.checkout': async (args: ArgsOf<'branch.checkout'>): Promise<ResultOf<'branch.checkout'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    if ((r.snapshot.staged || r.snapshot.unstaged) && !args.confirm) {
      return { ok: false, reason: 'confirm-required', message: 'Working tree has changes.' };
    }
    const branch = r.branches.find((b) => b.name === args.name) ?? r.branches[0]!;
    return { ok: true, repo: args.repo, branch, snapshot: r.snapshot };
  },

  'worktree.list': async (args: ArgsOf<'worktree.list'>): Promise<ResultOf<'worktree.list'>> => {
    const r = findRepo(args.repo);
    if (!r) return notOk('repo-not-known', `${args.repo} is not a known repo root.`);
    return { ok: true, repo: args.repo, worktrees: r.snapshot.worktrees };
  },

  'worktree.add': async (args: ArgsOf<'worktree.add'>): Promise<ResultOf<'worktree.add'>> => {
    return { ok: true, repo: args.repo, path: args.path, branch: args.branch ?? null };
  },

  'worktree.remove': async (args: ArgsOf<'worktree.remove'>): Promise<ResultOf<'worktree.remove'>> => {
    return { ok: true, repo: args.repo, path: args.path };
  },

  'repo.staleBase': async (args: ArgsOf<'repo.staleBase'>): Promise<ResultOf<'repo.staleBase'>> => {
    return { ok: true, repo: args.repo, base: args.base ?? 'main', ahead: 0, behind: 0, isStale: false };
  },

  'pr.list': async (args: ArgsOf<'pr.list'>): Promise<ResultOf<'pr.list'>> => {
    return {
      ok: true,
      repo: args.repo,
      prs: [
        {
          number: 158,
          title: 'Live Content PR Integration',
          author: { login: 'nedjamez' },
          state: 'OPEN',
          headRefName: 'feat/live-content',
          baseRefName: 'main',
          isDraft: false,
          url: 'https://github.com/ikenga-hq/ikenga/pull/158',
          updatedAt: new Date().toISOString(),
          reviewDecision: 'APPROVED',
          body: 'This PR adds support for fetching live content directly within Ikenga workspace sessions.\n\n### Changes:\n- Added LiveContent provider\n- Integrated RPC transport',
          comments: [
            {
              id: 'c1',
              author: { login: 'reviewer' },
              body: 'Looks great! Approved.',
              createdAt: new Date().toISOString(),
            },
          ],
          labels: [{ name: 'enhancement', color: '0e8a16' }],
          additions: 142,
          deletions: 38,
          changedFiles: 8,
        },
      ],
    };
  },

  'pr.checkout': async (args: ArgsOf<'pr.checkout'>): Promise<ResultOf<'pr.checkout'>> => {
    return { ok: true, repo: args.repo, branch: `PR-${String(args.number)}` };
  },

  'pr.create': async (args: ArgsOf<'pr.create'>): Promise<ResultOf<'pr.create'>> => {
    return {
      ok: true,
      repo: args.repo,
      url: `https://github.com/ikenga-hq/ikenga/pull/199`,
      number: 199,
    };
  },
};

/** `RpcClient` adapter over the handler table above, for view code that wants
 *  the same call shape the real transport (app/transport.ts) exposes. */
export const mockRpcClient: RpcClient = (async (method: RpcMethod, args: unknown) => {
  const handler = handlers[method];
  if (!handler) {
    return assertNever(method as never);
  }
  return handler(args as never);
}) as RpcClient;

export const mockRepoRoots = REPOS_BY_PATH;
export const MOCK_PROJECT_ROOT = '/home/nedjamez/royalti-co/ikenga';
