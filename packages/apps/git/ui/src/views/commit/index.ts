// com.ikenga.git · Commit box — explicit-path commit + "send to your Chi"
// (WP-10).
//
// Mounted at the bottom of the Changes view, matching the locked design
// (`designs/changes-instrument.html`, D-01, "the composer IS the inspector's
// action bar" / `.ip-action-bar`) — a persistent bar under whichever file's
// diff is showing, not a per-file affordance. Per-repo only (01-plan.md
// §Multi-repo model): there is no cross-repo staging, and this box never
// takes a `repo` other than the one Changes is currently showing.
//
// ── Explicit-path commit (G-02, G-04) ───────────────────────────────────────
// `commit.create` allows `paths: []` to mean "commit whatever happens to be
// staged" — but only from the UI (rpc.ts `CommitCreateArgs`); the MCP tool
// schema forbids it. This box never uses that shortcut: it always sends the
// caller-supplied `staged` list's own paths. That is what makes "the UI
// committed this" and "Chi's `git_commit` tool committed this" provably the
// same operation with the same containment story, not two different ones
// that happen to agree today.
//
// ── "Send to your Chi" ──────────────────────────────────────────────────────
// `sendToChi` (app/bridge.ts) is `host.sendToActiveSession` — the studio
// precedent (`ikenga-pkgs/packages/apps/studio/src/studio/bridge.ts:424`).
// It is fire-and-forget: it seeds a user turn in the active chat pane with
// the staged diff and asks Chi to draft a message. It does not, and
// architecturally cannot, hand a reply back into this box —
// `host.sendToActiveSession` resolves with only `{ok, threadId}`, never the
// assistant's text (pkg-runtime's `dispatch.js` "SEAM RATIONALE": this is
// the ONLY agent-run seam, by design). The user reads Chi's answer in the
// chat pane and types or pastes it into the summary field themselves.
//
// ── State lifetime ──────────────────────────────────────────────────────────
// This box is created once per `mountChangesView` call and owns its own
// message/committing/send state across the Changes view's own internal
// repaints (file selection, stage/unstage) — the same node is moved, not
// recreated, so a typed-but-unsent draft survives clicking around files.
// It does NOT survive a fresh `createCommitBox` call, which happens whenever
// App.ts remounts the whole Changes view (an App-level rescan — a
// `repo.changed` push, a repo switch, or a view switch and back). That is
// the same trade-off Branches and Changes already made (views/changes/
// index.ts's header comment) — and here it is also the desired behaviour on
// the success path, since a successful commit is itself what triggers the
// rescan that clears the draft.

import type { FileChange, RpcClient } from '../../app/rpc';
import { sendToChi, type SendToChiResult } from '../../app/bridge';
import { VOCAB } from '../../vocabulary';
import './commit.css';

export interface CommitBoxDeps {
  repo: string;
  /** Display name only (App.ts's `ProjectRollup.repos[].name`) — never used
   *  to resolve or construct a path. */
  repoName: string;
  rpc: RpcClient;
  /** Called after a successful commit so the host re-scans the project
   *  (dirty counts, the ledger, History, the activity-bar badge). */
  onCommitted?: () => void;
}

export interface CommitBoxContext {
  branch: string | null;
  staged: FileChange[];
  /** Non-zero ⇒ the commit box is disabled (ChangesListResult's own
   *  contract: `conflicted` non-empty means the same thing there). */
  conflicted: number;
}

export interface CommitBox {
  /** Push the Changes view's latest staged/conflicted/branch state in
   *  before each of ITS repaints. Cheap when nothing changed — only
   *  re-renders when the context actually differs. */
  setContext(ctx: CommitBoxContext): void;
  /** The box's own root node. Stable across calls — append it once; it
   *  updates itself in place. Safe to append repeatedly to a cleared
   *  container (a no-op re-parent), which is how Changes' own repaint loop
   *  uses it. */
  readonly root: HTMLElement;
}

