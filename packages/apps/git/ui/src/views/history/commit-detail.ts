/**
 * com.ikenga.git · History — the commit-detail inspector (WP-08).
 *
 * D-01's inspector column (`designs/changes-instrument.html`), applied to a
 * commit: subject, body, trailers, attribution, signature, parents, numstat.
 *
 * The attribution block is the part with a spec behind it. Claude Code's
 * `Co-Authored-By: Claude <noreply@anthropic.com>` trailer is the default
 * attribution convention and GitHub surfaces it natively — but it is
 * configurable and can be suppressed (02-research-external.md [27][28]), so
 * the plan requires "present/suppressed both handled". Here that means the
 * pane ALWAYS renders an attribution block: it lists the co-authors when the
 * trailer is there, and says in words that the trailer is absent and what that
 * does and does not mean when it isn't. Silence would read as "solo", which is
 * a claim this data cannot support.
 */

import type { CoAuthor, CommitDetail, FileChange } from '../../app/rpc';
import { VOCAB } from '../../vocabulary';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title: string): HTMLElement {
  const wrap = el('section', 'git-hist-detail__section');
  wrap.appendChild(el('h3', 'git-hist-detail__label', title));
  return wrap;
}

function absoluteTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function identity(name: string, email: string): string {
  return email.length > 0 ? `${name} <${email}>` : name;
}

