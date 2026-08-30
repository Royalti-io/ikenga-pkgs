// com.ikenga.git · vocabulary.ts (G-18)
//
// All user-facing git nouns/verbs come from THIS map, never an inline string
// in a view. 01-plan.md §Phase 1: "Phase 4 becomes a second map + mode
// switch" (a non-technical "versioned history" mode with no branch
// vocabulary) — keeping every label here now is what makes that swap a
// module replacement later, not a grep-and-replace across every view.

export const VOCAB = {
  nav: {
    changes: 'Changes',
    history: 'History',
    branches: 'Branches',
    worktrees: 'Worktrees',
    prs: 'PRs',
  },
  section: {
    source: 'Source',
  },
  changes: {
    staged: 'Staged',
    unstaged: 'Unstaged',
    untracked: 'Untracked',
    conflicted: 'Conflicted',
    stage: 'Stage',
    unstage: 'Unstage',
    stageAll: 'Stage all',
    commit: 'Commit',
    noChanges: 'No changes',
    sendToChi: 'Send to your Chi',
    // ── Diff pane (WP-07, D9) ──────────────────────────────────────────────
    diffSideBySide: 'Side by side',
    diffUnified: 'Unified',
    selectFileHint: 'Select a file to see its diff',
    binaryFile: 'Binary file — no diff to show',
    renamedFrom: (from: string) => `Renamed from ${from}`,
    untrackedNoDiff: 'Untracked file — stage it to start tracking it',
    noDiffContent: 'No content changes',
    diffTruncated: 'Diff truncated — this file is larger than the preview limit',
    diffFailed: 'Couldn’t load this diff',
    loadingDiff: 'Loading diff…',
    // ── Commit box (WP-10, D-01 §"the composer IS the inspector's action bar")
    commitBox: {
      placeholder: 'Summary — what changed and why',
      scopeLabel: 'Commit to',
      detachedHead: 'detached HEAD',
      filesCount: (n: number) => `explicit paths · commits ${String(n)} staged file${n === 1 ? '' : 's'}`,
      noStaged: 'Stage files to commit',
      conflictsBlock: 'Resolve conflicts before committing',
      committing: 'Committing…',
      committed: (sha: string) => `Committed ${sha.slice(0, 7)}`,
      signed: 'Signed',
      unsigned: 'Not signed',
      commitFailed: 'Couldn’t commit',
      // ── "Send to your Chi" (R6) ─────────────────────────────────────────
      // The button label stays "Send to your Chi" (the possessive is
      // load-bearing — a Chi is personal), but the shell has no
      // `host.sendToActiveSession` dispatcher case, so the pkg cannot seed a
      // turn in the chat pane. It builds the same prompt and puts it on the
      // clipboard; the copy says so plainly rather than implying a delivery
      // that did not happen. See views/commit/index.ts §"Send to your Chi".
      chiPreparing: 'Preparing…',
      chiCopied: 'Copied — paste it to your Chi',
      chiCopyFailed: 'Couldn’t copy — select the prompt below and copy it yourself',
      chiPromptIntro: (repo: string, branch: string) =>
        `Draft a one-line commit message (Conventional Commits style, no trailing period) for the staged changes below in ${repo} (${branch}).`,
      chiPromptTruncated: '[diff truncated for length]',
    },
  },
  history: {
    title: 'History',
    empty: 'No commits yet',
    coAuthored: 'Co-authored',
    // ── Attribution (02-research-external.md [27][28]) ────────────────────
    // The `Co-Authored-By` trailer is user-configurable and can be suppressed,
    // so ABSENCE is a real state and not evidence of anything. Both readings
    // get their own words; the History view never renders one as the other.
    attribution: 'Attribution',
    coAuthoredWith: (names: string) => `Co-authored with ${names}`,
    noCoAuthors: 'No co-author trailer',
    noCoAuthorsHint:
      'This commit carries no Co-Authored-By line. That trailer is configurable and can be switched off, so its absence doesn’t prove anyone worked alone.',
    filterLabel: 'Attribution',
    filterAll: 'All',
    filterCoAuthored: 'Co-authored',
    filterSolo: 'No trailer',
    // ── Paging (02-research-external.md [13] — GitLens's 500 + 200) ───────
    loadMore: (n: number) => `Load ${String(n)} more`,
    loadingMore: 'Loading more…',
    endOfHistory: 'Beginning of history',
    loadedCount: (loaded: number) => `${String(loaded)} loaded`,
    // ── Commit detail ────────────────────────────────────────────────────
    selectHint: 'Pick a commit to read it.',
    message: 'Message',
    trailers: 'Trailers',
    files: 'Files',
    parents: 'Parents',
    signature: 'Signature',
    signatureNone: 'Not signed',
    merge: 'Merge',
    rootCommit: 'Root commit',
    refs: 'Refs',
    authored: 'authored',
    committed: 'committed',
    detailFailed: 'Couldn’t read that commit',
    noFiles: 'No files changed',
    graphClamped: 'Wider than the rail — some lanes share a column below.',
    railLabel: 'Commit graph',
  },
  branches: {
    title: 'Branches',
    current: 'current',
    upstream: 'upstream',
    noUpstream: 'no upstream',
    ahead: 'ahead',
    behind: 'behind',
    create: 'New branch',
    checkout: 'Switch',
    inWorktree: 'checked out elsewhere',
    inWorktreeHint: 'Already checked out in another worktree',
    empty: 'No branches',
    name: 'Name',
    namePlaceholder: 'feature/…',
    startPoint: 'Start point (defaults to HEAD)',
    switchAfterCreate: 'Switch to it',
    confirmSwitchHint: (name: string) =>
      `Switching to ${name} would change files in your working tree.`,
    confirmCreateHint: (name: string) =>
      `Creating and switching to ${name} would change files in your working tree.`,
  },
  worktrees: {
    title: 'Worktrees',
    main: 'main working tree',
    locked: 'locked',
    prunable: 'prunable',
  },
  prs: {
    title: 'PRs',
    ghMissing: 'Install gh to enable pull requests',
    ghUnauthenticated: 'Sign in with gh to enable pull requests',
    comingSoon: 'Pull requests land in Phase 3',
  },
  states: {
    noProject: 'No project open',
    noProjectHint: 'Open or create a project to see its repos here.',
    noProjectRoot: 'This project has no folder yet',
    noProjectRootHint: 'Set a root folder for this project to start tracking it with git.',
    notARepository: 'Not a git repository',
    notARepositoryHint: 'This folder isn’t a git repo yet.',
    notARepositoryCommand: 'git init',
    unreadable: 'Can’t read this folder',
    unreadableHint: 'Check permissions or that the drive is mounted.',
    truncated: 'Some repos were left out — this project has more than the scan limit covers.',
    crossRepoTitle: 'Belongs to a different repo',
    crossRepoHint: (path: string, ownerRepo: string) =>
      `${path} belongs to ${ownerRepo}, not the repo you're viewing.`,
    crossRepoJump: 'Stage it there instead',
    indexLocked: 'Another process is writing to this repo — retrying…',
    confirmRequired: 'This will change your working tree — continue?',
  },
  repoPicker: {
    label: 'Repo',
    root: 'root',
  },
  common: {
    loading: 'Loading…',
    retry: 'Retry',
    stale: 'Refreshing…',
    confirm: 'Confirm',
    cancel: 'Cancel',
  },
} as const;

export const SIMPLIFIED_VOCAB = {
  ...VOCAB,
  nav: {
    changes: 'Drafts',
    history: 'Version Log',
    branches: 'Version Tracks',
    worktrees: 'Agent Workspaces',
    prs: 'Publish Requests',
  },
  changes: {
    ...VOCAB.changes,
    staged: 'Ready to Save',
    unstaged: 'Working Edits',
    untracked: 'New Files',
    conflicted: 'Conflicting Changes',
    stage: 'Add to Save Set',
    unstage: 'Remove from Save Set',
    stageAll: 'Add All to Save Set',
    commit: 'Save Version Snapshot',
    noChanges: 'No pending edits',
  },
} as const;

export function getVocab(mode: 'technical' | 'simplified' = 'technical') {
  return mode === 'simplified' ? SIMPLIFIED_VOCAB : VOCAB;
}