type SendState = 'idle' | 'sending' | 'sent' | 'error';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function ctxEqual(a: CommitBoxContext, b: CommitBoxContext): boolean {
  if (a.branch !== b.branch || a.conflicted !== b.conflicted || a.staged.length !== b.staged.length) return false;
  return a.staged.every((f, i) => f.path === b.staged[i]?.path);
}

function chiRefusalCopy(reason: string): string {
  switch (reason) {
    case 'no-host':
      return VOCAB.changes.commitBox.chiNoHost;
    case 'scope-denied':
      return VOCAB.changes.commitBox.chiScopeDenied;
    case 'no-active-session':
      return VOCAB.changes.commitBox.chiNoActiveSession;
    default:
      return `${VOCAB.changes.commitBox.chiFailed}: ${reason}`;
  }
}

/** Builds the prompt sent to Chi: the intro line + one unified patch per
 *  staged file, fetched over the same one-shot `rpc` the rest of Changes
 *  uses (no new host verb). Bounded — a huge staged set gets truncated
 *  rather than producing an unbounded prompt. */
async function buildChiPrompt(deps: CommitBoxDeps, ctx: CommitBoxContext): Promise<string> {
  const MAX_CHARS = 12_000;
  const parts = await Promise.all(
    ctx.staged.map(async (f) => {
      try {
        const res = await deps.rpc('changes.diff', { repo: deps.repo, path: f.path, side: 'staged' });
        if (!res.ok) return `--- ${f.path} ---\n(diff unavailable: ${res.message})`;
        if (res.diff.binary) return `--- ${f.path} ---\n(binary file)`;
        return `--- ${f.path} ---\n${res.diff.patch}`;
      } catch (err) {
        return `--- ${f.path} ---\n(diff unavailable: ${err instanceof Error ? err.message : String(err)})`;
      }
    })
  );
  let body = parts.join('\n\n');
  let truncated = false;
  if (body.length > MAX_CHARS) {
    body = body.slice(0, MAX_CHARS);
    truncated = true;
  }
  const branch = ctx.branch ?? VOCAB.changes.commitBox.detachedHead;
  return [
    VOCAB.changes.commitBox.chiPromptIntro(deps.repoName, branch),
    '',
    body,
    truncated ? `\n${VOCAB.changes.commitBox.chiPromptTruncated}` : '',
  ].join('\n');
}

/** Creates (but does not mount) a commit box. Call {@link CommitBox.setContext}
 *  at least once before relying on `root`'s content — it starts out
 *  disabled-empty otherwise. */