/** The `Co-Authored-By` block. Renders in both directions — see the file header. */
export function renderAttribution(coAuthors: readonly CoAuthor[]): HTMLElement {
  const wrap = section(VOCAB.history.attribution);
  if (coAuthors.length === 0) {
    wrap.classList.add('git-hist-detail__section--muted');
    wrap.appendChild(el('p', 'git-hist-detail__value', VOCAB.history.noCoAuthors));
    wrap.appendChild(el('p', 'git-hist-detail__hint', VOCAB.history.noCoAuthorsHint));
    return wrap;
  }
  const list = el('ul', 'git-hist-detail__list');
  for (const author of coAuthors) {
    const item = el('li', 'git-hist-detail__list-item');
    item.appendChild(el('span', 'git-hist-detail__coauthor', author.name));
    if (author.email.length > 0) {
      item.appendChild(el('span', 'git-hist-detail__mono', author.email));
    }
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

/**
 * A path that truncates in the MIDDLE of its directories and never on its
 * filename — the filename is the part you scan for.
 *
 * Done by splitting rather than by `direction: rtl` on one span: the RTL trick
 * is the usual shortcut and it visibly garbles real paths, because the bidi
 * algorithm reorders the leading punctuation of the visible tail (a path
 * ending `…/designs/d02-x.png` renders as `…esigns/d02-x.png`, silently
 * dropping a character). Two flex children — a shrinkable directory prefix and
 * a fixed basename — truncate exactly where intended with no reordering.
 */
function renderPath(fullPath: string): HTMLElement {
  const wrap = el('span', 'git-hist-detail__file-path');
  wrap.title = fullPath;
  const cut = fullPath.lastIndexOf('/');
  if (cut === -1) {
    wrap.appendChild(el('span', 'git-hist-detail__file-name', fullPath));
    return wrap;
  }
  wrap.appendChild(el('span', 'git-hist-detail__file-dir', fullPath.slice(0, cut + 1)));
  wrap.appendChild(el('span', 'git-hist-detail__file-name', fullPath.slice(cut + 1)));
  return wrap;
}

function renderFiles(files: readonly FileChange[]): HTMLElement {
  const wrap = section(`${VOCAB.history.files}${files.length > 0 ? ` (${String(files.length)})` : ''}`);
  if (files.length === 0) {
    wrap.appendChild(el('p', 'git-hist-detail__hint', VOCAB.history.noFiles));
    return wrap;
  }
  const list = el('ul', 'git-hist-detail__files');
  for (const file of files) {
    const item = el('li', 'git-hist-detail__file');
    item.appendChild(renderPath(file.origPath ? `${file.origPath} → ${file.path}` : file.path));
    const stat = el('span', 'git-hist-detail__file-stat');
    if (file.binary) {
      stat.appendChild(el('span', 'git-hist-detail__binary', 'binary'));
    } else {
      if (file.added !== null) stat.appendChild(el('span', 'git-hist-detail__added', `+${String(file.added)}`));
      if (file.deleted !== null) stat.appendChild(el('span', 'git-hist-detail__deleted', `−${String(file.deleted)}`));
    }
    item.appendChild(stat);
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

export interface CommitDetailCallbacks {
  /** Jump to a parent commit, when it is one of the loaded rows. */
  onSelectSha?: (sha: string) => void;
  /** True when `sha` is in the currently loaded page(s) — a parent below the
   *  last loaded row can't be jumped to, so it renders as plain text. */
  isLoaded?: (sha: string) => boolean;
}

export function renderCommitDetail(
  commit: CommitDetail,
  callbacks: CommitDetailCallbacks = {}
): HTMLElement {
  const root = el('div', 'git-hist-detail');

  // ── Head: subject + identity ─────────────────────────────────────────────
  const head = el('header', 'git-hist-detail__head');
  const badges = el('div', 'git-hist-detail__badges');
  const sha = el('span', 'git-hist-detail__sha', commit.shortSha);
  sha.title = commit.sha;
  badges.appendChild(sha);
  if (commit.parents.length > 1) badges.appendChild(el('span', 'git-badge git-badge--merge', VOCAB.history.merge));
  if (commit.parents.length === 0) badges.appendChild(el('span', 'git-badge', VOCAB.history.rootCommit));
  if (commit.coAuthors.length > 0) {
    badges.appendChild(el('span', 'git-badge git-badge--co', VOCAB.history.coAuthored));
  }
  head.appendChild(badges);
  head.appendChild(el('h2', 'git-hist-detail__subject', commit.subject));

  const who = el('div', 'git-hist-detail__who');
  who.appendChild(
    el(
      'span',
      'git-hist-detail__who-line',
      `${identity(commit.authorName, commit.authorEmail)} · ${VOCAB.history.authored} ${absoluteTime(commit.authorAt)}`
    )
  );
  // Only show the committer when it differs — on a rebase or a cherry-pick it
  // does, and that difference is exactly the thing worth surfacing.
  if (commit.committerEmail !== commit.authorEmail || commit.committerName !== commit.authorName) {
    who.appendChild(
      el(
        'span',
        'git-hist-detail__who-line',
        `${identity(commit.committerName, commit.committerEmail)} · ${VOCAB.history.committed} ${absoluteTime(commit.committedAt)}`
      )
    );
  }
  head.appendChild(who);

  if (commit.refs.length > 0) {
    const refs = el('div', 'git-hist-detail__refs');
    for (const ref of commit.refs) refs.appendChild(el('span', 'git-chip', ref));
    head.appendChild(refs);
  }
  root.appendChild(head);

  // ── Message body ─────────────────────────────────────────────────────────
  // `%B` includes the subject line; strip it so the pane doesn't repeat the
  // heading, and drop the trailer block, which gets its own section below.
  const bodyText = messageBodyWithoutSubjectOrTrailers(commit);
  if (bodyText.length > 0) {
    const wrap = section(VOCAB.history.message);
    wrap.appendChild(el('pre', 'git-hist-detail__body', bodyText));
    root.appendChild(wrap);
  }

  // ── Attribution — always present, in both directions ─────────────────────
  root.appendChild(renderAttribution(commit.coAuthors));

  // ── Other trailers ───────────────────────────────────────────────────────
  const otherTrailers = commit.trailers.filter((t) => t.key.toLowerCase() !== 'co-authored-by');
  if (otherTrailers.length > 0) {
    const wrap = section(VOCAB.history.trailers);
    const list = el('ul', 'git-hist-detail__list');
    for (const trailer of otherTrailers) {
      const item = el('li', 'git-hist-detail__list-item');
      item.appendChild(el('span', 'git-hist-detail__trailer-key', trailer.key));
      item.appendChild(el('span', 'git-hist-detail__value', trailer.value));
      list.appendChild(item);
    }
    wrap.appendChild(list);
    root.appendChild(wrap);
  }

  // ── Signature ────────────────────────────────────────────────────────────
  const sig = section(VOCAB.history.signature);
  if (commit.signature) {
    sig.appendChild(
      el(
        'p',
        'git-hist-detail__value',
        commit.signature.signer ? `${commit.signature.status} · ${commit.signature.signer}` : commit.signature.status
      )
    );
  } else {
    sig.classList.add('git-hist-detail__section--muted');
    sig.appendChild(el('p', 'git-hist-detail__value', VOCAB.history.signatureNone));
  }
  root.appendChild(sig);

  // ── Parents ──────────────────────────────────────────────────────────────
  if (commit.parents.length > 0) {
    const wrap = section(VOCAB.history.parents);
    const list = el('div', 'git-hist-detail__parents');
    for (const parent of commit.parents) {
      const loaded = callbacks.isLoaded?.(parent) ?? false;
      if (loaded && callbacks.onSelectSha) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'git-hist-detail__parent git-hist-detail__parent--link';
        button.textContent = parent.slice(0, 7);
        button.title = parent;
        button.addEventListener('click', () => callbacks.onSelectSha?.(parent));
        list.appendChild(button);
      } else {
        const span = el('span', 'git-hist-detail__parent', parent.slice(0, 7));
        span.title = parent;
        list.appendChild(span);
      }
    }
    wrap.appendChild(list);
    root.appendChild(wrap);
  }

  // ── Files ────────────────────────────────────────────────────────────────
  root.appendChild(renderFiles(commit.files));

  return root;
}

/**
 * `%B` minus the subject line and minus the trailer block.
 *
 * Trailers are removed by matching the parsed trailer lines off the END of the
 * message rather than by re-parsing: `parseTrailers` (git-core) already made
 * that judgement call, and re-implementing "is this last paragraph a trailer
 * block" here would be a second, drifting copy of git's own rule.
 */
export function messageBodyWithoutSubjectOrTrailers(commit: CommitDetail): string {
  const lines = commit.body.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() === commit.subject.trim()) lines.shift();

  if (commit.trailers.length > 0) {
    const trailerText = new Set(
      commit.trailers.flatMap((t) => `${t.key}: ${t.value}`.split('\n').map((s) => s.trim()))
    );
    while (lines.length > 0) {
      const last = lines[lines.length - 1]?.trim() ?? '';
      if (last.length === 0 || trailerText.has(last)) {
        lines.pop();
        continue;
      }
      break;
    }
  }

  return lines.join('\n').trim();
}
