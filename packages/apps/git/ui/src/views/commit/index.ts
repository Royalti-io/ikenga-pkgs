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
// ── "Send to your Chi" — what it actually does (R6) ─────────────────────────
// It COPIES. This was written against `host.sendToActiveSession`, on the
// strength of com.ikenga.studio calling it. That verb does not exist: the
// shell's pkg-iframe dispatcher (`shell/src/components/pkg/
// pkg-iframe-host.tsx`) has no case for it and the call falls through to
// 'unknown host tool', so studio's helper is stale rather than precedent.
// Shipping the button as-is would have reported "Sent to your Chi — check the
// chat pane" for a message that was never delivered, which is the worst
// available outcome: a confident lie about someone else's inbox.
//
// So the button builds the identical bounded diff prompt and puts it on the
// clipboard, and the note says "Copied — paste it to your Chi". The label
// keeps its words (the possessive is load-bearing — a Chi is personal); only
// the promise changes to one the pkg can keep. Even once the verb lands, the
// user still reads Chi's answer in the chat pane and puts it in the summary
// field themselves: the seam never hands a reply back.
// TODO(shell): host.sendToActiveSession — ikenga-hq/ikenga issue <pending>
//
// ── Why the Commit button is wired the way it is (R6) ───────────────────────
// `disabled` depends on the typed message, but the `input` listener must NOT
// repaint: a repaint replaces the <input> node mid-keystroke and the caret
// goes with it. The original code resolved that by not repainting AND
// computing `disabled` only at build time — so the button was computed once,
// while `message` was still '', and stayed disabled forever. Only the Enter
// handler worked. The fix is to touch the one property that changed:
// `syncCommitEnabled()` recomputes `commitDisabled(...)` and assigns it to the
// live button node. No repaint, no lost caret, no stale button.
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
import { copyText } from '../../app/clipboard';
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

type SendState = 'idle' | 'preparing' | 'copied' | 'error';

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

/**
 * When the Commit button is disabled. THE thing the R6 UI defect got wrong:
 * this depends on `message`, which changes on every keystroke, so it has to be
 * re-evaluated on `input` — not once at build time.
 *
 * Exported so the DOM test can state the four conditions directly as well as
 * drive them through the real node.
 */
export function commitDisabled(
  ctx: CommitBoxContext,
  message: string,
  committing: boolean
): boolean {
  return (
    committing || ctx.staged.length === 0 || ctx.conflicted > 0 || message.trim().length === 0
  );
}

/** Builds the prompt copied for Chi: the intro line + one unified patch per
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

  /** The LIVE Commit button of the current build. Reassigned by every
   *  `build()`; read by `syncCommitEnabled` so a keystroke updates the node
   *  that is actually on screen. */
  let commitBtn: HTMLButtonElement | null = null;

  /** Recompute just the Commit button's `disabled`. Cheap, caret-safe, and the
   *  whole fix for the R6 "button never enables" defect. */
  function syncCommitEnabled(): void {
    if (commitBtn) commitBtn.disabled = commitDisabled(ctx, message, committing);
  }

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

  async function onCopyForChi(): Promise<void> {
    if (sendState === 'preparing' || ctx.staged.length === 0 || ctx.conflicted > 0) return;
    sendState = 'preparing';
    sendError = null;
    repaint();
    let copied = false;
    try {
      const prompt = await buildChiPrompt(deps, ctx);
      if (!alive()) return;
      copied = await copyText(prompt);
    } catch (err) {
      if (!alive()) return;
      sendState = 'error';
      sendError = err instanceof Error ? err.message : String(err);
      repaint();
      return;
    }
    if (!alive()) return;
    sendState = copied ? 'copied' : 'error';
    if (!copied) sendError = VOCAB.changes.commitBox.chiCopyFailed;
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

    // `disabled` here is the BOX-level block (no staged files, a conflict, or
    // a commit in flight) — it gates the input and the Chi button. The Commit
    // button additionally needs a non-empty message, which is what
    // `commitDisabled` adds and what `syncCommitEnabled` keeps current.
    const disabled = committing || ctx.staged.length === 0 || ctx.conflicted > 0;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'git-commit-box__msg';
    input.placeholder = V.placeholder;
    input.setAttribute('aria-label', 'Commit message');
    input.value = message;
    input.disabled = disabled;
    input.addEventListener('input', () => {
      // Still deliberately no repaint(): a repaint would replace this very
      // <input> mid-keystroke and take the caret with it. The value only needs
      // to reach `message` — the DOM node already reflects the keystroke — but
      // the Commit button's `disabled` depends on `message`, so the ONE
      // property that changed is assigned directly. Forgetting this line is
      // the R6 defect: the button was computed once, at build time, while
      // `message` was '' — permanently disabled, Enter the only way to commit.
      message = input.value;
      syncCommitEnabled();
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

    const chiDisabled = sendState === 'preparing' || ctx.staged.length === 0 || ctx.conflicted > 0;
    // The LABEL never changes away from "Send to your Chi" except while it is
    // working — the outcome is reported in the note below, where it can be
    // honest about what happened ("Copied", not "Sent").
    const chiLabel = sendState === 'preparing' ? V.chiPreparing : VOCAB.changes.sendToChi;
    row.appendChild(button(chiLabel, 'git-btn git-btn--sm git-btn--ghost', () => void onCopyForChi(), chiDisabled));

    const commitLabel = committing ? V.committing : VOCAB.changes.commit;
    commitBtn = button(
      commitLabel,
      'git-btn git-btn--sm git-btn--primary',
      () => void onCommit(),
      commitDisabled(ctx, message, committing)
    );
    row.appendChild(commitBtn);
    box.appendChild(row);

    if (sendState === 'copied') {
      box.appendChild(el('div', 'git-commit-box__ok', V.chiCopied));
    }
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
