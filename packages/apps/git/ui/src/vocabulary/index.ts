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
  },
  history: {
    title: 'History',
    empty: 'No commits yet',
    coAuthored: 'Co-authored',
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
  },
} as const;