export function createCommitBox(deps: CommitBoxDeps): CommitBox {
  let ctx: CommitBoxContext = { branch: null, staged: [], conflicted: 0 };

  let message = '';
  let committing = false;
  let commitError: string | null = null;
  let commitOk: { sha: string; summary: string; signed: boolean | null } | null = null;

  let sendState: SendState = 'idle';
  let sendError: string | null = null;

  const root = el('div', 'git-commit-box');

  function alive(): boolean {
    return root.isConnected;
  }

  function repaint(): void {
    root.innerHTML = '';
    root.appendChild(build());
  }

  async function onCommit(): Promise<void> {
    const trimmed = message.trim();
    if (committing || ctx.staged.length === 0 || ctx.conflicted > 0 || trimmed.length === 0) return;
    committing = true;
    commitError = null;
    commitOk = null;
    repaint();
    try {
      const res = await deps.rpc('commit.create', {
        repo: deps.repo,
        paths: ctx.staged.map((f) => f.path),
        message: trimmed,
      });
      if (!alive()) return;
      committing = false;
      if (!res.ok) {
        commitError = res.message;
        repaint();
        return;
      }
      commitOk = { sha: res.sha, summary: res.summary, signed: res.signed };
      message = '';
      repaint();
      // After onCommitted() the host re-scans; App.ts will remount this
      // whole view on the next render and this box's state goes with it —
      // the success banner above is what the user sees in the meantime.
      deps.onCommitted?.();
    } catch (err) {
      if (!alive()) return;
      committing = false;
      commitError = err instanceof Error ? err.message : String(err);
      repaint();
    }
  }

  async function onSendToChi(): Promise<void> {
    if (sendState === 'sending' || ctx.staged.length === 0 || ctx.conflicted > 0) return;
    sendState = 'sending';
    sendError = null;
    repaint();
    let result: SendToChiResult;
    try {
      const prompt = await buildChiPrompt(deps, ctx);
      if (!alive()) return;
      result = await sendToChi(prompt, 'git-commit-box');
    } catch (err) {
      if (!alive()) return;
      sendState = 'error';
      sendError = err instanceof Error ? err.message : String(err);
      repaint();
      return;
    }
    if (!alive()) return;
    if (result.ok) {
      sendState = 'sent';
    } else {
      sendState = 'error';
      sendError = chiRefusalCopy(result.reason);
    }
    repaint();
  }

  function build(): HTMLElement {
    const V = VOCAB.changes.commitBox;
    const box = el('div', 'git-commit-box__bar');

    const scope = el('div', 'git-commit-box__scope');
    scope.appendChild(el('span', undefined, V.scopeLabel));
    scope.appendChild(el('span', 'git-commit-box__repo', deps.repoName));
    scope.appendChild(el('span', 'git-commit-box__branch', ctx.branch ?? V.detachedHead));
    scope.appendChild(el('span', 'git-commit-box__rule'));
    box.appendChild(scope);

    const disabled = committing || ctx.staged.length === 0 || ctx.conflicted > 0;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'git-commit-box__msg';
    input.placeholder = V.placeholder;
    input.setAttribute('aria-label', 'Commit message');
    input.value = message;
    input.disabled = disabled;
    input.addEventListener('input', () => {
      // Deliberately no repaint() here — this is what lets typing survive
      // an unrelated repaint (see the file header). The value only needs to
      // reach `message`; the DOM node already reflects the keystroke.
      message = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !disabled && message.trim().length > 0) void onCommit();
    });
    box.appendChild(input);

    const row = el('div', 'git-commit-box__row');
    const note = el(
      'span',
      'git-commit-box__note',
      ctx.conflicted > 0
        ? V.conflictsBlock
        : ctx.staged.length === 0
          ? V.noStaged
          : V.filesCount(ctx.staged.length)
    );
    row.appendChild(note);
    row.appendChild(el('span', 'git-commit-box__spacer'));

    const chiDisabled = sendState === 'sending' || ctx.staged.length === 0 || ctx.conflicted > 0;
    const chiLabel =
      sendState === 'sending'
        ? V.chiSending
        : sendState === 'sent'
          ? V.chiSent
          : VOCAB.changes.sendToChi;
    row.appendChild(button(chiLabel, 'git-btn git-btn--sm git-btn--ghost', () => void onSendToChi(), chiDisabled));

    const commitLabel = committing ? V.committing : VOCAB.changes.commit;
    row.appendChild(
      button(
        commitLabel,
        'git-btn git-btn--sm git-btn--primary',
        () => void onCommit(),
        disabled || message.trim().length === 0
      )
    );
    box.appendChild(row);

    if (sendError) {
      box.appendChild(el('div', 'git-commit-box__error', sendError));
    }
    if (commitError) {
      box.appendChild(el('div', 'git-commit-box__error', `${V.commitFailed}: ${commitError}`));
    }
    if (commitOk) {
      const ok = el('div', 'git-commit-box__ok');
      ok.appendChild(el('span', undefined, V.committed(commitOk.sha)));
      ok.appendChild(el('span', 'git-commit-box__ok-summary', commitOk.summary));
      if (commitOk.signed !== null) {
        ok.appendChild(el('span', 'git-commit-box__ok-signed', commitOk.signed ? V.signed : V.unsigned));
      }
      box.appendChild(ok);
    }

    return box;
  }

  repaint();

  return {
    root,
    setContext(next: CommitBoxContext) {
      if (ctxEqual(ctx, next)) return;
      ctx = next;
      // A fresh staged set invalidates a stale success banner (e.g. the user
      // staged something new right after committing, before the App-level
      // rescan remounted this view).
      commitOk = null;
      repaint();
    },
  };
}
