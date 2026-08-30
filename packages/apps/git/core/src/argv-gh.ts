import { ArgvResult, checkRef } from './argv.js';
import { gitError } from './errors.js';

function finishGh(argv: string[]): ArgvResult {
  return { ok: true, argv };
}

export function ghPrList(opts: { state?: 'open' | 'closed' | 'merged' | 'all'; limit?: number }): ArgvResult {
  const state = opts.state ?? 'open';
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  return finishGh([
    'pr',
    'list',
    '--json',
    'number,title,author,headRefName,baseRefName,isDraft,url,updatedAt,reviewDecision,state,body,comments,additions,deletions,changedFiles,labels',
    '--state',
    state,
    '--limit',
    String(limit),
  ]);
}

export function ghPrCheckout(opts: { number: number }): ArgvResult {
  if (!Number.isInteger(opts.number) || opts.number <= 0) {
    return gitError('invalid-args', `PR number must be positive integer: ${String(opts.number)}`);
  }
  return finishGh(['pr', 'checkout', String(opts.number)]);
}

export function ghPrCreate(opts: { title: string; body: string; base?: string; draft?: boolean }): ArgvResult {
  if (!opts.title.trim()) {
    return gitError('invalid-args', 'PR title must not be empty');
  }
  const args = ['pr', 'create', '--title', opts.title.trim(), '--body', opts.body ?? ''];
  if (opts.base) {
    const check = checkRef(opts.base, 'base');
    if (check) return check;
    args.push('--base', opts.base);
  }
  if (opts.draft) {
    args.push('--draft');
  }
  return finishGh(args);
}
